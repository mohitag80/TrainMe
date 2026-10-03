# TrainMe – Implementation Conventions

| Item | Value |
|---|---|
| Version | 1.0 · 2026-10-03 |
| Scope | Naming, layout and coding rules for everything under `src/` |
| Related | `03_Low_Level_Design.md` (structure, DDL), `05_Prerequisites_Tools_and_Middleware.md` §3 (repository layout) |

These rules apply to every package. A pull request that breaks a rule must either fix it or change this document.

---

## 1. Toolchain (pinned)

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 LTS (`.nvmrc`), images `node:24.21-alpine` | ES modules everywhere (`"type": "module"`) |
| Package manager | pnpm 12 workspaces + Turborepo | `pnpm-workspace.yaml` lists `src/apps/*`, `src/services/*`, `src/libs/*` |
| TypeScript | 6.0.3 | Highest version supported by typescript-eslint; `module`/`moduleResolution` = `NodeNext` |
| Backend | NestJS 12 + Fastify adapter | Decorator metadata on (`experimentalDecorators`, `emitDecoratorMetadata`) |
| SQL | Kysely + `pg`, `CamelCasePlugin` | Raw SQL (`sql` tag) where the planner needs an exact shape |
| Validation | zod 4 (DTOs, env), Ajv 2020-12 (entry JSON Schemas) | |
| Events | KafkaJS against Redpanda / MSK | Wrapped in `@trainme/kafka`, so the client can be swapped |
| Tests | Vitest | Unit tests next to code (`*.test.ts`), integration tests in `test/` |
| Migrations | Plain SQL, Flyway naming, applied by `@trainme/db` migrator | Runs as a one-shot container / Kubernetes Job before the service starts |

## 2. Repository and package names

| Thing | Rule | Example |
|---|---|---|
| Service folder | `src/services/<bounded-context>-svc` | `src/services/records-svc` |
| Service package | `@trainme/<bounded-context>-svc` | `@trainme/records-svc` |
| Library folder / package | `src/libs/<name>` / `@trainme/<name>` | `src/libs/kafka` / `@trainme/kafka` |
| App folder / package | `src/apps/<name>` / `@trainme/<name>` | `src/apps/web` / `@trainme/web` |
| Container image | `<registry>/trainme-<package-suffix>:<git-sha>` | `ghcr.io/mohitag80/trainme-records-svc:3f9c2ab` |
| Helm release / k8s Service | same as the folder name | `records-svc` |

## 3. Source files and code

| Thing | Rule | Example |
|---|---|---|
| File names | kebab-case + role suffix | `session.controller.ts`, `session.repository.ts`, `session-started.consumer.ts` |
| Role suffixes | `.module` `.controller` `.service` (use case) `.repository` `.consumer` `.client` `.dto` `.entity` `.mapper` `.config` `.test` | |
| Layers (per service) | `api/` → `application/` → `domain/` ← `infrastructure/` | `domain/` imports no framework code |
| Classes, types, enums | PascalCase | `SessionRepository`, `SessionStatus` |
| Functions, variables | camelCase, verbs for functions | `startSession`, `nameKey` |
| Constants | UPPER_SNAKE_CASE | `MAX_ENTRIES_PER_BATCH` |
| Booleans | `is/has/can` prefix | `isAutoClosed` |
| Relative imports | always with `.js` extension (NodeNext) | `import { x } from './x.js'` |
| Function docs | JSDoc only when the name is not enough; 2–3 lines, ≤ 50 words, says *why*/contract, not *how* | see any `*.repository.ts` |
| Errors | throw `ProblemError` from `@trainme/errors`; never return error objects | `throw ProblemError.conflict('session-name-taken', …)` |
| Logging | `@trainme/observability` pino logger; structured fields, never string concatenation; no PII (email, names) in logs | `log.info({ sessionId }, 'session completed')` |

## 4. HTTP APIs

| Thing | Rule | Example |
|---|---|---|
| Base path | `/api/v1` | `/api/v1/sessions` |
| Resources | plural nouns, kebab-case | `/display-units`, `/sessions/{id}/entries:batch` |
| Custom actions | `:verb` suffix or sub-resource (as in the LLD) | `POST /sessions/{id}/complete` |
| JSON fields | camelCase | `sessionDate`, `clientSessionId` |
| Dates / times | `YYYY-MM-DD` for local dates, RFC 3339 UTC for instants | `"2026-10-03"`, `"2026-10-03T01:20:00Z"` |
| Errors | RFC 9457 `application/problem+json`, `type` = `https://trainme.app/problems/<slug>` | `…/problems/session-name-taken` |
| Pagination | cursor: `?limit=50&cursor=…` → `{ items, nextCursor }` | |
| Concurrency | `ETag` / `If-Match` with `row_version` | `If-Match: "3"` |
| Health | `/health/live`, `/health/ready` (outside `/api/v1`) | |
| Container port | `8080` for every service; Kong is the only public entry (`8000`) | |

## 5. Database

| Thing | Rule | Example |
|---|---|---|
| Database / role per service | `<context>_db` owned by role `<context>_svc` | `records_db` / `records_svc` |
| Tables | singular snake_case | `activity_session`, `metric_rollup` |
| Columns | snake_case; `*_id` for references, `*_at` for instants (`TIMESTAMPTZ`), `*_date` for local dates (`DATE`), `is_*` for booleans | `started_at`, `session_date`, `is_auto_closed` |
| Primary key | `pk_<table>` | `pk_activity_session` |
| Unique | `uq_<table>__<col>[_<col>]` | `uq_activity_session__user_id_session_date_name_key` (long names are shortened, see below) |
| Foreign key | `fk_<table>__<referenced_table>` | `fk_activity_entry__activity_session` |
| Check | `ck_<table>__<col>` | `ck_activity_session__status` |
| Index | `ix_<table>__<cols>`; partial indexes describe the filter in a comment | `ix_activity_entry__user_activity_date` |
| Name length | PostgreSQL limit is 63 bytes; abbreviate columns in the name, never the table | |
| IDs | UUIDv7 generated in the application (`@trainme/db` `newId()`) | |
| Migrations | `migrations/V<NNN>__<snake_description>.sql`, forward-only, expand/contract | `V001__records_schema.sql` |
| Every DB | has `outbox_event` (if it publishes) and `processed_event` (if it consumes) | |
| Queries | every user-data query is `user_id`-scoped and, for partitioned tables, `session_date`-bounded; a new query ships with its `EXPLAIN` checked against the intended index | |

## 6. Events (Kafka)

| Thing | Rule | Example |
|---|---|---|
| Topic | `<domain>.events` (commands: `<domain>.commands`, dead letters: `<topic>.dlq`) | `record.events` |
| Event type | `<domain>[.<aggregate>].<past-tense-verb>`; the aggregate is omitted when it equals the domain (LLD §5 names) | `record.session.completed`, `user.registered` |
| Envelope | CloudEvents 1.0 JSON; `source` = `trainme/<package-suffix>` | `trainme/records-svc` |
| Key | `user_id` (per-user ordering) | |
| Consumer group | `<package-suffix>.<purpose>` | `analytics-svc.rollups` |
| Publishing | only through the transactional outbox | |

## 7. Configuration and secrets

| Thing | Rule | Example |
|---|---|---|
| Env vars | UPPER_SNAKE_CASE, validated with zod at boot; the same names in every environment | `DATABASE_URL`, `KAFKA_BROKERS`, `REDIS_URL`, `OIDC_ISSUER_URL` |
| Secrets | never in Git; `.env` (local, git-ignored), Sealed Secrets (k3s), Secrets Manager (AWS) | |
| Redis keys | `<service-prefix>:<entity>:<id>[:<qualifier>]` | `trk:schema:<trackerId>:v3` |

## 8. Test environment fixtures

- Keycloak realm `trainme` is imported at startup with dummy users (`*@trainme.test`, password `Passw0rd!`) for each role. See `src/deploy/charts/trainme-platform/files/KEYCLOAK.md` (one realm file for Compose and k3s).
- Payments use the `MOCK` provider: checkout redirects to a mock page that posts a signed webhook, exercising the same code path as Stripe/Razorpay.
