-- v1.4 coaching (docs/12 §4): which trainer a session was assigned to; trainer charts read only these rows.
ALTER TABLE session_fact ADD COLUMN trainer_id UUID;
-- Trainer series and the trainee's tracker list for one trainer (FR-COA-08): ≤ one row per session.
CREATE INDEX ix_session_fact__trainer ON session_fact (trainer_id, user_id, tracker_id, session_date)
    WHERE trainer_id IS NOT NULL;
