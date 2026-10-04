-- Idempotency ledger for subscription-svc's event consumer (user.deleted → cancel subscription).
CREATE TABLE processed_event (
    event_id      UUID        NOT NULL,
    consumer      VARCHAR(80) NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_processed_event PRIMARY KEY (event_id, consumer)
);
CREATE INDEX ix_processed_event__processed_at ON processed_event (processed_at);
