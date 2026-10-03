-- records_db: named live sessions and granular entries (LLD §2.3, ADR-011, ADR-015; 08 §4.2).
-- Both big tables are range-partitioned by month on session_date (pg_partman, premake 3, default partition
-- for backfills outside the managed range). Every user query is user-scoped and date-bounded.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE FUNCTION f_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

CREATE FUNCTION f_array_text(text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT array_to_string($1, ' ') $$;

-- ------------------------------------------------------------------ sessions
CREATE TABLE activity_session (
    id                 UUID         NOT NULL,
    user_id            UUID         NOT NULL,
    tracker_id         UUID         NOT NULL,
    session_date       DATE         NOT NULL,          -- local date at Start; partition key
    name               VARCHAR(80)  NOT NULL,
    name_key           VARCHAR(80)  GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED,
    status             VARCHAR(12)  NOT NULL DEFAULT 'IN_PROGRESS',
    started_at         TIMESTAMPTZ  NOT NULL,
    ended_at           TIMESTAMPTZ,
    timezone           VARCHAR(40)  NOT NULL,
    schema_version     INT          NOT NULL,          -- pinned at Start
    client_session_id  UUID         NOT NULL,          -- idempotency of Start
    last_batch_seq     INT          NOT NULL DEFAULT 0,
    entry_count        INT          NOT NULL DEFAULT 0,
    last_synced_at     TIMESTAMPTZ,
    is_auto_closed     BOOLEAN      NOT NULL DEFAULT false,
    notes              TEXT,
    tags               TEXT[]       NOT NULL DEFAULT '{}',
    source             VARCHAR(16)  NOT NULL DEFAULT 'MOBILE',
    row_version        INT          NOT NULL DEFAULT 1,
    deleted_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    search_tsv         tsvector GENERATED ALWAYS AS (
                           setweight(to_tsvector('simple', f_unaccent(name)), 'A') ||
                           to_tsvector('simple', f_unaccent(coalesce(notes, '') || ' ' || coalesce(f_array_text(tags), '')))) STORED,
    CONSTRAINT pk_activity_session PRIMARY KEY (id, session_date),
    CONSTRAINT ck_activity_session__status CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'DISCARDED')),
    CONSTRAINT ck_activity_session__name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT ck_activity_session__source CHECK (source IN ('MOBILE', 'WEB', 'IMPORT')),
    CONSTRAINT ck_activity_session__notes CHECK (length(notes) <= 2000)
) PARTITION BY RANGE (session_date);

-- Start is idempotent per device-generated id.
CREATE UNIQUE INDEX uq_activity_session__client_session ON activity_session (user_id, client_session_id, session_date);
-- ADR-015: (date, name) identifies a session for its user; discarded/deleted sessions free the name.
-- Also serves "all my sessions on <date>" (S4b) and the sessions-per-day guard.
CREATE UNIQUE INDEX uq_activity_session__user_date_name ON activity_session (user_id, session_date, name_key)
    WHERE deleted_at IS NULL AND status <> 'DISCARDED';
-- S4: my sessions of one tracker in a date range, newest first.
CREATE INDEX ix_activity_session__user_tracker_date ON activity_session (user_id, tracker_id, session_date DESC)
    WHERE deleted_at IS NULL;
-- Auto-close scan: only the (few) in-progress sessions.
CREATE INDEX ix_activity_session__in_progress ON activity_session (last_synced_at) WHERE status = 'IN_PROGRESS';
-- S5: full-text over name, notes and tags, user first (btree_gin).
CREATE INDEX ix_activity_session__user_search ON activity_session USING GIN (user_id, search_tsv);

-- Locates a session's partition from its id alone (API paths carry only the id).
CREATE TABLE session_locator (
    session_id    UUID NOT NULL,
    user_id       UUID NOT NULL,
    session_date  DATE NOT NULL,
    CONSTRAINT pk_session_locator PRIMARY KEY (session_id)
);

-- ------------------------------------------------------------------ entries (one row per ball / set / item)
CREATE TABLE activity_entry (
    id               UUID         NOT NULL,
    user_id          UUID         NOT NULL,          -- denormalised: every search is user-scoped
    session_id       UUID         NOT NULL,
    session_date     DATE         NOT NULL,          -- partition key
    client_entry_id  UUID         NOT NULL,
    activity_code    VARCHAR(80)  NOT NULL,
    seq_no           INT          NOT NULL,
    group_no         INT,
    recorded_at      TIMESTAMPTZ  NOT NULL,
    values           JSONB        NOT NULL,          -- canonical units, validated against the pinned schema
    row_version      INT          NOT NULL DEFAULT 1,
    deleted_at       TIMESTAMPTZ,                    -- tombstone so deletes sync idempotently
    CONSTRAINT pk_activity_entry PRIMARY KEY (id, session_date),
    CONSTRAINT fk_activity_entry__activity_session FOREIGN KEY (session_id, session_date)
        REFERENCES activity_session (id, session_date) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT ck_activity_entry__values CHECK (jsonb_typeof(values) = 'object'),
    CONSTRAINT ck_activity_entry__seq_no CHECK (seq_no >= 1)
) PARTITION BY RANGE (session_date);

-- Checkpoint upserts (ON CONFLICT target) and the FK lookups.
CREATE UNIQUE INDEX uq_activity_entry__session_client_entry ON activity_entry (session_id, client_entry_id, session_date);
-- A session's entries in order (session detail, snapshots, counts).
CREATE INDEX ix_activity_entry__session_seq ON activity_entry (session_id, seq_no);
-- S7: entry search per user and activity over a date range.
CREATE INDEX ix_activity_entry__user_activity_date ON activity_entry (user_id, activity_code, session_date DESC)
    WHERE deleted_at IS NULL;

-- Monthly partitions: 24 months back for backfills, 3 ahead; older dates go to the default partition.
SELECT partman.create_parent(
    p_parent_table    := 'public.activity_session',
    p_control         := 'session_date',
    p_interval        := '1 month',
    p_premake         := 3,
    p_start_partition := to_char(date_trunc('month', now()) - interval '24 months', 'YYYY-MM-DD'));
SELECT partman.create_parent(
    p_parent_table    := 'public.activity_entry',
    p_control         := 'session_date',
    p_interval        := '1 month',
    p_premake         := 3,
    p_start_partition := to_char(date_trunc('month', now()) - interval '24 months', 'YYYY-MM-DD'));

-- ------------------------------------------------------------------ messaging
CREATE TABLE outbox_event (
    id            UUID        NOT NULL,
    topic         VARCHAR(80) NOT NULL,
    message_key   VARCHAR(80) NOT NULL,
    event_type    VARCHAR(80) NOT NULL,
    payload       JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    attempts      INT         NOT NULL DEFAULT 0,
    CONSTRAINT pk_outbox_event PRIMARY KEY (id)
);
CREATE INDEX ix_outbox_event__unpublished ON outbox_event (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_event (
    event_id      UUID        NOT NULL,
    consumer      VARCHAR(80) NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_processed_event PRIMARY KEY (event_id, consumer)
);
CREATE INDEX ix_processed_event__processed_at ON processed_event (processed_at);
