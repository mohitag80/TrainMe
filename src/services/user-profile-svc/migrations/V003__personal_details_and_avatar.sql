-- v1.5 personal details (FR-PRF-01): the Profile page identifies the person; units and time zone moved to Settings.
-- display_name stays (other users and events see it) and is kept as "first last" whenever the names change.

ALTER TABLE user_profile
    ADD COLUMN first_name        VARCHAR(60),
    ADD COLUMN middle_name       VARCHAR(60),
    ADD COLUMN last_name         VARCHAR(60),
    ADD COLUMN mobile            VARCHAR(20),
    ADD COLUMN address_line1     VARCHAR(120),
    ADD COLUMN address_line2     VARCHAR(120),
    ADD COLUMN city              VARCHAR(80),
    ADD COLUMN state             VARCHAR(80),
    ADD COLUMN postal_code       VARCHAR(16),
    ADD COLUMN country           VARCHAR(80),
    ADD COLUMN avatar_updated_at TIMESTAMPTZ;

-- Existing profiles: best guess from the display name ("Meera Lifter" → Meera / Lifter); users can correct it.
UPDATE user_profile
   SET first_name = left(split_part(display_name, ' ', 1), 60),
       last_name  = NULLIF(left(btrim(substr(display_name, length(split_part(display_name, ' ', 1)) + 1)), 60), '')
 WHERE first_name IS NULL AND deleted_at IS NULL;

-- Profile picture: one small image per user (the web app crops and shrinks it to 256 px before upload).
-- Kept out of user_profile so profile reads never carry the bytes.
CREATE TABLE user_avatar (
    user_id       UUID         NOT NULL,
    content_type  VARCHAR(20)  NOT NULL,
    data          BYTEA        NOT NULL,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_avatar PRIMARY KEY (user_id),
    CONSTRAINT fk_user_avatar__user_profile FOREIGN KEY (user_id) REFERENCES user_profile (id) ON DELETE CASCADE,
    CONSTRAINT ck_user_avatar__content_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT ck_user_avatar__size CHECK (octet_length(data) <= 153600)
);
