-- v1.4 trainers and coaching (docs/12 §4): self-registered trainers and trainer ↔ trainee connections.

ALTER TABLE user_profile
    ADD COLUMN is_trainer          BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN trainer_bio         VARCHAR(500),
    ADD COLUMN trainer_specialties TEXT[]       NOT NULL DEFAULT '{}';

-- Trainer search (FR-COA-02): only live trainers, by name (trigram) – tiny compared with all users.
CREATE INDEX ix_user_profile__trainer_name ON user_profile USING GIN (lower(display_name) gin_trgm_ops)
    WHERE is_trainer AND deleted_at IS NULL;

CREATE TABLE trainer_connection (
    id            UUID         NOT NULL,
    trainer_id    UUID         NOT NULL,
    trainee_id    UUID         NOT NULL,
    status        VARCHAR(12)  NOT NULL,
    requested_by  UUID         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    responded_at  TIMESTAMPTZ,
    ended_at      TIMESTAMPTZ,
    ended_by      UUID,
    CONSTRAINT pk_trainer_connection PRIMARY KEY (id),
    CONSTRAINT fk_trainer_connection__trainer FOREIGN KEY (trainer_id) REFERENCES user_profile (id),
    CONSTRAINT fk_trainer_connection__trainee FOREIGN KEY (trainee_id) REFERENCES user_profile (id),
    CONSTRAINT ck_trainer_connection__status CHECK (status IN ('PENDING', 'ACTIVE', 'DECLINED', 'ENDED')),
    CONSTRAINT ck_trainer_connection__not_self CHECK (trainer_id <> trainee_id)
);
-- One open (pending or active) connection per pair; declined/ended rows stay as history.
CREATE UNIQUE INDEX uq_trainer_connection__open_pair ON trainer_connection (trainer_id, trainee_id)
    WHERE status IN ('PENDING', 'ACTIVE');
-- "My trainers" and "my trainees" lists, plus the records-svc active-connection check.
CREATE INDEX ix_trainer_connection__trainee ON trainer_connection (trainee_id, status);
CREATE INDEX ix_trainer_connection__trainer ON trainer_connection (trainer_id, status);
