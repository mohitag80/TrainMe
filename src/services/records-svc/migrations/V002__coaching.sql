-- v1.4 trainers and coaching (docs/12 §4). Columns and indexes on the partitioned parents apply to every partition.

ALTER TABLE activity_session ADD COLUMN trainer_id UUID;   -- optional trainer chosen at start (FR-COA-05)
ALTER TABLE activity_entry   ADD COLUMN recorded_by UUID;  -- who logged it; null = the owner (rows before v1.4)

-- Trainer dashboard "Live now" and the trainer's history, newest first; only sessions with a trainer are indexed.
CREATE INDEX ix_activity_session__trainer ON activity_session (trainer_id, status, session_date DESC)
    WHERE trainer_id IS NOT NULL AND deleted_at IS NULL;
-- One trainee's sessions with this trainer (trainee page, FR-COA-08).
CREATE INDEX ix_activity_session__trainer_trainee ON activity_session (trainer_id, user_id, session_date DESC)
    WHERE trainer_id IS NOT NULL AND deleted_at IS NULL;

-- Trainer feedback: a note on the whole session (client_entry_id null) or a comment on one entry (FR-COA-09).
CREATE TABLE session_feedback (
    id               UUID          NOT NULL,
    session_id       UUID          NOT NULL,
    session_date     DATE          NOT NULL,
    trainee_id       UUID          NOT NULL,
    author_id        UUID          NOT NULL,
    client_entry_id  UUID,
    body             VARCHAR(2000) NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT pk_session_feedback PRIMARY KEY (id),
    CONSTRAINT ck_session_feedback__body CHECK (length(btrim(body)) > 0)
);
-- All feedback of one session in writing order (session page).
CREATE INDEX ix_session_feedback__session ON session_feedback (session_id, created_at);
-- Erasure and trainee-wide clean-up.
CREATE INDEX ix_session_feedback__trainee ON session_feedback (trainee_id);
