-- analytics_db: per-session facts, DAY/WEEK/MONTH rollups, per-session metrics, personal records, streaks
-- (LLD §2.4, ADR-005; 08 §4.3). Built only from COMPLETED sessions. Additive num/den/sum/count make
-- every period exact (a week's ratio is Σnum ÷ Σden, never an average of daily percentages).

-- One row per completed session: everything needed to recompute any rollup without the raw entries.
CREATE TABLE session_fact (
    user_id         UUID         NOT NULL,
    session_id      UUID         NOT NULL,
    tracker_id      UUID         NOT NULL,
    session_date    DATE         NOT NULL,
    session_name    VARCHAR(80)  NOT NULL,
    started_at      TIMESTAMPTZ  NOT NULL,
    schema_version  INT          NOT NULL,
    entry_count     INT          NOT NULL,
    stats           JSONB        NOT NULL,   -- {activity: {params: {key: ParamStats}, metrics: {key: {num, den, value, merge}}}}
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_session_fact PRIMARY KEY (user_id, session_id)
);
-- Rebuild a day's rollups from that day's sessions; streak calculation over distinct dates.
CREATE INDEX ix_session_fact__user_tracker_date ON session_fact (user_id, tracker_id, session_date);

-- Chart series (FR-ANL-01/02). item_type P = parameter statistic, M = catalog/user metric (keys may coincide).
CREATE TABLE metric_rollup (
    user_id        UUID         NOT NULL,
    tracker_id     UUID         NOT NULL,
    activity_code  VARCHAR(80)  NOT NULL,
    item_type      CHAR(1)      NOT NULL,
    item_key       VARCHAR(64)  NOT NULL,
    granularity    VARCHAR(5)   NOT NULL,
    period_start   DATE         NOT NULL,
    count          BIGINT       NOT NULL DEFAULT 0,   -- P: non-null values
    sum            NUMERIC      NOT NULL DEFAULT 0,
    min            NUMERIC,
    max            NUMERIC,
    true_count     BIGINT       NOT NULL DEFAULT 0,
    num            NUMERIC,                           -- M: Σ numerator (or MAX/MIN for extreme metrics)
    den            NUMERIC,                           -- M: Σ denominator (RATIO only)
    merge_kind     VARCHAR(3)   NOT NULL DEFAULT 'SUM', -- how periods combine num: SUM, or MAX/MIN for extremes
    session_count  INT          NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- PK order = query order: one series is a contiguous range (… granularity, period_start BETWEEN).
    CONSTRAINT pk_metric_rollup PRIMARY KEY (user_id, tracker_id, activity_code, item_type, item_key, granularity, period_start),
    CONSTRAINT ck_metric_rollup__item_type CHECK (item_type IN ('P', 'M')),
    CONSTRAINT ck_metric_rollup__granularity CHECK (granularity IN ('DAY', 'WEEK', 'MONTH')),
    CONSTRAINT ck_metric_rollup__merge_kind CHECK (merge_kind IN ('SUM', 'MAX', 'MIN'))
);

-- Per-session metric values: S6 history search and the per-session view of a day (FR-ANL-11).
CREATE TABLE session_metric (
    user_id        UUID         NOT NULL,
    session_id     UUID         NOT NULL,
    activity_code  VARCHAR(80)  NOT NULL,
    metric_key     VARCHAR(64)  NOT NULL,
    tracker_id     UUID         NOT NULL,
    session_date   DATE         NOT NULL,
    session_name   VARCHAR(80)  NOT NULL,
    started_at     TIMESTAMPTZ  NOT NULL,
    num            NUMERIC,
    den            NUMERIC,
    value          NUMERIC,
    CONSTRAINT pk_session_metric PRIMARY KEY (user_id, session_id, activity_code, metric_key)
);
-- S6: "yorker accuracy ≥ 70 % in the last 6 months, best first" / "top 10 fastest sessions".
CREATE INDEX ix_session_metric__lookup ON session_metric (user_id, tracker_id, metric_key, value DESC, session_date DESC);
-- Day view: every session of one date for a tracker, in start order.
CREATE INDEX ix_session_metric__by_date ON session_metric (user_id, tracker_id, session_date, started_at);

CREATE TABLE personal_record (
    user_id        UUID         NOT NULL,
    tracker_id     UUID         NOT NULL,
    activity_code  VARCHAR(80)  NOT NULL,
    metric_key     VARCHAR(64)  NOT NULL,
    best_value     NUMERIC      NOT NULL,
    direction      VARCHAR(3)   NOT NULL,           -- MAX (fastest ball) or MIN (fastest 5K time)
    session_id     UUID         NOT NULL,
    session_date   DATE         NOT NULL,
    achieved_at    TIMESTAMPTZ  NOT NULL,
    CONSTRAINT pk_personal_record PRIMARY KEY (user_id, tracker_id, activity_code, metric_key),
    CONSTRAINT ck_personal_record__direction CHECK (direction IN ('MAX', 'MIN'))
);

CREATE TABLE streak (
    user_id       UUID NOT NULL,
    tracker_id    UUID NOT NULL,
    current_days  INT  NOT NULL DEFAULT 0,
    longest_days  INT  NOT NULL DEFAULT 0,
    last_active   DATE,
    CONSTRAINT pk_streak PRIMARY KEY (user_id, tracker_id)
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
CREATE INDEX ix_processed_event__processed_at ON processed_event (processed_at);
