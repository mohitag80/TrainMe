-- notification_db: reminders (FR-NTF-01), in-app inbox + delivery log (FR-NTF-02..04), preferences (FR-PRF-05)
-- and a contact read model built from user.* events (no PII is fetched from other services).

CREATE TABLE user_contact (
    user_id       UUID         NOT NULL,
    email         VARCHAR(254),
    display_name  VARCHAR(80)  NOT NULL,
    timezone      VARCHAR(40)  NOT NULL DEFAULT 'UTC',
    locale        VARCHAR(10)  NOT NULL DEFAULT 'en',
    is_deleted    BOOLEAN      NOT NULL DEFAULT false,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_contact PRIMARY KEY (user_id)
);

CREATE TABLE notification_preference (
    user_id         UUID        NOT NULL,
    email_enabled   BOOLEAN     NOT NULL DEFAULT true,
    push_enabled    BOOLEAN     NOT NULL DEFAULT true,
    in_app_enabled  BOOLEAN     NOT NULL DEFAULT true,
    quiet_start     TIME,                          -- local time; NULL = no quiet hours
    quiet_end       TIME,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_notification_preference PRIMARY KEY (user_id)
);

CREATE TABLE reminder (
    id            UUID         NOT NULL,
    user_id       UUID         NOT NULL,
    tracker_id    UUID,
    title         VARCHAR(120) NOT NULL,
    days_of_week  SMALLINT[]   NOT NULL,           -- ISO: 1 = Monday … 7 = Sunday
    time_of_day   TIME         NOT NULL,           -- local time in `timezone`
    timezone      VARCHAR(40)  NOT NULL,
    channel       VARCHAR(8)   NOT NULL DEFAULT 'PUSH',
    is_enabled    BOOLEAN      NOT NULL DEFAULT true,
    next_fire_at  TIMESTAMPTZ  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_reminder PRIMARY KEY (id),
    CONSTRAINT ck_reminder__channel CHECK (channel IN ('PUSH', 'EMAIL', 'IN_APP')),
    CONSTRAINT ck_reminder__days CHECK (cardinality(days_of_week) BETWEEN 1 AND 7 AND days_of_week <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);
-- A user's reminders.
CREATE INDEX ix_reminder__user ON reminder (user_id, created_at);
-- Scheduler: due reminders only.
CREATE INDEX ix_reminder__due ON reminder (next_fire_at) WHERE is_enabled;

-- Every notification (inbox entry and delivery log in one row).
CREATE TABLE notification (
    id          UUID         NOT NULL,
    user_id     UUID         NOT NULL,
    channel     VARCHAR(8)   NOT NULL,
    template    VARCHAR(40)  NOT NULL,
    title       VARCHAR(160) NOT NULL,
    body        TEXT         NOT NULL,
    data        JSONB        NOT NULL DEFAULT '{}',
    status      VARCHAR(8)   NOT NULL DEFAULT 'QUEUED',
    error       TEXT,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sent_at     TIMESTAMPTZ,
    CONSTRAINT pk_notification PRIMARY KEY (id),
    CONSTRAINT ck_notification__channel CHECK (channel IN ('PUSH', 'EMAIL', 'IN_APP')),
    CONSTRAINT ck_notification__status CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED'))
);
-- Inbox (newest first, keyset pagination) and unread badge.
CREATE INDEX ix_notification__user_created ON notification (user_id, created_at DESC, id DESC);
CREATE INDEX ix_notification__user_unread ON notification (user_id) WHERE read_at IS NULL AND channel = 'IN_APP';

CREATE TABLE processed_event (
    event_id      UUID        NOT NULL,
    consumer      VARCHAR(80) NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_processed_event PRIMARY KEY (event_id, consumer)
);
CREATE INDEX ix_processed_event__processed_at ON processed_event (processed_at);

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
