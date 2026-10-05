# TrainMe – Test Environment Runbook

| Item | Value |
|---|---|
| Version | 1.1 · 2026-10-04 (all 7 services + web app; Phase 1 was platform + catalog-svc) |
| Purpose | Day-to-day steps to deploy, access, validate and troubleshoot TrainMe in test environments |
| Related | `04_Deployment_and_Infrastructure.md`, `10_Implementation_Conventions.md`, `src/deploy/` |

> **Living document.** Every new service, endpoint or operational step is added here in the same change.
> Sections marked ⏳ describe services that are not deployed yet.

---

## 1. Environments and URLs

| Environment | Where | Entry point (Kong) | Status |
|---|---|---|---|
| **Test VM – Docker Compose** | `mohitconcert11.fyre.ibm.com` (RHEL 9.8, 4 vCPU, 7.6 GB), code in `/opt/trainme` | **https://mohitconcert11.fyre.ibm.com:8443** (self-signed certificate – accept the browser warning once) | ✅ all services + web |
| Laptop – Docker Compose | Colima | http://localhost:8000 (or https://localhost:8443) | for development |
| Test VM – k3s | same VM (Kubernetes) | http://mohitconcert11.fyre.ibm.com | ⏳ after all services exist |
| AWS beta | EKS (Terraform in `src/infra/terraform/envs/beta`) | – | ⏳ not provisioned |

Everything is reached through **Kong** on one origin. Off `localhost`, use **HTTPS** (port 8443): Keycloak's login cookies are `Secure; SameSite=None`, which browsers drop over plain HTTP on a remote host.


| Path | Goes to |
|---|---|
| `/api/v1/...` | the services (see §6) |
| `/auth/...` | Keycloak (login pages, OIDC endpoints, admin console) |
| `/` | **web app** (Next.js): landing, sign-in, dashboard, catalog, trackers, live recording, charts, profile, plan, inbox, admin |
| `/bff/...` | web app's backend-for-frontend: login callback, logout, API proxy (tokens stay server-side) |

Internal-only ports on the VM (reach them with an SSH tunnel, §8): PostgreSQL `127.0.0.1:55432`, Valkey `127.0.0.1:6379`, Redpanda `127.0.0.1:19092`, Mailpit `127.0.0.1:8025`.

---

## 2. Deploy, update and stop (Docker Compose on the VM)

### 2.1 First deployment

```bash
# From the laptop: copy a committed version to the VM (or `git clone` on the VM once pushed)
git archive --format=tar HEAD | ssh root@mohitconcert11.fyre.ibm.com \
  'rm -rf /opt/trainme && mkdir -p /opt/trainme && tar -x -C /opt/trainme'

# On the VM
cd /opt/trainme/src/deploy/compose
cp .env.example .env
sed -i 's|^TRAINME_PUBLIC_URL=.*|TRAINME_PUBLIC_URL=http://mohitconcert11.fyre.ibm.com:8000|' .env
# Replace every *_PASSWORD / *_SECRET with a random value (keep TEST_USER_PASSWORD for the dummy users):
for k in POSTGRES_PASSWORD CATALOG_DB_PASSWORD TRACKER_DB_PASSWORD RECORDS_DB_PASSWORD ANALYTICS_DB_PASSWORD \
         PROFILE_DB_PASSWORD BILLING_DB_PASSWORD NOTIFICATION_DB_PASSWORD KEYCLOAK_DB_PASSWORD \
         KEYCLOAK_ADMIN_PASSWORD KEYCLOAK_SERVICES_CLIENT_SECRET MOCK_PAYMENT_WEBHOOK_SECRET; do
  sed -i "s|^$k=.*|$k=$(openssl rand -hex 16)|" .env
done
chmod 600 .env

# Phase 1 services (add the others to the list as they are implemented; later simply `up -d --build`)
docker compose up -d --build postgres valkey redpanda redpanda-init keycloak kong mailpit catalog-svc
docker compose ps
```

For a remote VM set `TRAINME_PUBLIC_URL=https://<vm-hostname>:8443` (Kong serves HTTPS on 8443 with its built-in
self-signed certificate). If the public URL changes after the first start, run
`scripts/keycloak-set-public-url.sh` (the realm file is only imported once).

> ⚠️ `.env` is created **once**. Database passwords are written into the database on first start; changing
> them later in `.env` alone breaks the services. To reset everything see §2.4.

### 2.2 Update to a newer version

```bash
# laptop
git archive --format=tar HEAD | ssh root@mohitconcert11.fyre.ibm.com \
  'cd /opt/trainme && tar -x -C /opt/trainme'          # keeps .env (it is not in Git)
# VM
cd /opt/trainme/src/deploy/compose
docker compose up -d --build catalog-svc              # rebuild + restart one service (migrations run on start)
```

After an update that changes catalog search logic, rebuild the search documents (idempotent, no new versions):

```bash
docker compose exec postgres psql -U postgres -d catalog_db -c "DELETE FROM catalog_seed_run"
docker compose restart catalog-svc        # the import also clears the catalog cache
```

### 2.3 Stop / start

```bash
docker compose stop                 # keep data
docker compose start
docker compose down                 # remove containers, keep volumes (data)
```

### 2.4 Full reset (deletes all data)

```bash
docker compose down -v              # also deletes postgres-data and redpanda-data volumes
docker compose up -d --build ...    # recreated from migrations + catalog seed; Keycloak realm re-imported
```

### 2.5 Observability (optional, extra ~600 MB)

```bash
docker compose --profile observability up -d prometheus grafana
# Prometheus 127.0.0.1:9090, Grafana 127.0.0.1:3001 (admin / KEYCLOAK_ADMIN_PASSWORD) – via SSH tunnel
```

---

## 3. Test users and roles

The realm `trainme` is imported on Keycloak start with these dummy users (`src/deploy/charts/trainme-platform/files/realm-trainme.json`):

| User | Roles | Plan | Use for |
|---|---|---|---|
| `asha@trainme.test` | member | PRO | normal user (cricket bowler) |
| `ravi@trainme.test` | member | FREE | free-plan limits |
| `meera@trainme.test` | member | ELITE | top plan |
| `coach@trainme.test` | member (trainer) | PRO | Coach Carter – coaching (trainer) |
| `coach2@trainme.test` | member (trainer) | PRO | Kiran Rao – second trainer (isolation tests) |
| `coach3@trainme.test` | member (trainer) | FREE | Dev Mehta – third trainer (isolation tests) |
| `support@trainme.test` | member, support | FREE | support views |
| `admin@trainme.test` | member, admin, curator | ELITE | Admin Console, catalog publishing – technical only |

**Technical vs end-user accounts:** `admin@`, `support@` (and any `curator`) run the application – they never coach and
never train with a coach (enforced: `403`). Coaches are ordinary members who turn on *I coach or train others*.
`coach2@` / `coach3@` exist from v1.4; on an older running Keycloak add them with the kcadm commands in §5.3
(the realm file is imported only on the first start).

Password for all: **`Passw0rd!`** (`TEST_USER_PASSWORD` in `.env`).

| Role | Meaning |
|---|---|
| `member` | every registered user (default role) |
| `curator` | manages the catalog (`/api/v1/admin/catalog/...`) |
| `support` | read-only support access |
| `admin` | platform administrator |
| `service` | service accounts only (client credentials) |

The **plan** (FREE / PRO / ELITE) is the user attribute `plan`, copied into every access token as the `plan` claim.
subscription-svc will update it automatically after a (mock) payment ⏳.

---

## 4. Access tokens

There is no fixed token. Keycloak issues a signed **JWT access token** per login; it is valid for **15 minutes**
and is sent as `Authorization: Bearer <token>`. Services verify it with Keycloak's public keys (JWKS).

### 4.1 With curl (test-only password grant)

```bash
H=https://mohitconcert11.fyre.ibm.com:8443          # add -k to curl (self-signed certificate)
TOKEN=$(curl -sk -d grant_type=password -d client_id=trainme-cli \
  -d username=coach@trainme.test -d 'password=Passw0rd!' \
  $H/auth/realms/trainme/protocol/openid-connect/token | jq -r .access_token)

curl -H "Authorization: Bearer $TOKEN" "$H/api/v1/admin/catalog/templates?status=PUBLISHED"
```

No `jq`? Use `python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])"`.

### 4.2 Postman / Bruno / Insomnia

Authorization → **OAuth 2.0**:

| Field | Value |
|---|---|
| Grant type | Password Credentials |
| Access Token URL | `https://mohitconcert11.fyre.ibm.com:8443/auth/realms/trainme/protocol/openid-connect/token` (turn off SSL verification for the self-signed certificate) |
| Client ID | `trainme-cli` (no secret) |
| Username / Password | a test user, e.g. `coach@trainme.test` / `Passw0rd!` |

### 4.3 What is inside

Decode at https://jwt.io:

```json
{
  "iss": "https://mohitconcert11.fyre.ibm.com:8443/auth/realms/trainme",
  "aud": ["trainme-api", "account"],
  "sub": "<user id – the user_id in every service database>",
  "realm_access": { "roles": ["member", "curator", "..."] },
  "plan": "PRO",
  "exp": "<15 minutes after issue>"
}
```

### 4.4 Keycloak clients

| Client | Type | Use |
|---|---|---|
| `trainme-web` | public, Authorization Code + PKCE | web app login ⏳ |
| `trainme-mobile` | public, PKCE (`trainme://auth/callback`) | mobile app ⏳ |
| `trainme-cli` | public, password grant | **test only** – scripts, Postman, smoke tests |
| `trainme-services` | confidential, client credentials | service-to-service calls (secret in `.env`) – not for manual testing |

### 4.5 Typical auth errors

| Status | Meaning |
|---|---|
| 401 `unauthorized` | no token, expired token (> 15 min) or a token from another environment (`iss` must match the URL you call) |
| 403 `forbidden` | valid token but missing role (e.g. a member calling `/admin/...`) |

---

## 5. Creating and managing users

### 5.1 Self-registration (browser)

Open https://mohitconcert11.fyre.ibm.com:8443/ → **Create account** (or `/auth/realms/trainme/account` → **Register**). New users get the
`member` role; without a `plan` attribute they are treated as `FREE`.

### 5.2 Keycloak admin console (browser)

1. https://mohitconcert11.fyre.ibm.com:8443/auth/admin – user `admin`, password = `KEYCLOAK_ADMIN_PASSWORD`:
   `ssh root@mohitconcert11.fyre.ibm.com "grep ^KEYCLOAK_ADMIN_PASSWORD= /opt/trainme/src/deploy/compose/.env"`
2. Switch realm (top-left) to **trainme** → **Users** → **Add user** (username = email, tick *Email verified*).
3. **Credentials** tab → *Set password* (turn *Temporary* off).
4. **Role mapping** tab → *Assign role* → e.g. `curator`.
5. **Attributes** tab → `plan` = `FREE` / `PRO` / `ELITE`.

### 5.3 Command line (kcadm inside the Keycloak container, on the VM)

```bash
cd /opt/trainme/src/deploy/compose && set -a && . ./.env && set +a
kc() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@" </dev/null; }
kc config credentials --server http://localhost:8080/auth --realm master --user admin --password "$KEYCLOAK_ADMIN_PASSWORD"

# create a user with a plan, set password, add a role
kc create users -r trainme -s username=new.user@trainme.test -s email=new.user@trainme.test \
  -s firstName=New -s lastName=User -s enabled=true -s emailVerified=true -s 'attributes.plan=["PRO"]'
kc set-password -r trainme --username new.user@trainme.test --new-password 'Passw0rd!'
kc add-roles   -r trainme --uusername new.user@trainme.test --rolename curator

# list / change plan / delete
kc get users -r trainme --fields username,email,attributes --format csv
ID=$(kc get users -r trainme -q username=new.user@trainme.test --fields id --format csv --noquotes)
kc update users/$ID -r trainme -s 'attributes.plan=["ELITE"]'
kc delete users/$ID -r trainme
```

`</dev/null` matters: without it `docker compose exec` swallows the rest of a script's input.
A new token is needed after role or plan changes (claims are copied at login).

---

## 6. Service APIs

Base URL: `https://mohitconcert11.fyre.ibm.com:8443/api/v1` (curl needs `-k` for the self-signed certificate). Errors are RFC 9457 `application/problem+json`
(`type`, `title`, `status`, `detail`, field `errors[]` with JSON pointers). Every response carries `X-Request-ID`
(quote it when reporting a problem; it is in the service logs).

### 6.1 catalog-svc ✅

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/units` | public | unit registry: dimensions, units, conversion factors |
| GET | `/categories` | public | whole category tree with template counts |
| GET | `/templates?category=<code>` | public | published templates (category includes descendants) |
| GET | `/templates/{code}` | public | latest published template snapshot (activities, parameters, metrics) |
| GET | `/templates/{code}/versions/{v}` | public | a specific version |
| GET | `/activities/{code}` | public | one library activity (effective parameters and metrics) |
| GET | `/catalog/search?q=&type=&sport=&role=&muscle=&equipment=&category=&kind=&limit=` | public | typo-tolerant search (2 s ceiling on test) |
| GET | `/catalog/suggest?q=` | public | autocomplete (≥ 2 characters) |
| GET | `/admin/catalog/templates?status=DRAFT\|PUBLISHED\|RETIRED` | curator, admin | all template versions |
| POST | `/admin/catalog/templates/{code}/versions/{v}/publish` | curator, admin | publish a version (retires the previous one) |
| POST | `/admin/catalog/templates/{code}/versions/{v}/retire` | curator, admin | retire a version |
| GET | `/admin/catalog/tree` | curator, admin | category tree with display paths and counts |
| POST / PATCH | `/admin/catalog/categories[/{code}]` | curator, admin | add a category under a parent (`{parentCode,name,kind}`) / rename |
| GET | `/admin/catalog/activities?q=` · `/admin/catalog/profiles` | curator, admin | latest version of every activity / profile with status and placement |
| POST | `/admin/catalog/activities` · `/admin/catalog/templates` | curator, admin | create a DRAFT (codes are generated from the name) |
| GET / PUT / DELETE | `/admin/catalog/{activities\|templates}/{code}/versions/{v}` | curator, admin | read any version · update or delete a DRAFT |
| POST | `/admin/catalog/{activities\|templates}/{code}/drafts` | curator, admin | start editing: copies the latest version into a new draft |
| POST | `/admin/catalog/activities/{code}/versions/{v}/publish` · `/retire` | curator, admin | publish (published profiles using it get a new version automatically) / retire |

Publishing a profile whose activities are still drafts: `POST …/templates/{code}/versions/{v}/publish` with `{"publishActivities":true}` publishes them first; without it `409 activities-not-published` lists them (`draftActivities`).

**Admin walkthrough (web):** Admin → **+ New profile** → name → *Where it belongs*: pick a node, **+ Add a category under …** if the sport is missing (e.g. Sports › Field Hockey) → **Place it here** → pick activities on the right or **+ New activity** (saves the profile, opens the activity editor; publishing the activity adds it to the profile and returns) → checklist turns green → **Publish** (confirms any draft activities) → **View it as users see it**. Unfinished work is listed under *Drafts waiting to be published* on the Admin home.

Web: **Admin → Catalog tree / Profiles / Activities**. Place items by name in the tree (e.g. Sports › Racquet Sports › Table Tennis); codes are never shown. A field's kind of answer and unit are fixed once published (`422 immutable-field`). Every change is written to `catalog_audit`.

Examples:

```bash
curl -s "$H/api/v1/templates?category=cricket" | jq '.items[].code'
curl -s "$H/api/v1/templates/cricket.fast_bowler" | jq '.activities[0].parameters[] | {key,type,unit}'
curl -s "$H/api/v1/catalog/search?q=dumbell%20chest&type=activity" | jq '.items[] | {itemCode,score}'
curl -s "$H/api/v1/catalog/search?q=press&muscle=chest&equipment=dumbbell" | jq '.items[].itemCode'
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "$H/api/v1/admin/catalog/templates/cricket.fast_bowler/versions/1/publish"
```

Category codes for `?category=` / facets: see `/categories` (e.g. `cricket`, `cricket.fast_bowler`, `gym.legs`, `gym.arms.biceps`).

### 6.2 tracker-svc ✅

| Method | Path | Description |
|---|---|---|
| GET | `/trackers` | my trackers (with "upgrade available") |
| POST | `/trackers` | create `{templateCode, displayName?}` or blank `{displayName}` – plan limit on active trackers |
| GET / PATCH / DELETE | `/trackers/{id}` | details · rename/archive/restore (`If-Match`) · delete |
| GET | `/trackers/{id}/schema?version=` | effective schema (ETag `"v<n>"`, 304 on `If-None-Match`) |
| POST | `/trackers/{id}/overrides` | ADD/MODIFY/HIDE a parameter, metric or activity (`If-Match`) → new schema version |
| POST | `/trackers/{id}/overrides` (catalog activity) | `{"target":"ACTIVITY","action":"ADD","activityCode":"cricket.spin.delivery","definition":{"source":"CATALOG"}}` – copies the published activity (snapshot fetched by tracker-svc); allowed on every plan |
| DELETE | `/trackers/{id}/overrides/{overrideId}` | undo a customisation |
| GET / PUT | `/trackers/{id}/display-units` | `{"cricket.fast.delivery.speed_kmph":"mph","*.mass":"lb"}` – no schema bump |
| POST | `/trackers/{id}/upgrade?dryRun=true` | preview / apply a newer template version |

```bash
TID=$(curl -s -X POST $H/api/v1/trackers -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"templateCode":"cricket.fast_bowler"}' | jq -r .id)
curl -s -X POST $H/api/v1/trackers/$TID/overrides -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"target":"PARAMETER","action":"ADD","activityCode":"cricket.fast.delivery","definition":{"key":"slower_ball","label":"Slower ball","type":"BOOL"}}'
```

FREE users (e.g. `ravi@`) get `403 plan-limit` for a 3rd active tracker and `422 plan-limit` for custom parameters.

### 6.3 records-svc ✅ (named live sessions)

| Method | Path | Description |
|---|---|---|
| POST | `/sessions` | start `{clientSessionId, trackerId, name, startedAt, timezone, onNameConflict: REJECT\|SUFFIX}` – idempotent on `clientSessionId`; duplicate name on the same date → `409` + `suggestedName` |
| GET | `/sessions?date=YYYY-MM-DD` | all sessions of a day across trackers (`&trackerId=`, `&from=&to=`, cursor) |
| GET | `/sessions/lookup?date=&name=` | one session by date + name (case-insensitive) |
| GET | `/sessions/{id}?include=entries` | session with its entries |
| POST | `/sessions/{id}/entries:batch` | checkpoint ≤ 100 entries `{batchSeq, schemaVersion, entries[], deletes[]}` – partial success, replays are no-ops |
| POST | `/sessions/{id}/complete` | `{endedAt, entryCount, clientEntryIds?}` → `409 entries-missing` lists what to resend |
| POST | `/sessions/{id}/discard` | discard an in-progress session (frees its name) |
| POST | `/sessions/{id}/reopen` | resume a COMPLETED session on its own calendar day (session time zone) → IN_PROGRESS; other days `409 reopen-window-closed`. Charts keep the old figures until it is completed again, which replaces them |
| PATCH / DELETE | `/sessions/{id}` | rename, move date, notes/tags (`If-Match`) · delete |
| GET | `/sessions/search?q=` | S5 text search over name/notes/tags (last 12 months) |
| GET | `/entries/search?trackerId=&activity=&where=speed_kmph:gte:140` | S7 entry search (≤ 366 days) |

Sessions left open are auto-closed after 3 h idle or local midnight + 2 h (completed if they have entries, discarded if empty).

### 6.4 analytics-svc ✅ (built from completed sessions via `record.events`)

| Method | Path | Description |
|---|---|---|
| GET | `/analytics/series?trackerId=&activity=&metric=yorker_accuracy&granularity=DAY\|WEEK\|MONTH` | metric series (`num`, `den`, `value`); or `&param=speed_kmph&agg=AVG\|MAX\|…` |
| GET | `/analytics/summary?trackerId=&period=WEEK\|MONTH` | every metric, current vs previous period |
| GET | `/analytics/day?trackerId=&date=` | each named session of a day with its metric values |
| GET | `/analytics/records?trackerId=` | personal records (top/best-value metrics) |
| GET | `/analytics/streaks` | current and longest streak per tracker |
| GET | `/analytics/sessions/search?trackerId=&metric=&min=&sort=value_desc` | S6 sessions by metric value |

Values are in canonical units (km/h, kg …); the apps convert to the user's units.

### 6.5 user-profile-svc ✅

| Method | Path | Description |
|---|---|---|
| GET / PUT | `/profiles/me` | profile (created on first call); `{"unitPreset":"IMPERIAL","unitPreferences":{"speed":"METRIC"}}` (`If-Match`) |
| GET / POST / DELETE | `/profiles/me/devices[/{id}]` | push tokens |
| POST | `/profiles/me/export` | request a data export (202) |
| DELETE | `/profiles/me` | erase account (202) → `user.deleted` saga across services |
| GET | `/profiles?q=` | support/admin search by email or name |

### 6.6 subscription-svc ✅ (MOCK payments in test)

| Method | Path | Description |
|---|---|---|
| GET | `/plans` | public plan list (placeholder prices) |
| GET | `/subscriptions/me` | current plan, subscription, entitlements |
| POST | `/subscriptions/checkout` | `{planCode}` → `checkoutUrl` (mock provider page) |
| POST | `/subscriptions/me/cancel[?immediate=true]` | cancel at period end / now |
| GET / POST | `/mock-payments/checkout/{id}` | the mock "provider" page and its Pay/Cancel action |
| POST | `/webhooks/payments/mock` | signed provider webhook (`x-mock-signature`), idempotent |

Flow: web *Plan* page → Choose Pro → mock page → **Pay** → signed webhook → subscription ACTIVE → Keycloak `plan` attribute = PRO → `subscription.activated` → welcome email (Mailpit) + inbox entry. Sign out/in to get a token with the new plan.

### 6.7 notification-svc ✅

| Method | Path | Description |
|---|---|---|
| GET / POST / PUT / DELETE | `/reminders[/{id}]` | `{title, daysOfWeek:[1..7], timeOfDay:"06:00", timezone, channel: IN_APP\|EMAIL\|PUSH}` |
| GET | `/notifications` | inbox (`unread` count, cursor) |
| POST | `/notifications/{id}/read`, `/notifications/read-all` | mark read |
| GET / PUT | `/notifications/preferences` | channels + quiet hours (`quietStart`, `quietEnd`) |

Push is logged as `SKIPPED` until FCM/APNs keys exist; email goes to Mailpit in test (`ssh -L 8025:localhost:8025 …`, then http://localhost:8025).

### 6.8 Web app ✅

| Page | What to try |
|---|---|
| `/` → Sign in | log in as `asha@trainme.test` / `Passw0rd!` |
| Catalog | search "dumbell chest", open **Fast Bowler**, *Start tracking* |
| Tracker | add a parameter, hide one, switch speed to mph, start "Morning Nets" (try the same name twice) |
| Session | log balls (yorker attempted → accurate appears), watch live stats, *End session* |
| Charts | yorker accuracy daily/weekly/monthly with "n of m"; sessions of a day |
| Profile / Plan / Inbox | Imperial units, mock checkout, reminders and quiet hours |
| Admin (`admin@`) | publish / retire template versions |

---

### 6.9 Trainers and coaching ✅ (v1.4 – docs/12)

| Method | Path | Description |
|---|---|---|
| PUT | `/profiles/me/trainer` | `{isTrainer, bio, specialties}` – self-register as a trainer |
| GET | `/profiles/trainers?q=` | find trainers by name or specialty |
| GET / POST | `/profiles/connections` | my connections (`asTrainee`, `asTrainer`) · request `{trainerId}` or invite `{traineeEmail}` (trainers only) |
| POST / DELETE | `/profiles/connections/{id}/accept\|decline` · `/profiles/connections/{id}` | answer (the side that did not ask) · disconnect |
| POST | `/sessions` with `trainerId` | only an **active** connection (else 422) |
| GET | `/sessions/coaching?status=IN_PROGRESS&traineeId=` | sessions where I am the trainer |
| GET | `/sessions/{id}/schema` | pinned schema for owner or assigned trainer |
| GET / POST / PATCH / DELETE | `/sessions/{id}/feedback[/{fid}]` | trainer writes (while connected), owner reads; `{body, clientEntryId?}` |
| GET | `/analytics/coaching/trainees/{id}/trackers` · `/analytics/coaching/series?traineeId=&trackerId=&activity=&metric=` | trainer charts from **their** sessions only |

Access rules: a trainer reads only sessions where they are `trainer_id` (others → 404), records only while the session is live
**and** the connection is active (else 403), keeps read access after a disconnect. Entries logged by the trainer belong to the
trainee and store `recorded_by`.

**Walkthrough (two browsers or a private window):**
1. `coach@` → Profile → *Coaching* → **I coach or train others** → bio, specialties → Save. *Coaching* appears in the menu.
2. `meera@` → **My trainers** → search “coach” → **Request**. `coach@` → **Coaching** → **Accept**
   (or: coach invites `meera@trainme.test` by e-mail; Meera accepts under My trainers).
3. `meera@` → tracker → **Start a session** → *Trainer (optional)* = Coach Curator.
4. `coach@` → **Coaching → Live now** (refreshes every 10 s) → **Join and record**. Both log balls – each screen shows the
   other's within 5 s, tagged *by Coach Curator*.
5. `coach@` → *Feedback* → about *Ball #1* or the whole session → **Send**. Meera gets an inbox notice and sees it on the session.
6. `coach@` → **Coaching → Sessions & charts** for Meera: only sessions with the coach, charts from those sessions only.

**Automated check:** `BASE_URL=https://localhost:8443 python3 src/deploy/compose/scripts/e2e-coaching.py` – 38 checks
(trainers, connections, recording together, isolation between three trainers, feedback, notifications, disconnect).
It uses meera@ with coach@, coach2@ and coach3@ as trainers (and checks that admin@ cannot coach); safe to re-run.

## 7. Health, readiness and metrics

Each service exposes (inside the Docker network / cluster, not through Kong):

| Path | Meaning |
|---|---|
| `/health/live` | process is up |
| `/health/ready` | dependencies reachable: `postgres`, `redis`, `outbox-relay` (+ Kafka consumers later) |
| `/metrics` | Prometheus metrics (HTTP latency, events processed, outbox published, Node.js runtime) |

```bash
# on the VM
docker compose ps                                                   # health of every container
docker compose exec catalog-svc wget -qO- http://127.0.0.1:8080/health/ready
docker compose exec catalog-svc wget -qO- http://127.0.0.1:8080/metrics | grep http_server_request
```

---

## 8. Database access

### 8.1 DBeaver (GUI)

PostgreSQL listens only on the VM (`127.0.0.1:55432`); use DBeaver's SSH tunnel.

| Tab | Field | Value |
|---|---|---|
| SSH (*Use SSH Tunnel*) | Host / Port / User | `mohitconcert11.fyre.ibm.com` / `22` / `root`, authentication = your SSH private key |
| Main | Host / Port | `127.0.0.1` / `55432` |
| Main | Database / Username | `postgres` / `postgres` |
| Main | Password | `POSTGRES_PASSWORD` from `.env` (`ssh root@... "grep ^POSTGRES_PASSWORD= /opt/trainme/src/deploy/compose/.env"`) |
| PostgreSQL | Show all databases | ✅ |

Safer browsing: General → *Read-only connection*, or log in as a service role (e.g. `catalog_svc` /
`CATALOG_DB_PASSWORD`, database `catalog_db`), which can only see its own database.

Alternative without the SSH tab: `ssh -N -L 15432:127.0.0.1:55432 root@mohitconcert11.fyre.ibm.com`, then connect to `localhost:15432`.

### 8.2 Databases

| Database | Owner role | Service |
|---|---|---|
| `catalog_db` | `catalog_svc` | catalog-svc ✅ |
| `tracker_db` | `tracker_svc` | tracker-svc ⏳ |
| `records_db` | `records_svc` | records-svc ⏳ (monthly partitions via pg_partman) |
| `analytics_db` | `analytics_svc` | analytics-svc ⏳ |
| `profile_db` | `profile_svc` | user-profile-svc ⏳ |
| `billing_db` | `billing_svc` | subscription-svc ⏳ |
| `notification_db` | `notification_svc` | notification-svc ⏳ |
| `keycloak_db` | `keycloak` | Keycloak – do not edit; use the admin console |

### 8.3 Handy queries (psql on the VM)

```bash
docker compose exec postgres psql -U postgres -d catalog_db
```

```sql
SELECT version, description, applied_at FROM schema_migration ORDER BY version;          -- migrations applied
SELECT applied_at, stats FROM catalog_seed_run;                                            -- catalog seed runs
SELECT code, version, status FROM profile_template ORDER BY code;                          -- templates
SELECT event_type, message_key, created_at, published_at FROM outbox_event ORDER BY created_at DESC LIMIT 10;
SELECT count(*) FILTER (WHERE published_at IS NULL) AS pending FROM outbox_event;           -- should be 0
\di+                                                                                        -- indexes and sizes
SELECT query, calls, round(mean_exec_time::numeric, 2) AS ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

Check a query plan (every new query is reviewed this way, `10_Implementation_Conventions.md` §5):

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT item_code FROM catalog_search_doc d
WHERE 'dumbell' <<% d.search_text AND 'chest' <<% d.search_text;
```

---

## 9. Kafka (Redpanda) and cache (Valkey)

```bash
# topics and partitions
docker exec trainme-redpanda-1 rpk topic list
# read events (key + CloudEvent JSON)
docker exec trainme-redpanda-1 rpk topic consume catalog.events -n 5 -f '%k %v\n'
# dead letters (failed events, with x-error header)
docker exec trainme-redpanda-1 rpk topic consume record.events.dlq -n 5 -f '%h %v\n'
# consumer groups and lag
docker exec trainme-redpanda-1 rpk group list
docker exec trainme-redpanda-1 rpk group describe analytics-svc.rollups

# cache keys
docker exec trainme-valkey-1 valkey-cli --scan --pattern 'cat:*'
# force fresh catalog reads (bumps the catalog version used in cache keys)
docker exec trainme-valkey-1 valkey-cli INCR cat:version
```

---

### 9.1 Rebuild analytics from events (replay)

Read models can be rebuilt because topics keep 30 days of events:

```bash
docker compose stop analytics-svc
docker compose exec postgres psql -U postgres -d analytics_db \
  -c "TRUNCATE session_fact, metric_rollup, session_metric, personal_record, streak, processed_event, outbox_event"
docker exec trainme-redpanda-1 rpk group seek analytics-svc.rollups --to start
docker compose start analytics-svc
```

## 10. Logs

```bash
docker compose logs -f catalog-svc                         # JSON lines (pino)
docker compose logs catalog-svc | grep '"level":"error"'
docker compose logs catalog-svc | grep <X-Request-ID>      # one request end to end
docker compose logs -f kong                                # gateway access log
docker compose logs keycloak | grep -E "ERROR|WARN"
```

**Log files** (Compose): every service and the web app also write daily files to `src/deploy/compose/logs/<service>/`:
`app.<yyyy-MM-dd>.<n>.log`, 14 days kept, `current.log` → today's file. Set by `LOG_DIR` (default `/var/log/trainme`,
mounted from `./logs`); `LOG_DIR=` (empty) = stdout only. On Kubernetes `LOG_DIR` is empty – the cluster collects stdout.

```bash
cd src/deploy/compose
tail -f logs/records-svc/current.log                              # one service
tail -f logs/*/current.log | grep '"level":"error"'               # errors anywhere
grep -h <x-request-id> logs/*/current.log                         # one browser action through web → services
grep -h '"userId":"<id>"' logs/*/current.log | sort               # everything one user did
```

What is logged:
- `info` – every change and decision: logins and logouts, trackers created or customised, sessions started, completed, reopened or deleted, entries saved, stats recalculated, personal bests, catalog items created, published or retired, payments, plans, reminders, events published and handled. Each request is one line with requestId, userId, status and ms.
- `warn` – rejected requests (4xx), retries, payment or email problems.
- `error` – failures with stack (5xx, upstream down, events sent to the DLQ).
- `debug` – details: request URLs, why a request was rejected (field errors), cache hits, chart and search timings, upstream calls, each event received.

Tokens, cookies, passwords and e-mail addresses are redacted.

Change the level: `LOG_LEVEL=debug` in `.env` (all services), or for one service only:
`LOG_LEVEL=debug docker compose -p trainme up -d --no-deps catalog-svc`. On Kubernetes edit `LOG_LEVEL` in the ConfigMap and restart the pod.

---

## 11. Configuration changes

| Where | How |
|---|---|
| Docker Compose | edit `src/deploy/compose/.env` (or the service `environment:` block), then `docker compose up -d <service>` |
| k3s ⏳ | non-secret settings live in ConfigMap `<service>-config` (Helm values). For a quick override create `<service>-overrides`, then restart: |

```bash
kubectl -n trainme create configmap records-svc-overrides --from-literal=LOG_LEVEL=debug
kubectl -n trainme rollout restart deployment/records-svc
```

Settings are read once at start-up (validated with zod; an invalid value stops the service with a clear message).
Secrets (database URLs, client secrets) are Kubernetes Secrets, never ConfigMaps.

---

## 12. Kubernetes (k3s) deployment ⏳

Once all services exist (see `src/deploy/k3s/`):

```bash
cp src/deploy/k3s/secrets.env.example src/deploy/k3s/secrets.env      # set real values
src/deploy/k3s/build-images.sh                                       # build + import images into k3s
PUBLIC_URL=http://mohitconcert11.fyre.ibm.com src/deploy/k3s/install.sh
kubectl -n trainme get pods
```

The VM has ~8 GB RAM: stop the Compose stack first (`docker compose down`).

---

## 13. Validation checklist

### 13.1 Automated smoke test

```bash
BASE_URL=https://mohitconcert11.fyre.ibm.com:8443 src/deploy/compose/scripts/smoke-test.sh
```

Checks login for a member and a curator, all catalog endpoints, typo search, and the 401 / 403 / 404 / 422
error paths. Exit code 0 = all passed. The script grows with every service.

### 13.2 Manual checks (Phase 1)

- [ ] `docker compose ps` – every container `healthy`
- [ ] Web app opens and signs in: https://mohitconcert11.fyre.ibm.com:8443/
- [ ] Token for `asha@trainme.test` shows `plan: PRO` (jwt.io)
- [ ] `/api/v1/templates?category=cricket` lists 7 templates
- [ ] `/api/v1/templates/cricket.fast_bowler` → first activity has 17 parameters, 13 metrics
- [ ] Search `dumbell chest` returns dumbbell chest exercises; `fast bowlr` returns the fast bowler items
- [ ] Admin endpoint: 401 without token, 403 as member, 200 as curator
- [ ] `outbox_event` has no pending rows; `catalog.events` topic has `catalog.template.published` events

---

## 14. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `429 Too Many Requests` pulling images | Docker Hub anonymous limit on shared IPs | VM uses mirror `https://mirror.gcr.io` in `/etc/docker/daemon.json` (already set; backup `daemon.json.bak-trainme` if one existed) |
| Kong returns `name resolution failed` | a container restarted while Kong cached "not found" | fixed by `KONG_DNS_NOT_FOUND_TTL=2`; otherwise `docker compose restart kong` |
| Token request fails right after restarting Postgres | Keycloak's DB connections dropped | retry after a few seconds (Keycloak reconnects) or `docker compose restart keycloak` |
| `password authentication failed` from a laptop tool on port 5432 | a local PostgreSQL already uses 5432 | TrainMe's Postgres is on host port **55432** (`POSTGRES_HOST_PORT`) |
| 401 with a fresh token | token issued for a different host (e.g. `localhost`) | get the token from the same base URL you call (`iss` must match) |
| Service exits with `Invalid configuration` | missing/invalid env var | the log lists every bad key; fix `.env` and restart |
| Migration fails with `checksum mismatch` | an applied migration file was edited | never edit applied migrations; add `V<next>__...sql` |
| Image build fails at `pnpm deploy` | registry metadata needed by pnpm 12 supply-chain check | build host needs internet access to registry.npmjs.org |
| Keycloak says "Restart login cookie not found" | the site is opened over plain HTTP on a remote host | open the HTTPS URL (port 8443) and set `TRAINME_PUBLIC_URL` to it |
| Keycloak says "Invalid parameter: redirect_uri" | the public URL changed after the realm was imported | `scripts/keycloak-set-public-url.sh` |
| Kong 502 for the web app, upstream `127.0.53.53` | a service named like a public TLD (`web`) resolved via public DNS | the service is named `trainme-web`; never name containers after TLDs |
| Web login loops back to `/login?error=login_failed` | `PUBLIC_URL` of the web container differs from the browser URL, or Valkey is down | set `TRAINME_PUBLIC_URL` to the exact URL you open; check `docker compose ps valkey` |
| Plan still FREE after paying | the access token was issued before the payment | sign out and in again (claims are copied at login) |
| Chart empty right after ending a session | analytics processes `record.session.completed` asynchronously | wait a few seconds; check `rpk group describe analytics-svc.rollups` for lag |
| Email not in Mailpit | quiet hours (22:00–07:00 by default when set) or email disabled in preferences | check `notification` rows: `status`/`error` say why |

---

## Change log

| Date | Change |
|---|---|
| 2026-10-04 | First version: Phase 1 on the test VM (Compose), tokens, users, DBeaver, Kafka/cache, smoke test |
| 2026-10-04 | 1.1: all service APIs (§6.2–6.7), web app (§6.8), analytics replay (§9.1), smoke test covers every service, new troubleshooting rows |
