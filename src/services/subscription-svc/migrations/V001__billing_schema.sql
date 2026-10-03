-- billing_db: plans and entitlements, subscriptions, checkout sessions, idempotent payment events
-- (FR-SUB-01..07). Test environments use the MOCK provider; Stripe/Razorpay/stores plug in the same way.

CREATE TABLE plan (
    code              VARCHAR(16)  NOT NULL,
    name              VARCHAR(80)  NOT NULL,
    price_minor       INT          NOT NULL,       -- smallest currency unit
    currency          CHAR(3)      NOT NULL,
    billing_interval  VARCHAR(5)   NOT NULL,
    trial_days        INT          NOT NULL DEFAULT 0,
    entitlements      JSONB        NOT NULL,
    is_active         BOOLEAN      NOT NULL DEFAULT true,
    sort_order        INT          NOT NULL DEFAULT 0,
    CONSTRAINT pk_plan PRIMARY KEY (code),
    CONSTRAINT ck_plan__interval CHECK (billing_interval IN ('MONTH', 'YEAR', 'NONE')),
    CONSTRAINT ck_plan__price CHECK (price_minor >= 0)
);

-- Placeholder prices: pricing is an open product question (SRS §6, question 3).
INSERT INTO plan (code, name, price_minor, currency, billing_interval, trial_days, entitlements, sort_order) VALUES
 ('FREE',  'Free',  0,   'USD', 'NONE',  0, '{"maxTrackers": 2,  "customParams": false, "maxCustomMetrics": 0,  "historyDays": 90,   "export": false, "reminders": 2}',  1),
 ('PRO',   'Pro',   499, 'USD', 'MONTH', 14,'{"maxTrackers": 10, "customParams": true,  "maxCustomMetrics": 10, "historyDays": 730,  "export": true,  "reminders": 10}', 2),
 ('ELITE', 'Elite', 999, 'USD', 'MONTH', 14,'{"maxTrackers": 50, "customParams": true,  "maxCustomMetrics": 25, "historyDays": 3650, "export": true,  "reminders": 50}', 3);

CREATE TABLE subscription (
    id                    UUID         NOT NULL,
    user_id               UUID         NOT NULL,
    plan_code             VARCHAR(16)  NOT NULL,
    status                VARCHAR(10)  NOT NULL,
    provider              VARCHAR(10)  NOT NULL,
    provider_sub_id       VARCHAR(120) NOT NULL,
    current_period_start  TIMESTAMPTZ  NOT NULL,
    current_period_end    TIMESTAMPTZ,
    cancel_at_period_end  BOOLEAN      NOT NULL DEFAULT false,
    row_version           INT          NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_subscription PRIMARY KEY (id),
    CONSTRAINT fk_subscription__plan FOREIGN KEY (plan_code) REFERENCES plan (code),
    CONSTRAINT uq_subscription__provider_sub UNIQUE (provider, provider_sub_id),
    CONSTRAINT ck_subscription__status CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED')),
    CONSTRAINT ck_subscription__provider CHECK (provider IN ('MOCK', 'STRIPE', 'RAZORPAY', 'APPLE', 'GOOGLE'))
);
-- At most one live subscription per user; also the lookup for "my subscription".
CREATE UNIQUE INDEX uq_subscription__user_live ON subscription (user_id) WHERE status <> 'CANCELED';
-- Renewal / expiry sweeps over subscriptions ending soon.
CREATE INDEX ix_subscription__period_end ON subscription (current_period_end) WHERE status <> 'CANCELED';

CREATE TABLE checkout_session (
    id          UUID         NOT NULL,
    user_id     UUID         NOT NULL,
    plan_code   VARCHAR(16)  NOT NULL,
    provider    VARCHAR(10)  NOT NULL,
    status      VARCHAR(10)  NOT NULL DEFAULT 'OPEN',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ  NOT NULL,
    CONSTRAINT pk_checkout_session PRIMARY KEY (id),
    CONSTRAINT fk_checkout_session__plan FOREIGN KEY (plan_code) REFERENCES plan (code),
    CONSTRAINT ck_checkout_session__status CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELED', 'EXPIRED'))
);

-- Webhook idempotency: a provider event is applied once (FR-SUB-04).
CREATE TABLE payment_event (
    id                 UUID         NOT NULL,
    provider           VARCHAR(10)  NOT NULL,
    provider_event_id  VARCHAR(120) NOT NULL,
    type               VARCHAR(60)  NOT NULL,
    subscription_id    UUID,
    payload            JSONB        NOT NULL,
    received_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_payment_event PRIMARY KEY (id),
    CONSTRAINT uq_payment_event__provider_event UNIQUE (provider, provider_event_id),
    CONSTRAINT fk_payment_event__subscription FOREIGN KEY (subscription_id) REFERENCES subscription (id)
);
-- A subscription's payment history (receipts) and the FK index.
CREATE INDEX ix_payment_event__subscription ON payment_event (subscription_id, received_at DESC);

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
