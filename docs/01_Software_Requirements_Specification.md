# TrainMe – Software Requirements Specification (SRS)

| Item | Value |
|---|---|
| Product | TrainMe – personal activity, training and diet tracker |
| Document | Software Requirements Specification |
| Version | 1.3 – named sessions (many per day), editable units of measure (1.2 Phase 1 catalog, search for 10K users; 1.1 granular live sessions; 1.0 baseline) |
| Date | 2026-10-03 |
| Source | `Product_requirements.txt` |
| Status | Draft for review |

---

## 1. Introduction

### 1.1 Purpose
This document turns the product brief in `Product_requirements.txt` into a complete set of numbered, testable **functional** and **non-functional requirements**. These requirements drive the High-Level Design (`02`), Low-Level Design (`03`), deployment design (`04`) and test strategy (`06`).

### 1.2 Product vision
Subscribed users track **any kind of daily work**: gym workouts, diet, sports practice sessions and so on. They pick a **pre-defined profile** from a catalog (for example *Sports › Cricket › Bowler*). The activities and parameters for that profile load automatically, and users can **customise** them. They record values every day and see **daily / weekly / monthly charts** of their progress on **mobile and laptop**.

### 1.3 Scope
**In scope (v1 / Beta)**
- Mobile apps (iOS, Android) and responsive web app from day 1.
- User registration, login, profile and subscription management.
- Hierarchical activity catalog (category → discipline → profile template → activities → parameters).
- Personal trackers created from templates, with user-defined parameters.
- Daily session recording, including offline capture on mobile.
- Charts and progress analytics (daily, weekly, monthly; personal records; streaks).
- Reminders (push / email).
- Admin console for catalog curation.
- Microservices platform on Kubernetes: **k3s** for test, **AWS (EKS)** for beta.

**Out of scope for v1 (future candidates)**
- Coach/team accounts and sharing an athlete's dashboard with a coach.
- Wearable / device integrations (Apple Health, Google Fit, Garmin, radar guns).
- Social feed, leaderboards, challenges.
- AI insights and recommendations.
- Video upload and analysis of technique.
- Marketplace for coach-authored templates.

The design keeps extension points for each of these (see HLD §10).

### 1.4 Definitions

| Term | Meaning |
|---|---|
| **Category** | Top-level and second-level grouping in the catalog (e.g. *Sports*, *Cricket*, *Fitness*, *Gym*, *Nutrition*). |
| **Profile template** | A versioned, curated set of activities for a role or goal (e.g. *Bowler*, *Strength Training*, *Daily Meal Log*). |
| **Activity** | A thing that is recorded inside a template (e.g. *Delivery*, *Bench Press*, *Meal*). Has a **recording mode**. |
| **Recording mode** | `PER_SESSION` (one row per session), `PER_SET` (one row per set), `PER_ATTEMPT` (one row per ball / meal / attempt). |
| **Parameter** | A typed measurable field of an activity (e.g. `speed_kmph` DECIMAL, `yorker` BOOL, `reps` INT). |
| **Unit / dimension** | A parameter measures a **dimension** (speed, mass, length, duration, energy, volume). Values are **stored** in one canonical unit per parameter (e.g. km/h, kg) and **shown** in the unit the user picks (mph, lb, g …). Counts such as reps, bpm and % have no alternative units. |
| **Tracker** | A user's personal instance of a template plus their overrides. |
| **Override** | User customisation: ADD / MODIFY / HIDE an activity or parameter, without changing the shared template. |
| **Effective schema** | Template version ⊕ overrides, compiled to JSON Schema; drives forms and validation. |
| **Session** | One practice or workout on one tracker, identified for the user by **session date + session name** (e.g. *3 Oct 2026 · Morning Nets*). A user can have any number of sessions per day, on the same or different trackers. Lifecycle `IN_PROGRESS → COMPLETED` (or `DISCARDED`), containing entries and values. |
| **Entry** | One granular record inside a session: a ball, a set, a lap, a shot, a food item. Carries many parameter values. |
| **Checkpoint** | A periodic background sync (every 3–5 min) that uploads new/edited entries of an in-progress session. |
| **Condition** | Rule making a parameter visible/required only when another value matches (e.g. `yorker_accurate` when `yorker_attempted = true`). |
| **Metric** | Catalog-defined chart value: `RATIO` (Σ numerator ÷ Σ denominator) or `SINGLE`, built from `COUNT`, `COUNT_TRUE`, `SUM` with optional filters. |
| **Rollup** | Pre-aggregated statistics per user / tracker / parameter / period (DAY, WEEK, MONTH). |

### 1.5 Stakeholders and personas

| Persona | Description | Key goals |
|---|---|---|
| **Member / Athlete** | Paying or trial user (gym-goer, cricketer, dieter, runner). | Fast data entry (often mid-workout, poor connectivity), clear progress charts, personalise what is tracked. |
| **Content Curator / Admin** | Internal staff who maintain the catalog. | Publish new categories, templates and parameters without a code release. |
| **Support Agent** | Handles user tickets. | Look up account, subscription and sync status without seeing more personal data than needed. |
| **Ops / SRE** | Runs the platform. | Observability, safe deployments, scaling, incident response. |
| **Product Owner** | Owns the roadmap. | Usage analytics, conversion, feature flags. |

### 1.6 Assumptions and constraints
- **A1** Users have a smartphone (iOS 15+ / Android 8+) or a modern browser.
- **A2** Payments go through a PCI-DSS compliant provider (Stripe / Razorpay, App Store / Play billing for in-app purchases). TrainMe never stores card data.
- **A3** Test environment = a single k3s instance; Beta = AWS. Both run the **same container images and Helm charts**.
- **A4** Initial market is configurable; the region shown in diagrams (`ap-south-1`) is an example.
- **C1** Microservices architecture with independently scalable components (brief, TR-1).
- **C2** Must serve mobile apps from day 1 (brief, TR-4).
- **C3** Flexible data model for arbitrary activities and parameters (brief, TR-2, TR-8, TR-9).

---

## 2. Functional Requirements

Priority uses **MoSCoW** (M = Must, S = Should, C = Could). Each requirement has acceptance criteria (AC).

### 2.1 Identity, Authentication & Authorization (IAM)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-IAM-01 | Users can sign up with email + password, with email verification. | M | Verification email delivered < 1 min; unverified accounts cannot record data after 7 days. |
| FR-IAM-02 | Users can sign in with **Google** and **Apple** (Apple mandatory on iOS when any social login exists). | M | OIDC federation via IdP; accounts linked by verified email. |
| FR-IAM-03 | Mobile and web use **OAuth 2.1 Authorization Code + PKCE**; access tokens are short-lived JWTs (≤ 15 min) with rotating refresh tokens. | M | Refresh token reuse invalidates the token family; logout revokes refresh tokens. |
| FR-IAM-04 | Optional **MFA** (TOTP / passkeys) for members; mandatory for admins. | S / M | Admin login without MFA is rejected. |
| FR-IAM-05 | Password reset via time-limited email link. | M | Link expires in 30 min, single-use. |
| FR-IAM-06 | **Role-based access control**: `member`, `curator`, `support`, `admin`. | M | Each API enforces role and resource ownership (a member can only access own data). |
| FR-IAM-07 | Account lock-out / throttling after repeated failed logins. | M | 5 failures → progressive delay; alert on credential stuffing patterns. |
| FR-IAM-08 | Users can see and revoke active sessions/devices. | S | Revoked device can no longer refresh tokens. |

### 2.2 User Profile (PRF)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-PRF-01 | Users create/edit a profile: display name, avatar, date of birth, gender (optional), height, weight, unit preferences (FR-PRF-06), timezone, locale. | M | Values validated; unit switch converts display only, never stored values. |
| FR-PRF-02 | Users choose one or more interests (e.g. Gym, Cricket, Diet) during onboarding to personalise the catalog. | S | Onboarding recommends matching templates. |
| FR-PRF-03 | Users can **export** all their data (JSON / CSV). | M | Export ready within 24 h, download link valid 7 days. |
| FR-PRF-04 | Users can **delete** their account and all personal data (right to erasure). | M | Personal data removed or crypto-shredded within 30 days; confirmation email sent. |
| FR-PRF-05 | Users manage notification preferences (push, email, quiet hours). | S | Preferences honoured by notification service. |
| FR-PRF-06 | Users set **Metric or Imperial per dimension**: speed (km/h ↔ mph), weight (kg ↔ lb, g ↔ oz), distance (km ↔ mi, m ↔ yd, cm ↔ in), volume (ml ↔ fl oz, l ↔ qt), pace (min/km ↔ min/mi). One switch sets all dimensions at once; each can then be changed individually (e.g. Imperial speed with Metric weight). Units such as grams vs kilograms, stone or m/s are chosen per parameter (FR-TRK-09). | M | Switching weight to Imperial changes every form, chart, personal record and export from kg to lb immediately; no stored value changes. |

### 2.3 Subscription & Billing (SUB)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-SUB-01 | Plans are configurable data (e.g. **Free**, **Pro**, **Elite**) with entitlements: max active trackers, custom parameters allowed, history range, export, reminders. | M | New plan created by admin without deployment. |
| FR-SUB-02 | Users can start a **free trial**, subscribe, upgrade, downgrade and cancel. | M | State machine: TRIALING → ACTIVE → PAST_DUE → CANCELED; proration handled by provider. |
| FR-SUB-03 | Web checkout via Stripe / Razorpay; mobile via App Store / Google Play in-app purchase where store rules require. | M | Store receipts verified server-side. |
| FR-SUB-04 | Payment provider **webhooks** update subscription state, idempotently. | M | Duplicate webhook does not double-apply; signature verified. |
| FR-SUB-05 | Entitlements are enforced on every relevant API (create tracker, add custom parameter, query long history, export). | M | Exceeding a limit returns `403` with an upgrade hint. |
| FR-SUB-06 | Users see invoices / receipts and renewal date. | S | Data shown from provider. |
| FR-SUB-07 | Grace period on failed renewal; downgrade keeps data read-only beyond plan limits. | S | No data is deleted on downgrade. |

### 2.4 Activity Catalog (CAT)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-CAT-01 | Catalog is a **hierarchy**: Category (L1) → Discipline (L2) → Profile template (L3), e.g. *Sports › Cricket › Bowler*, *Fitness › Gym › Strength Training*, *Nutrition › Diet › Daily Meal Log*. | M | Unlimited depth supported in the model; UI shows 3 levels. |
| FR-CAT-02 | A profile template contains **activities**, each with a recording mode. **Every activity can be recorded at entry level**: `PER_ATTEMPT` (ball, shot, food item) or `PER_SET` (set, lap, round). `PER_SESSION` summaries remain available. The same model applies to every profile. | M | Fast Bowler › *Delivery* is PER_ATTEMPT (one entry per ball, e.g. 50 per session); Gym › Bench Press is PER_SET; Diet › Food item is PER_ATTEMPT. |
| FR-CAT-03 | Each activity has **typed parameters**: `INT`, `DECIMAL`, `BOOL`, `ENUM`, `TEXT`, `DURATION`; with unit, min/max, enum options, required flag, display order and default aggregation (`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `COUNT_TRUE`, `PCT_TRUE`). | M | Fast Bowler per-ball parameters: speed (DECIMAL km/h), line (ENUM), yorker_attempted / yorker_accurate, seam_attempted / seam_accurate, bouncer_attempted / bouncer_accurate (BOOL), no_ball, wide (BOOL). Gym per set: reps (INT), weight (DECIMAL kg), rpe (INT). |
| FR-CAT-04 | Templates are **versioned** (DRAFT → PUBLISHED → RETIRED). Publishing a new version never breaks existing trackers or historical records. | M | Existing trackers keep their version until the user accepts an upgrade. |
| FR-CAT-05 | Users can **browse and search** the catalog (by name, category, tags). | M | Search results < 300 ms p95. |
| FR-CAT-12 | Catalog search supports **keywords with typo tolerance and synonyms** ("pushup" → Push-up, "OHP" → Overhead Press), **autocomplete**, and **facets**: sport, role, category (incl. ancestors, e.g. Legs → Quads), kind, equipment, primary/secondary muscle, level. | M | "dumbell chest beginner" returns Dumbbell Bench Press / Fly first. |
| FR-CAT-13 | Phase 1 catalog content is **seeded automatically** on deployment from a versioned, validated seed file; re-seeding is idempotent, never overwrites curator edits, and versions changed templates. | M | See `07_Phase1_Activity_Catalog.md`, LLD §11. |
| FR-CAT-14 | **Reusable activity library**: one exercise/drill definition shared by many templates; reusable parameter sets (e.g. weighted set) shared by many exercises. | M | Editing *Catching Drill* updates Batter, Fielder and Wicket-keeper templates in their next version. |
| FR-CAT-06 | Curators manage the catalog in an **Admin Console** (CRUD, preview, publish, retire), with an audit trail. | M | Every change logged with who/when/what. |
| FR-CAT-07 | Catalog supports **localisation** of labels and descriptions. | C | Labels resolved by `Accept-Language`. |
| FR-CAT-08 | Derived parameters (formula over other parameters, e.g. volume = reps × weight). | S | Computed server-side in analytics; not entered by user. |
| FR-CAT-09 | **Conditional parameters**: a parameter may declare a condition on another parameter of the same entry (`when yorker_attempted = true`). It is shown and validated only when the condition holds; otherwise it must be empty. | M | App hides `yorker_accurate` until "yorker attempted" is ticked; server rejects `yorker_accurate` without `yorker_attempted = true` (`422`). |
| FR-CAT-10 | **Metric definitions** (data, not code) per activity: `RATIO` = Σ numerator ÷ Σ denominator, or `SINGLE`; built from `COUNT`, `COUNT_TRUE`, `SUM` over a parameter with an optional `where` filter; display format (percent, number, unit). | M | `yorker_accuracy = COUNT_TRUE(yorker_accurate) ÷ COUNT_TRUE(yorker_attempted)`; `avg_bouncer_speed = SUM(speed where bouncer_attempted) ÷ COUNT(speed where bouncer_attempted)`. |
| FR-CAT-11 | **Entry grouping** per activity (e.g. *Over* of 6 balls, *Round*, *Superset*), auto-numbered in the UI. | S | Ball 7 is shown as over 2, ball 1. |

### 2.5 Personal Trackers & Customisation (TRK)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-TRK-01 | A user **subscribes to a profile template** to create a personal tracker (e.g. "My Bowling"); multiple trackers allowed within plan limits. | M | Activities and parameters load automatically. |
| FR-TRK-02 | Users can **add a new parameter** (including conditional ones) or a **new metric** to any activity (e.g. `slower_ball` BOOL + `slower_ball_rate` ratio) – brief TR-9. | M | Available from the next session (sessions pin their schema version); does not change the shared template. |
| FR-TRK-03 | Users can **edit** parameter label, unit, range, options, display order and default aggregation. | M | Changing data **type** creates a new key so history is not corrupted. |
| FR-TRK-04 | Users can **hide** parameters/activities they do not need, and **add custom activities**. | M | Hidden items no longer shown in forms; history stays visible in charts. |
| FR-TRK-05 | Users can create a tracker **from scratch** (blank template). | S | Same validation rules as curated templates. |
| FR-TRK-06 | Each change increments the tracker's **schema version**; concurrent edits from two devices are detected (optimistic concurrency, `If-Match`). | M | Stale update returns `412`. |
| FR-TRK-07 | Users can archive / restore / delete a tracker. | M | Archive keeps data; delete requires confirmation. |
| FR-TRK-08 | When a new template version is published, users may **upgrade** their tracker (diff shown, overrides preserved). | S | Upgrade is opt-in. |
| FR-TRK-09 | Users can change the **unit of any measured parameter or metric** in a tracker to any unit of the same dimension (e.g. bowling speed in mph or m/s; dumbbell weight in lb or kg; bat weight in g; body weight in st), or set one unit for a whole dimension in the tracker ("all weights in lb"). A per-parameter choice overrides the profile preference (FR-PRF-06). | M | Takes effect immediately, **including in a session already in progress** (it does not bump the schema version). Ranges and steps are shown in the chosen unit (40–170 km/h ⇒ 24.9–105.6 mph). |
| FR-TRK-10 | A **custom parameter** declares its dimension and unit from the supported unit list, so it is convertible like catalog parameters. Units without a dimension (reps, bpm, rpm, %, free text such as "shuttles") are labels only. | M | A custom `bat_weight` (mass, g) can be shown in oz. |

### 2.6 Daily Recording (REC)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-REC-01 | Users record a **session** for a tracker with **granular entries** (one per ball / set / item), each with multiple parameter values. | M | A 40-minute bowling session with 50 balls, each ball carrying speed, line and attempted/accurate flags for yorker, seam and bouncer, plus no-ball. |
| FR-REC-02 | Input forms are **generated dynamically** from the effective schema; client- and server-side validation. | M | Invalid values rejected with field-level messages (`422`). |
| FR-REC-03 | **Quick entry** UX: toggles for BOOL, steppers for INT, "repeat last set", copy previous session. | S | Recording 6 balls takes < 30 s on mobile. |
| FR-REC-04 | **Offline-first** on mobile: capture without network; sync automatically when online. | M | No data loss after app kill/restart; server de-duplicates by idempotency key. |
| FR-REC-05 | Users can edit or delete past sessions (within plan history range). | M | Edits re-aggregate analytics within 1 min. |
| FR-REC-06 | Notes per session, and optional session start/end times. | S | — |
| FR-REC-07 | Backfill: record sessions for past dates. | M | Timezone-correct day assignment. |
| FR-REC-08 | Import from CSV. | C | Validated against schema; per-row error report. |
| FR-REC-09 | **Live session lifecycle**: Start → log entries → End. The session is created as `IN_PROGRESS` and becomes `COMPLETED` on End (or `DISCARDED`). | M | Start/End available on mobile and web; the session timer is visible. |
| FR-REC-10 | **Periodic checkpoint sync** of an in-progress session every **3–5 minutes** (server-configurable, with jitter), and immediately when the app goes to background / browser tab is hidden, on network regain, when ≥ 25 entries are unsynced, and on End. | M | Killing the app at minute 30 loses at most the entries since the last checkpoint on the server, and **none** on the device (local store). |
| FR-REC-11 | Checkpoints are **idempotent**: each entry has a client-generated ID; resending, reordering or partially failed batches never create duplicates. Edited and deleted entries are synced too. | M | Same batch sent twice → entry count unchanged. |
| FR-REC-12 | **Submit on End**: the client flushes remaining entries and calls *complete* with the final entry count; the server verifies completeness before marking `COMPLETED`. | M | Count mismatch → server returns the missing entry IDs and the client resends them. |
| FR-REC-13 | **Auto-close**: sessions left `IN_PROGRESS` with no activity for 3 h (configurable), or after local midnight + 2 h, are completed automatically and flagged. | M | Forgotten sessions still appear in charts the next morning. |
| FR-REC-14 | **Live in-session stats** (e.g. balls bowled, yorker accuracy so far, average speed) computed on the device from the same metric definitions. | S | Updates instantly after each ball, also offline. |
| FR-REC-15 | A session in progress can be **resumed on another device** (pull the synced entries). | C | Resume shows entries up to the last checkpoint. |
| FR-REC-17 | Every session has a **name**. The pair **(session date, session name) is unique per user**, so a user can identify any session as e.g. *3 Oct 2026 · Evening Gym*. Name matching ignores case and extra spaces. | M | Starting a second "Morning Nets" on the same date is rejected online (with a suggested free name) and auto-renamed to "Morning Nets (2)" when it arrives through offline sync; the same name is allowed on a different date. |
| FR-REC-18 | **Any number of sessions per day** (N): morning and evening sessions, batting then bowling, bowling then gym. Sessions may be on the same or different trackers, and more than one may be `IN_PROGRESS` at the same time. | M | A user can record 5 sessions on one date; each appears separately in the day's list, and the day's charts include all of them. |
| FR-REC-19 | **Default name** when the user does not type one: `<tracker name> – <part of day>` from the local start time (Morning 05–12, Afternoon 12–17, Evening 17–21, Night 21–05), plus a number if needed. Users can rename a session at any time. | M | First bowling session at 06:10 ⇒ "My Bowling – Morning"; a second one at 09:00 ⇒ "My Bowling – Morning 2". |
| FR-REC-20 | The **session date** is the local date at Start (user timezone), editable for backfill. Changing the date or name re-checks uniqueness. A session that runs past midnight keeps its start date. | M | A session started 23:30 on 3 Oct and ended 00:40 belongs to 3 Oct. |
| FR-REC-16 | **History search** within a user's own data: sessions by tracker/date, notes and tags text, sessions by metric threshold or rank (e.g. yorker accuracy ≥ 70 %, top 10 fastest), and entries by parameter filters (e.g. balls ≥ 140 km/h, sets ≥ 100 kg) within the last 12 months; older entry-level searches run as async exports. | M | See `08_Search_and_Query_Performance.md` §3. |

### 2.7 Analytics & Charts (ANL)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-ANL-01 | Users view charts of any numeric/boolean parameter at **daily, weekly and monthly** granularity over a selectable date range. | M | Charts load < 1 s p95 on 4G. |
| FR-ANL-02 | Aggregations: sum, average, min, max, count, count-of-true and % true per parameter, plus **ratio metrics** from FR-CAT-10. Ratios over weeks/months are always Σ numerator ÷ Σ denominator, never an average of daily percentages. | M | Results match raw-data recomputation in tests; weekly seam accuracy for sessions 23/30 and 20/24 = 43/54 = 79.6 %. |
| FR-ANL-03 | Dashboard per tracker: key metrics, trend vs previous period, last sessions. | M | — |
| FR-ANL-04 | **Personal records** (e.g. fastest ball, heaviest lift) and **streaks** (consecutive active days). | S | PR notification optional. |
| FR-ANL-05 | Compare two parameters or two periods on one chart. | C | — |
| FR-ANL-06 | Charts respect the user's timezone and week-start preference. | M | ISO week by default. |
| FR-ANL-07 | Share/download chart as image. | C | — |
| FR-ANL-08 | **Ratio charts** show the value and its components (e.g. 66.7 % = 12 / 18) per day/week/month, with the denominator visible so small samples are obvious. | M | Tooltip shows `12 of 18 yorkers accurate`. |
| FR-ANL-09 | Session detail view: entry-by-entry table (ball-by-ball) and per-group summaries (per over). | S | Over 3: 6 balls, avg 133 km/h, 2/3 yorkers. |
| FR-ANL-10 | Charts, summaries, personal records and exports use the **user's chosen unit** (FR-PRF-06, FR-TRK-09). Changing the unit re-labels history without recalculation drift. | M | Top speed 142.0 km/h shows as 88.2 mph; switching back shows 142.0 km/h. |
| FR-ANL-11 | **Per-session view within a day**: the day's chart point can be expanded into its named sessions (e.g. Morning Nets 74 % vs Evening Nets 61 % yorker accuracy). | S | Day value = Σ of all that day's sessions; each session also listed with its own value. |

### 2.8 Notifications (NTF)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-NTF-01 | Users schedule **reminders** per tracker (e.g. "Bowling practice 6 AM Mon/Wed/Fri"). | S | Delivered within ±1 min in the user's timezone. |
| FR-NTF-02 | Transactional email: verification, password reset, receipts, export ready. | M | — |
| FR-NTF-03 | Push notifications (FCM / APNs) for reminders, PRs, streak at risk, subscription events. | S | Respect quiet hours and opt-outs. |
| FR-NTF-04 | In-app notification inbox. | C | — |

### 2.9 Administration & Support (ADM)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-ADM-01 | Admin console for catalog, plans, feature flags and user lookup. | M | RBAC enforced; MFA mandatory. |
| FR-ADM-02 | Support view: user's account, subscription, devices and sync status, **without** raw health data unless the user consents. | S | Access audited. |
| FR-ADM-03 | Audit log of all admin actions. | M | Immutable, retained 1 year. |
| FR-ADM-04 | Basic product metrics (DAU/MAU, sessions recorded, conversion). | S | Via analytics events (PostHog / similar), no PII. |

### 2.10 Platform / API (API)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-API-01 | Public REST API, versioned (`/api/v1`), documented with **OpenAPI 3.1**, used by mobile, web and admin. | M | Breaking changes only in a new major version; old version supported ≥ 6 months. |
| FR-API-02 | Consistent error model (RFC 9457 `application/problem+json`), pagination (cursor), filtering, ETags. | M | — |
| FR-API-03 | Idempotency keys on all create/POST endpoints used by mobile sync. | M | Replay returns the original response. |
| FR-API-04 | Webhook endpoints for payment providers. | M | Signature validated; idempotent. |

---

## 3. Non-Functional Requirements

Targets apply to **Beta on AWS** unless stated otherwise. The test environment (k3s) is sized for functional, integration and moderate load testing, not production SLOs.

### 3.1 Performance (PERF)

| ID | Requirement | Target |
|---|---|---|
| NFR-PERF-01 | API latency for reads (catalog, schema, charts – cached) | p95 ≤ **200 ms**, p99 ≤ 500 ms at the gateway |
| NFR-PERF-02 | API latency for writes (create session, overrides) | p95 ≤ **400 ms**, p99 ≤ 1 s |
| NFR-PERF-03 | Chart data freshness after a session is saved | ≤ **60 s** (typically < 5 s) |
| NFR-PERF-04 | Mobile app cold start / time to interactive | ≤ 2.5 s on a mid-range device |
| NFR-PERF-05 | Web Core Web Vitals | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 |
| NFR-PERF-06 | Server error rate | < 0.5 % of requests (5xx) |
| NFR-PERF-07 | Checkpoint batch (≤ 100 entries) latency | p95 ≤ **500 ms** |
| NFR-PERF-08 | Logging one entry on the device (tap to saved) | ≤ **100 ms**, no network dependency |
| NFR-PERF-09 | **Search API response time – production** (catalog, history, entry search) at 10K registered users each recording several sessions/day | **< 5 s hard ceiling (p100, enforced by timeouts)**; design target p95 ≤ 150 ms catalog / ≤ 300 ms sessions / ≤ 800 ms entries |
| NFR-PERF-10 | **Search API response time – k3s test instance** with a 10K-user × 30-day synthetic dataset (~45 M entries) | **< 2 s hard ceiling**; p99 < 2 s including cold cache |
| NFR-PERF-11 | Search must not degrade with total data volume | Every history query user-scoped with user-leading indexes; date-bounded; CI query-plan tests forbid sequential scans on large tables |

### 3.2 Scalability & Capacity (SCAL)

| ID | Requirement | Target |
|---|---|---|
| NFR-SCAL-01 | Concurrent active users (brief TR-6: "thousands") | Beta: **10,000 concurrent** users, ~**1,500 RPS** peak without degradation; architecture scales horizontally to 100k+ |
| NFR-SCAL-02 | Each microservice scales **independently** (brief TR-1) | HPA on CPU/RPS; KEDA on Kafka consumer lag; Karpenter/cluster-autoscaler for nodes |
| NFR-SCAL-03 | Data growth | 10K users × 3 sessions/day × 50 entries ≈ 1.5 M entry rows/day (values stored as one JSONB document per entry) ≈ 548 M/year ≈ 245 GB/year; monthly partitions; raw entries hot 13 months then archived to S3 Parquet; summaries/rollups kept; max 500 entries per session |
| NFR-SCAL-04 | Load balancing (TR-6) | L7 load balancing at ALB and Kong; client-side keep-alive; no sticky sessions (stateless services) |
| NFR-SCAL-05 | Caching (TR-6) | Redis cache-aside for catalog, effective schema and chart series; CDN for static assets; HTTP ETags |

### 3.3 Availability & Reliability (REL)

| ID | Requirement | Target |
|---|---|---|
| NFR-REL-01 | Service availability | Beta **99.5 %** monthly; GA 99.9 % |
| NFR-REL-02 | Fault tolerance | Multi-AZ (≥ 2 AZ beta, 3 AZ GA); ≥ 2 replicas per service; PodDisruptionBudgets |
| NFR-REL-03 | Data durability | RPO ≤ **15 min** (beta), ≤ 5 min (GA); RTO ≤ **4 h** (beta), ≤ 1 h (GA) |
| NFR-REL-04 | Backups | Automated daily snapshots + PITR (7 days beta, 35 days GA); quarterly restore drill |
| NFR-REL-05 | Graceful degradation | If analytics is down, recording still works; if notification is down, nothing else is affected (async, circuit breakers, retries with back-off, DLQ) |
| NFR-REL-06 | Zero-downtime deployments | Rolling / canary releases; backward-compatible DB migrations (expand → migrate → contract) |
| NFR-REL-07 | No data loss on mobile/web | Entries persisted locally (SQLite / IndexedDB) before acknowledging the tap; idempotent checkpoints; server RPO for an in-progress session ≤ 5 min |

### 3.4 Security (SEC)

| ID | Requirement |
|---|---|
| NFR-SEC-01 | Comply with **OWASP ASVS Level 2** and the OWASP API Security Top 10. |
| NFR-SEC-02 | TLS 1.2+ everywhere (TLS 1.3 preferred); HSTS; mTLS or NetworkPolicies between services. |
| NFR-SEC-03 | Encryption at rest with KMS-managed keys (RDS, S3, EBS, ElastiCache, MSK); field-level encryption for push tokens. |
| NFR-SEC-04 | Secrets never in Git or images: Sealed Secrets (k3s) / AWS Secrets Manager via External Secrets Operator (EKS); rotation ≤ 90 days. |
| NFR-SEC-05 | JWT validation at gateway **and** service (defence in depth); least-privilege IAM (Pod Identity / IRSA). |
| NFR-SEC-06 | Rate limiting per user / IP / route; WAF managed rules (SQLi, XSS, bad bots); request size limits. |
| NFR-SEC-07 | Supply-chain security: SAST, dependency (SCA) and image scanning in CI, SBOM, signed images (cosign), admission policy (Kyverno) allowing only signed images. |
| NFR-SEC-08 | Audit logs for authentication events and admin actions; tamper-evident storage. |
| NFR-SEC-09 | Annual penetration test before GA; ZAP baseline scan in every test-env pipeline run. |
| NFR-SEC-10 | Mobile: certificate pinning (optional), secure storage (Keychain / Keystore) for tokens, jailbreak/root detection warning. |

### 3.5 Privacy & Compliance (PRIV)

| ID | Requirement |
|---|---|
| NFR-PRIV-01 | Comply with **GDPR** and **India DPDP Act 2023** (and CCPA if US users): consent, purpose limitation, data export, erasure. |
| NFR-PRIV-02 | Health/fitness data treated as **sensitive**: minimal collection, explicit consent, no sharing with third parties for advertising. |
| NFR-PRIV-03 | PII never written to logs or traces (redaction in the OTel Collector); user IDs pseudonymised in analytics. |
| NFR-PRIV-04 | Data residency: primary region configurable; backups stay in the same jurisdiction. |
| NFR-PRIV-05 | Retention policy: raw sessions kept while the account is active; deleted accounts purged in ≤ 30 days; logs 30 days; audit 1 year. |
| NFR-PRIV-06 | App Store / Play data-safety disclosures and privacy policy published. |

### 3.6 Observability (OBS) – brief TR-7

| ID | Requirement |
|---|---|
| NFR-OBS-01 | **Structured JSON logs** with `trace_id`, `span_id`, `request_id`, service, version, env, level. |
| NFR-OBS-02 | **Debug and trace levels** switchable per service at runtime without redeploy, auto-revert after a timeout. |
| NFR-OBS-03 | **Distributed tracing** (OpenTelemetry, W3C traceparent) across gateway, services and Kafka. |
| NFR-OBS-04 | RED metrics (rate, errors, duration) per endpoint; USE metrics per node; business metrics (sessions/min, sync lag). |
| NFR-OBS-05 | SLOs with burn-rate alerting routed to on-call (Slack / PagerDuty). |
| NFR-OBS-06 | Mobile/web crash and error reporting (Sentry / Crashlytics) with release tracking. |
| NFR-OBS-07 | Log retention: 7 days test, 30 days beta; traces 7 days; metrics 15 days hot (longer in object storage). |

### 3.7 Maintainability & Extensibility (MNT) – brief TR-8

| ID | Requirement |
|---|---|
| NFR-MNT-01 | New sports, exercises, parameters and templates are **data, not code**: no deployment or schema migration required. |
| NFR-MNT-02 | New features ship as new services or modules that react to existing domain events, without changing existing services (open/closed via event bus). |
| NFR-MNT-03 | API-first: OpenAPI contracts, generated clients for mobile/web; consumer-driven contract tests (Pact). |
| NFR-MNT-04 | Code quality: ≥ 80 % unit-test coverage on domain logic; lint/format enforced; ADRs for key decisions. |
| NFR-MNT-05 | Feature flags (OpenFeature + Unleash/Flagsmith) for progressive rollout. |
| NFR-MNT-06 | 12-factor services; configuration via environment; same artefact across environments. |

### 3.8 Usability & Accessibility (USE) – brief TR-5

| ID | Requirement |
|---|---|
| NFR-USE-01 | Responsive design from 360 px phones to 1440 px+ laptops; one design system across mobile and web. |
| NFR-USE-02 | Record a typical session in ≤ 3 taps per value; large touch targets (≥ 44 pt) usable mid-workout. |
| NFR-USE-03 | **WCAG 2.2 AA**: contrast, screen-reader labels, dynamic type, keyboard navigation (web). |
| NFR-USE-04 | Light and dark themes; metric/imperial units; localisation-ready (i18n keys, RTL-safe layouts). |
| NFR-USE-05 | Onboarding to first recorded session in < 2 minutes. |

### 3.9 Portability & Compatibility (PORT)

| ID | Requirement |
|---|---|
| NFR-PORT-01 | Run unchanged on **k3s (test)** and **Amazon EKS (beta)**: same OCI images and Helm charts; differences only in values files. |
| NFR-PORT-02 | Avoid hard lock-in: Kafka API, PostgreSQL, Redis protocol, S3 API, OIDC – all have managed and self-hosted options. |
| NFR-PORT-03 | Clients: iOS 15+, Android 8 (API 26)+, latest 2 versions of Chrome, Safari, Edge, Firefox. |
| NFR-PORT-04 | Multi-arch images (amd64 + arm64) to allow Graviton nodes. |

### 3.10 Cost (COST)

| ID | Requirement |
|---|---|
| NFR-COST-01 | Beta infrastructure budget target ≈ **USD 1.2k–2k / month** (see deployment doc §6), with cost allocation tags per service. |
| NFR-COST-02 | Use Graviton, Spot for stateless pods, autoscaling to minimum at night; AWS Budgets alerts at 80 % / 100 %. |

---

## 4. External Interface Requirements

| Interface | Protocol | Notes |
|---|---|---|
| Mobile / Web → Platform | HTTPS REST/JSON, OIDC | Through CDN/WAF → ALB → Kong |
| Platform → IdPs (Google, Apple) | OIDC | Brokered by Keycloak |
| Platform ↔ Payment providers | HTTPS REST + signed webhooks | Stripe / Razorpay / App Store Server API / Google Play Developer API |
| Platform → FCM / APNs | HTTPS (HTTP v1 API / HTTP/2) | Push notifications |
| Platform → Email | Amazon SES API / SMTP | Transactional email |
| Internal services | REST (sync, sparing) + Kafka events (async) | See LLD event catalog |

---

## 5. Traceability Matrix (brief → requirements → design)

| Brief item | Requirements | Design element |
|---|---|---|
| Track daily work: gym, diet, sports | FR-CAT-01..03, FR-REC-01 | Catalog + Records services; taxonomy diagram `04` |
| Subscribed users, profiles | FR-IAM-*, FR-PRF-*, FR-SUB-* | Keycloak, user-profile-svc, subscription-svc |
| Pre-defined profiles load activities (e.g. Bowler) | FR-CAT-02..04, FR-TRK-01 | Profile templates + trackers, effective schema |
| Record each parameter per day | FR-REC-01..07 | records-svc, offline sync, sequence `06` |
| Per-ball / per-set logging with attempted→accurate parameters; checkpoint every 3–5 min; submit on End (v1.1) | FR-CAT-02, FR-CAT-09..11, FR-REC-09..15 | Live session lifecycle, conditional parameters, sequence `06` |
| Ratio charts (v1.1) | FR-CAT-10, FR-ANL-02, FR-ANL-08 | metric_definition + num/den rollups, diagrams `03`, `04`, `07` |
| Phase 1 knowledge of sports roles & gym muscle groups (v1.2) | FR-CAT-12..14 | `07_Phase1_Activity_Catalog.md`, `catalog/phase1/catalog.json`, diagram `13` |
| Fast search at 10K users; < 5 s prod / < 2 s test (v1.2) | FR-REC-16, NFR-PERF-09..11 | `08_Search_and_Query_Performance.md`, diagram `14` |
| Charts daily/weekly/monthly | FR-ANL-01..06, NFR-PERF-03 | analytics-svc rollups + Redis, sequence `07` |
| Sessions identified by date + unique name; N sessions per day (v1.3) | FR-REC-17..20, FR-ANL-11 | `activity_session.name` + unique index, ADR-015, LLD §4.5 |
| Units editable: km/h ↔ mph, kg ↔ lb ↔ g … (v1.3) | FR-PRF-06, FR-TRK-09..10, FR-ANL-10 | unit registry, canonical storage, `libs/units`, ADR-014, LLD §3.1 |
| TR-1 Microservices, independent scaling | NFR-SCAL-02 | 7 services, DB-per-service, HPA/KEDA |
| TR-2 Flexible DB design | NFR-MNT-01 | PostgreSQL + JSONB + typed EAV values (ADR-002) |
| TR-3 AuthN/AuthZ, subscriptions | FR-IAM-*, FR-SUB-* | Keycloak OIDC, plan claim, entitlement checks |
| TR-4 Mobile from day 1 | NFR-PORT-03, FR-REC-04 | React Native app, API-first, offline-first |
| TR-5 Intuitive UI mobile + laptop | NFR-USE-* | Shared design system, responsive web |
| TR-6 Thousands of concurrent users, LB, caching | NFR-SCAL-01/04/05, NFR-PERF-* | ALB + Kong, Redis, CDN, rollups, autoscaling |
| TR-7 Debug & trace logs | NFR-OBS-* | OTel, Loki, Tempo, Grafana, diagram `12` |
| TR-8 Extensible | NFR-MNT-01..02 | Data-driven catalog, event-driven integration |
| TR-9 User adds/edits parameters | FR-TRK-02..06 | tracker overrides, sequence `08` |
| Test on k3s, beta on AWS | NFR-PORT-01 | Deployment doc, diagrams `09`, `10` |

---

## 6. Open Questions

1. Launch geography and currency, which decide payment provider priority (Razorpay vs Stripe) and AWS region.
2. Are coach / team accounts needed for beta? The current scope says no.
3. Exact plan limits and pricing for Free / Pro / Elite.
4. Is any device integration (e.g. a radar speed gun for cricket) expected in v1?
5. Is a native tablet layout needed, or is responsive web enough?
