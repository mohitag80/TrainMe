-- catalog_db: reusable activity library, versioned templates, unit registry and search document.
-- LLD §2.1, 08_Search_and_Query_Performance.md §4.1. Published versions are immutable.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Immutable wrapper so unaccent() can be used in generated columns and expression indexes.
CREATE FUNCTION f_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- array_to_string() is only STABLE; for text[] it is safe to declare IMMUTABLE (generated columns, indexes).
CREATE FUNCTION f_array_text(text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT array_to_string($1, ' ') $$;

-- ------------------------------------------------------------------ unit registry (ADR-014)
CREATE TABLE unit_dimension (
    code       VARCHAR(16) NOT NULL,
    name       VARCHAR(40) NOT NULL,
    base_unit  VARCHAR(16) NOT NULL,
    CONSTRAINT pk_unit_dimension PRIMARY KEY (code)
);

CREATE TABLE unit (
    code         VARCHAR(16) NOT NULL,
    dimension    VARCHAR(16),
    label        VARCHAR(40) NOT NULL,
    to_base      NUMERIC(30, 15),
    system       VARCHAR(8)  NOT NULL DEFAULT 'BOTH',
    counterpart  VARCHAR(16),
    decimals     SMALLINT    NOT NULL DEFAULT 1,
    step         NUMERIC,
    CONSTRAINT pk_unit PRIMARY KEY (code),
    CONSTRAINT fk_unit__unit_dimension FOREIGN KEY (dimension) REFERENCES unit_dimension (code),
    CONSTRAINT fk_unit__counterpart FOREIGN KEY (counterpart) REFERENCES unit (code) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT ck_unit__system CHECK (system IN ('METRIC', 'IMPERIAL', 'BOTH')),
    CONSTRAINT ck_unit__to_base CHECK ((dimension IS NULL) = (to_base IS NULL))
);

-- ------------------------------------------------------------------ taxonomy
CREATE TABLE category (
    id          UUID         NOT NULL,
    parent_id   UUID,
    code        VARCHAR(80)  NOT NULL,              -- e.g. cricket.fast_bowler
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    level       SMALLINT     NOT NULL,
    kind        VARCHAR(16)  NOT NULL DEFAULT 'AREA',
    sort_order  INT          NOT NULL DEFAULT 0,
    status      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    source      VARCHAR(16)  NOT NULL DEFAULT 'SEED', -- seed never overwrites ADMIN rows
    i18n        JSONB        NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_category PRIMARY KEY (id),
    CONSTRAINT uq_category__code UNIQUE (code),
    CONSTRAINT fk_category__parent FOREIGN KEY (parent_id) REFERENCES category (id),
    CONSTRAINT ck_category__level CHECK (level BETWEEN 1 AND 6),
    CONSTRAINT ck_category__kind CHECK (kind IN ('DOMAIN','SPORT','ROLE_GROUP','ROLE','DISCIPLINE','MUSCLE_GROUP','MUSCLE','AREA')),
    CONSTRAINT ck_category__status CHECK (status IN ('ACTIVE', 'RETIRED')),
    CONSTRAINT ck_category__source CHECK (source IN ('SEED', 'ADMIN', 'IMPORT'))
);
-- Children of a node in display order (tree browsing).
CREATE INDEX ix_category__parent_sort ON category (parent_id, sort_order);

-- ------------------------------------------------------------------ reusable parameter sets
CREATE TABLE parameter_set (
    id            UUID         NOT NULL,
    code          VARCHAR(64)  NOT NULL,
    version       INT          NOT NULL,
    name          VARCHAR(120) NOT NULL,
    description   TEXT,
    content_hash  CHAR(64)     NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_parameter_set PRIMARY KEY (id),
    CONSTRAINT uq_parameter_set__code_version UNIQUE (code, version)
);

-- ------------------------------------------------------------------ activity library
CREATE TABLE activity_definition (
    id                UUID         NOT NULL,
    code              VARCHAR(80)  NOT NULL,
    version           INT          NOT NULL,
    name              VARCHAR(160) NOT NULL,
    kind              VARCHAR(12)  NOT NULL,
    recording_mode    VARCHAR(16)  NOT NULL,
    grouping          JSONB,                        -- {"label":"Over","size":6}
    max_entries       INT          NOT NULL DEFAULT 500,
    category_codes    TEXT[]       NOT NULL DEFAULT '{}',
    sports            TEXT[]       NOT NULL DEFAULT '{}',
    roles             TEXT[]       NOT NULL DEFAULT '{}',
    equipment         TEXT[]       NOT NULL DEFAULT '{}',
    primary_muscles   TEXT[]       NOT NULL DEFAULT '{}',
    secondary_muscles TEXT[]       NOT NULL DEFAULT '{}',
    mechanic          VARCHAR(12),
    force             VARCHAR(12),
    level             VARCHAR(12),
    synonyms          TEXT[]       NOT NULL DEFAULT '{}',
    description       TEXT,
    status            VARCHAR(16)  NOT NULL DEFAULT 'PUBLISHED',
    source            VARCHAR(16)  NOT NULL DEFAULT 'SEED',
    license           VARCHAR(40),
    content_hash      CHAR(64)     NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_activity_definition PRIMARY KEY (id),
    CONSTRAINT uq_activity_definition__code_version UNIQUE (code, version),
    CONSTRAINT ck_activity_definition__kind CHECK (kind IN ('EXERCISE','DRILL','TEST','MATCH','LOG')),
    CONSTRAINT ck_activity_definition__recording_mode CHECK (recording_mode IN ('PER_SESSION','PER_SET','PER_ATTEMPT')),
    CONSTRAINT ck_activity_definition__status CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
    CONSTRAINT ck_activity_definition__source CHECK (source IN ('SEED','ADMIN','IMPORT')),
    CONSTRAINT ck_activity_definition__max_entries CHECK (max_entries BETWEEN 1 AND 5000)
);

CREATE TABLE activity_parameter_set (
    activity_id       UUID NOT NULL,
    parameter_set_id  UUID NOT NULL,
    sort_order        INT  NOT NULL DEFAULT 0,
    CONSTRAINT pk_activity_parameter_set PRIMARY KEY (activity_id, parameter_set_id),
    CONSTRAINT fk_activity_parameter_set__activity_definition FOREIGN KEY (activity_id) REFERENCES activity_definition (id) ON DELETE CASCADE,
    CONSTRAINT fk_activity_parameter_set__parameter_set FOREIGN KEY (parameter_set_id) REFERENCES parameter_set (id)
);
CREATE INDEX ix_activity_parameter_set__parameter_set_id ON activity_parameter_set (parameter_set_id);

-- A parameter belongs to exactly one owner: an activity version or a parameter-set version.
CREATE TABLE parameter_definition (
    id                UUID         NOT NULL,
    activity_id       UUID,
    parameter_set_id  UUID,
    key               VARCHAR(64)  NOT NULL,
    label             VARCHAR(120) NOT NULL,
    data_type         VARCHAR(16)  NOT NULL,
    unit              VARCHAR(16),                  -- canonical storage unit
    dimension         VARCHAR(16),
    allowed_units     TEXT[],
    constraints       JSONB        NOT NULL DEFAULT '{}',
    condition         JSONB,
    default_agg       VARCHAR(16)  NOT NULL DEFAULT 'AVG',
    is_required       BOOLEAN      NOT NULL DEFAULT false,
    description       TEXT,
    sort_order        INT          NOT NULL DEFAULT 0,
    CONSTRAINT pk_parameter_definition PRIMARY KEY (id),
    CONSTRAINT fk_parameter_definition__activity_definition FOREIGN KEY (activity_id) REFERENCES activity_definition (id) ON DELETE CASCADE,
    CONSTRAINT fk_parameter_definition__parameter_set FOREIGN KEY (parameter_set_id) REFERENCES parameter_set (id) ON DELETE CASCADE,
    CONSTRAINT fk_parameter_definition__unit FOREIGN KEY (unit) REFERENCES unit (code),
    CONSTRAINT fk_parameter_definition__unit_dimension FOREIGN KEY (dimension) REFERENCES unit_dimension (code),
    CONSTRAINT ck_parameter_definition__owner CHECK (num_nonnulls(activity_id, parameter_set_id) = 1),
    CONSTRAINT ck_parameter_definition__key CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    CONSTRAINT ck_parameter_definition__data_type CHECK (data_type IN ('INT','DECIMAL','BOOL','ENUM','TEXT','DURATION')),
    CONSTRAINT ck_parameter_definition__default_agg CHECK (default_agg IN ('SUM','AVG','MIN','MAX','COUNT','COUNT_TRUE','PCT_TRUE','NONE')),
    CONSTRAINT uq_parameter_definition__owner_key UNIQUE NULLS NOT DISTINCT (activity_id, parameter_set_id, key)
);
-- uq_parameter_definition__owner_key serves lookups by activity_id; parameter-set lookups need their own index.
CREATE INDEX ix_parameter_definition__parameter_set_id ON parameter_definition (parameter_set_id) WHERE parameter_set_id IS NOT NULL;

CREATE TABLE metric_definition (
    id                UUID         NOT NULL,
    activity_id       UUID,
    parameter_set_id  UUID,
    key               VARCHAR(64)  NOT NULL,
    label             VARCHAR(120) NOT NULL,
    kind              VARCHAR(8)   NOT NULL,
    numerator         JSONB        NOT NULL,
    denominator       JSONB,
    display           JSONB        NOT NULL DEFAULT '{}',
    sort_order        INT          NOT NULL DEFAULT 0,
    CONSTRAINT pk_metric_definition PRIMARY KEY (id),
    CONSTRAINT fk_metric_definition__activity_definition FOREIGN KEY (activity_id) REFERENCES activity_definition (id) ON DELETE CASCADE,
    CONSTRAINT fk_metric_definition__parameter_set FOREIGN KEY (parameter_set_id) REFERENCES parameter_set (id) ON DELETE CASCADE,
    CONSTRAINT ck_metric_definition__owner CHECK (num_nonnulls(activity_id, parameter_set_id) = 1),
    CONSTRAINT ck_metric_definition__kind CHECK (kind IN ('RATIO','SINGLE')),
    CONSTRAINT ck_metric_definition__ratio_has_denominator CHECK ((kind = 'RATIO') = (denominator IS NOT NULL)),
    CONSTRAINT uq_metric_definition__owner_key UNIQUE NULLS NOT DISTINCT (activity_id, parameter_set_id, key)
);
CREATE INDEX ix_metric_definition__parameter_set_id ON metric_definition (parameter_set_id) WHERE parameter_set_id IS NOT NULL;

-- ------------------------------------------------------------------ profile templates
CREATE TABLE profile_template (
    id            UUID         NOT NULL,
    category_id   UUID         NOT NULL,
    code          VARCHAR(80)  NOT NULL,
    version       INT          NOT NULL,
    name          VARCHAR(120) NOT NULL,
    description   TEXT,
    status        VARCHAR(16)  NOT NULL,
    owner_type    VARCHAR(16)  NOT NULL DEFAULT 'SYSTEM',
    owner_id      UUID,
    source        VARCHAR(16)  NOT NULL DEFAULT 'SEED',
    content_hash  CHAR(64)     NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    CONSTRAINT pk_profile_template PRIMARY KEY (id),
    CONSTRAINT uq_profile_template__code_version UNIQUE (code, version),   -- also serves "latest version of <code>"
    CONSTRAINT fk_profile_template__category FOREIGN KEY (category_id) REFERENCES category (id),
    CONSTRAINT ck_profile_template__status CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
    CONSTRAINT ck_profile_template__owner_type CHECK (owner_type IN ('SYSTEM','COACH','USER')),
    CONSTRAINT ck_profile_template__source CHECK (source IN ('SEED','ADMIN','IMPORT'))
);
-- Published templates of one category (category page).
CREATE INDEX ix_profile_template__category_published ON profile_template (category_id, code) WHERE status = 'PUBLISHED';

CREATE TABLE template_activity (
    profile_template_id  UUID  NOT NULL,
    activity_id          UUID  NOT NULL,
    sort_order           INT   NOT NULL DEFAULT 0,
    targets              JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT pk_template_activity PRIMARY KEY (profile_template_id, activity_id),
    CONSTRAINT fk_template_activity__profile_template FOREIGN KEY (profile_template_id) REFERENCES profile_template (id) ON DELETE CASCADE,
    CONSTRAINT fk_template_activity__activity_definition FOREIGN KEY (activity_id) REFERENCES activity_definition (id)
);
-- "Which templates use this activity" and FK checks on activity deletes.
CREATE INDEX ix_template_activity__activity_id ON template_activity (activity_id);

-- ------------------------------------------------------------------ search document (08 §4.1)
CREATE TABLE catalog_search_doc (
    item_type   VARCHAR(12)  NOT NULL,
    item_code   VARCHAR(120) NOT NULL,
    locale      VARCHAR(10)  NOT NULL DEFAULT 'en',
    name        TEXT         NOT NULL,
    synonyms    TEXT[]       NOT NULL DEFAULT '{}',
    description TEXT,
    kind        VARCHAR(16),
    sports      TEXT[]       NOT NULL DEFAULT '{}',
    roles       TEXT[]       NOT NULL DEFAULT '{}',
    categories  TEXT[]       NOT NULL DEFAULT '{}',  -- ancestor path codes: "gym.legs" finds quads items
    muscles     TEXT[]       NOT NULL DEFAULT '{}',
    equipment   TEXT[]       NOT NULL DEFAULT '{}',
    level       VARCHAR(12),
    popularity  INT          NOT NULL DEFAULT 0,
    status      VARCHAR(12)  NOT NULL DEFAULT 'PUBLISHED',
    search_tsv  tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('simple', f_unaccent(name)), 'A') ||
                    setweight(to_tsvector('simple', f_unaccent(coalesce(f_array_text(synonyms), ''))), 'B') ||
                    setweight(to_tsvector('simple', f_unaccent(coalesce(f_array_text(sports || roles || muscles || equipment), ''))), 'C') ||
                    setweight(to_tsvector('english', coalesce(description, '')), 'D')) STORED,
    -- Lower-cased, unaccented words of name, synonyms and facets for trigram matching.
    search_text TEXT GENERATED ALWAYS AS (
                    f_unaccent(lower(name || ' ' || coalesce(f_array_text(synonyms), '') || ' ' ||
                                     coalesce(f_array_text(muscles || equipment || sports || roles || categories), '')))) STORED,
    CONSTRAINT pk_catalog_search_doc PRIMARY KEY (item_type, item_code, locale),
    CONSTRAINT ck_catalog_search_doc__item_type CHECK (item_type IN ('CATEGORY','TEMPLATE','ACTIVITY'))
);
CREATE INDEX ix_catalog_search_doc__tsv ON catalog_search_doc USING GIN (search_tsv);
-- Fuzzy, typo-tolerant matching: every query word must match a word of search_text (strict word similarity).
CREATE INDEX ix_catalog_search_doc__search_text_trgm ON catalog_search_doc USING GIN (search_text gin_trgm_ops);
-- Autocomplete: substring match on the name.
CREATE INDEX ix_catalog_search_doc__name_trgm ON catalog_search_doc USING GIN (f_unaccent(lower(name)) gin_trgm_ops);
CREATE INDEX ix_catalog_search_doc__facets ON catalog_search_doc USING GIN (sports, roles, categories, muscles, equipment);

-- ------------------------------------------------------------------ seeding, audit, outbox
CREATE TABLE catalog_seed_run (
    content_hash  CHAR(64)    NOT NULL,
    version       VARCHAR(40) NOT NULL,
    stats         JSONB       NOT NULL DEFAULT '{}',
    applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_catalog_seed_run PRIMARY KEY (content_hash)
);

CREATE TABLE catalog_audit (
    id           UUID        NOT NULL,
    actor_id     UUID        NOT NULL,
    action       VARCHAR(32) NOT NULL,
    entity_type  VARCHAR(32) NOT NULL,
    entity_code  VARCHAR(120) NOT NULL,
    details      JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_catalog_audit PRIMARY KEY (id)
);
-- History of one item, newest first.
CREATE INDEX ix_catalog_audit__entity ON catalog_audit (entity_type, entity_code, created_at DESC);

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
-- Relay scan: only unpublished rows, oldest first; stays tiny because published rows leave the index.
CREATE INDEX ix_outbox_event__unpublished ON outbox_event (created_at) WHERE published_at IS NULL;
