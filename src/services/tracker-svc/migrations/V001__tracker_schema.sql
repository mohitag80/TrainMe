-- tracker_db: a user's personal copies of templates, their overrides and compiled schema versions (LLD §2.2, §3).

CREATE TABLE user_tracker (
    id                UUID         NOT NULL,
    user_id           UUID         NOT NULL,
    template_code     VARCHAR(80),                    -- NULL = built from scratch (FR-TRK-05)
    template_version  INT,
    display_name      VARCHAR(120) NOT NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    base_snapshot     JSONB        NOT NULL,          -- template copy at create/upgrade time
    schema_version    INT          NOT NULL DEFAULT 1,
    display_units     JSONB        NOT NULL DEFAULT '{}',  -- not versioned (ADR-014)
    row_version       INT          NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT pk_user_tracker PRIMARY KEY (id),
    CONSTRAINT ck_user_tracker__status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_user_tracker__template CHECK ((template_code IS NULL) = (template_version IS NULL))
);
-- "My trackers" (newest first) and the plan-limit count of active trackers; user-scoped, live rows only.
CREATE INDEX ix_user_tracker__user_status ON user_tracker (user_id, status, created_at DESC) WHERE deleted_at IS NULL;

-- Every compiled schema version is kept: sessions pin the version they started with.
CREATE TABLE tracker_schema (
    tracker_id        UUID        NOT NULL,
    version           INT         NOT NULL,
    effective_schema  JSONB       NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_tracker_schema PRIMARY KEY (tracker_id, version),
    CONSTRAINT fk_tracker_schema__user_tracker FOREIGN KEY (tracker_id) REFERENCES user_tracker (id) ON DELETE CASCADE
);

-- Overrides are applied in created_at order (LLD §3 rule 1).
CREATE TABLE tracker_override (
    id                  UUID        NOT NULL,
    tracker_id          UUID        NOT NULL,
    target              VARCHAR(16) NOT NULL,
    action              VARCHAR(16) NOT NULL,
    activity_code       VARCHAR(80) NOT NULL,
    item_key            VARCHAR(64),
    definition          JSONB       NOT NULL DEFAULT '{}',
    created_in_version  INT         NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_tracker_override PRIMARY KEY (id),
    CONSTRAINT fk_tracker_override__user_tracker FOREIGN KEY (tracker_id) REFERENCES user_tracker (id) ON DELETE CASCADE,
    CONSTRAINT ck_tracker_override__target CHECK (target IN ('ACTIVITY', 'PARAMETER', 'METRIC')),
    CONSTRAINT ck_tracker_override__action CHECK (action IN ('ADD', 'MODIFY', 'HIDE'))
);
-- Load a tracker's overrides in order (also the FK index).
CREATE INDEX ix_tracker_override__tracker_created ON tracker_override (tracker_id, created_at);

-- Read model of subscription.* events: limits for plan checks (falls back to the token's plan claim).
CREATE TABLE user_entitlement (
    user_id       UUID        NOT NULL,
    plan_code     VARCHAR(16) NOT NULL,
    entitlements  JSONB       NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_entitlement PRIMARY KEY (user_id)
);

-- Read model of catalog.template.* events: "upgrade available" hints (FR-TRK-08).
CREATE TABLE template_release (
    template_code   VARCHAR(80)  NOT NULL,
    latest_version  INT          NOT NULL,
    name            VARCHAR(120) NOT NULL,
    published_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_template_release PRIMARY KEY (template_code)
);

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
-- Housekeeping deletes ledger rows older than the topic retention.
CREATE INDEX ix_processed_event__processed_at ON processed_event (processed_at);
