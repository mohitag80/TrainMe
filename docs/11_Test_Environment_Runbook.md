# TrainMe – Test Environment Runbook

| Item | Value |
|---|---|
| Version | 1.0 · 2026-10-04 (Phase 1: platform + catalog-svc) |
| Purpose | Day-to-day steps to deploy, access, validate and troubleshoot TrainMe in test environments |
| Related | `04_Deployment_and_Infrastructure.md`, `10_Implementation_Conventions.md`, `src/deploy/` |

> **Living document.** Every new service, endpoint or operational step is added here in the same change.
> Sections marked ⏳ describe services that are not deployed yet.

---

## 1. Environments and URLs

| Environment | Where | Entry point (Kong) | Status |
|---|---|---|---|
| **Test VM – Docker Compose** | `mohitconcert11.fyre.ibm.com` (RHEL 9.8, 4 vCPU, 7.6 GB), code in `/opt/trainme` | http://mohitconcert11.fyre.ibm.com:8000 | ✅ running Phase 1 |
| Laptop – Docker Compose | Colima | http://localhost:8000 | for development |
| Test VM – k3s | same VM (Kubernetes) | http://mohitconcert11.fyre.ibm.com | ⏳ after all services exist |
| AWS beta | EKS (Terraform in `src/infra/terraform/envs/beta`) | – | ⏳ not provisioned |

Everything is reached through **Kong** on one origin:

| Path | Goes to |
|---|---|
| `/api/v1/...` | the services (see §6) |
| `/auth/...` | Keycloak (login pages, OIDC endpoints, admin console) |
| `/` | web app ⏳ (returns an error until the web app is deployed) |

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
| `coach@trainme.test` | member, curator | PRO | Admin Console / catalog publishing |
| `support@trainme.test` | member, support | FREE | support views |
| `admin@trainme.test` | member, admin, curator | ELITE | everything |

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
H=http://mohitconcert11.fyre.ibm.com:8000
TOKEN=$(curl -s -d grant_type=password -d client_id=trainme-cli \
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
| Access Token URL | `http://mohitconcert11.fyre.ibm.com:8000/auth/realms/trainme/protocol/openid-connect/token` |
| Client ID | `trainme-cli` (no secret) |
| Username / Password | a test user, e.g. `coach@trainme.test` / `Passw0rd!` |

### 4.3 What is inside

Decode at https://jwt.io:

```json
{
  "iss": "http://mohitconcert11.fyre.ibm.com:8000/auth/realms/trainme",
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

Open http://mohitconcert11.fyre.ibm.com:8000/auth/realms/trainme/account → **Register**. New users get the
`member` role; without a `plan` attribute they are treated as `FREE`.

### 5.2 Keycloak admin console (browser)

1. http://mohitconcert11.fyre.ibm.com:8000/auth/admin – user `admin`, password = `KEYCLOAK_ADMIN_PASSWORD`:
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

Base URL: `http://mohitconcert11.fyre.ibm.com:8000/api/v1`. Errors are RFC 9457 `application/problem+json`
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

### 6.2 tracker-svc ⏳ · 6.3 records-svc ⏳ · 6.4 analytics-svc ⏳ · 6.5 user-profile-svc ⏳ · 6.6 subscription-svc ⏳ · 6.7 notification-svc ⏳

Endpoints are specified in `03_Low_Level_Design.md` §4 and will be listed here with examples as each service is deployed.

---

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
# consumer groups and lag ⏳ (once consumers exist)
docker exec trainme-redpanda-1 rpk group list

# cache keys
docker exec trainme-valkey-1 valkey-cli --scan --pattern 'cat:*'
# force fresh catalog reads (bumps the catalog version used in cache keys)
docker exec trainme-valkey-1 valkey-cli INCR cat:version
```

---

## 10. Logs

```bash
docker compose logs -f catalog-svc                         # JSON lines (pino)
docker compose logs catalog-svc | grep '"level":"error"'
docker compose logs catalog-svc | grep <X-Request-ID>      # one request end to end
docker compose logs -f kong                                # gateway access log
docker compose logs keycloak | grep -E "ERROR|WARN"
```

Change the log level: set `LOG_LEVEL=debug` in `.env`, then `docker compose up -d catalog-svc`.

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
BASE_URL=http://mohitconcert11.fyre.ibm.com:8000 src/deploy/compose/scripts/smoke-test.sh
```

Checks login for a member and a curator, all catalog endpoints, typo search, and the 401 / 403 / 404 / 422
error paths. Exit code 0 = all passed. The script grows with every service.

### 13.2 Manual checks (Phase 1)

- [ ] `docker compose ps` – every container `healthy`
- [ ] Login page opens: http://mohitconcert11.fyre.ibm.com:8000/auth/realms/trainme/account
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

---

## Change log

| Date | Change |
|---|---|
| 2026-10-04 | First version: Phase 1 on the test VM (Compose), tokens, users, DBeaver, Kafka/cache, smoke test |
