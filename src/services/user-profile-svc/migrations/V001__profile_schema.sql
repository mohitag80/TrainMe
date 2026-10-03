-- profile_db: user profile and preferences (FR-PRF-01..06), devices, data export/erasure requests.
-- id = Keycloak subject; Keycloak stays the identity source, this is the app profile.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE user_profile (
    id                     UUID          NOT NULL,
    email                  CITEXT,
    display_name           VARCHAR(80)   NOT NULL,
    date_of_birth          DATE,
    gender                 VARCHAR(16),
    height_cm              NUMERIC(5, 1),          -- canonical units (ADR-014)
    weight_kg              NUMERIC(5, 1),
    unit_preferences       JSONB         NOT NULL DEFAULT '{}',   -- {"speed":"IMPERIAL","mass":"METRIC",...}
    timezone               VARCHAR(40)   NOT NULL DEFAULT 'UTC',
    locale                 VARCHAR(10)   NOT NULL DEFAULT 'en',
    week_start             VARCHAR(3)    NOT NULL DEFAULT 'MON',
    interests              TEXT[]        NOT NULL DEFAULT '{}',
    is_onboarded           BOOLEAN       NOT NULL DEFAULT false,
    row_version            INT           NOT NULL DEFAULT 1,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ,
    CONSTRAINT pk_user_profile PRIMARY KEY (id),
    CONSTRAINT ck_user_profile__gender CHECK (gender IN ('FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED')),
    CONSTRAINT ck_user_profile__week_start CHECK (week_start IN ('MON', 'SUN')),
    CONSTRAINT ck_user_profile__height CHECK (height_cm BETWEEN 50 AND 260),
    CONSTRAINT ck_user_profile__weight CHECK (weight_kg BETWEEN 20 AND 400)
);
-- S9 support search by email or name (typo tolerant); support/admin only.
CREATE INDEX ix_user_profile__email_trgm ON user_profile USING GIN ((email::text) gin_trgm_ops);
CREATE INDEX ix_user_profile__name_trgm ON user_profile USING GIN (lower(display_name) gin_trgm_ops);

CREATE TABLE user_device (
    id            UUID         NOT NULL,
    user_id       UUID         NOT NULL,
    platform      VARCHAR(8)   NOT NULL,
    push_token    TEXT         NOT NULL,
    app_version   VARCHAR(20),
    last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_device PRIMARY KEY (id),
    CONSTRAINT fk_user_device__user_profile FOREIGN KEY (user_id) REFERENCES user_profile (id) ON DELETE CASCADE,
    CONSTRAINT ck_user_device__platform CHECK (platform IN ('IOS', 'ANDROID', 'WEB')),
    -- Re-registering the same token is an upsert; also the FK index (user_id leads).
    CONSTRAINT uq_user_device__user_token UNIQUE (user_id, push_token)
);

CREATE TABLE data_request (
    id            UUID         NOT NULL,
    user_id       UUID         NOT NULL,
    type          VARCHAR(8)   NOT NULL,
    status        VARCHAR(12)  NOT NULL DEFAULT 'REQUESTED',
    requested_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    details       JSONB        NOT NULL DEFAULT '{}',
    CONSTRAINT pk_data_request PRIMARY KEY (id),
    CONSTRAINT ck_data_request__type CHECK (type IN ('EXPORT', 'ERASURE')),
    CONSTRAINT ck_data_request__status CHECK (status IN ('REQUESTED', 'PROCESSING', 'READY', 'DONE', 'FAILED'))
);
-- A user's requests, newest first.
CREATE INDEX ix_data_request__user_requested ON data_request (user_id, requested_at DESC);

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
