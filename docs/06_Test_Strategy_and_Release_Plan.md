# TrainMe – Test Strategy & Release Plan (k3s Test → AWS Beta)

| Item | Value |
|---|---|
| Version | 1.0 · 2026-10-03 |
| Scope | How TrainMe is verified on the **k3s test instance** and released as a **beta on AWS** |

---

## 1. Test Pyramid and Ownership

| Level | What | Tools | Where it runs | Gate |
|---|---|---|---|---|
| Unit | Domain logic: schema compilation, override rules, validation, rollup math, entitlement rules | Jest / Vitest | CI on every PR | ≥ 80 % line coverage on `domain/` and `application/` |
| Integration | Repositories, outbox relay, Kafka consumers, Redis cache | Testcontainers (Postgres, Redpanda, Redis) | CI | All pass |
| Contract | Mobile/web ↔ services, service ↔ service events | Pact (HTTP + message pacts), OpenAPI diff (oasdiff) | CI + Pact Broker | No breaking change without a new API version |
| Component / API | Each service deployed with real deps | Newman / Bruno collections | k3s test (post-deploy) | Smoke 100 % pass |
| End-to-end web | Sign-up → create tracker → record → chart → subscribe (test mode) | Playwright | k3s test | Critical journeys pass on Chromium, WebKit, Firefox |
| End-to-end mobile | Same journeys + offline capture and sync | Maestro on iOS simulator / Android emulator (EAS or CI runners) | k3s test | Pass on latest-1 OS versions |
| Performance | Load, stress, soak, spike | k6 (k6 Operator in-cluster + external runner) | k3s (baseline), AWS beta staging window (full scale) | NFR targets met (see §3) |
| Security | DAST, dependency/image scans, k8s posture, mobile binary analysis | OWASP ZAP, Trivy, kube-bench, MobSF | CI + k3s | No high/critical open |
| Accessibility | WCAG 2.2 AA checks | axe / Lighthouse CI, manual VoiceOver/TalkBack | CI + manual | No serious violations |
| UAT | Real coaches/athletes validate catalog and UX | TestFlight / Play internal + test web | k3s test | Product owner sign-off |
| Resilience | Pod kill, node drain, DB failover, Kafka broker loss | Chaos Mesh (k3s), AWS FIS (beta, pre-GA) | k3s / AWS | Recovers within SLO; no data loss |

---

## 2. Critical Test Scenarios (mapped to requirements)

| ID | Scenario | Requirements |
|---|---|---|
| TS-01 | Sign up with email; verify; log in on mobile with PKCE; refresh token rotation; logout revokes | FR-IAM-01/03/05 |
| TS-02 | Social login with Google and Apple; account linking by email | FR-IAM-02 |
| TS-03 | Browse Sports › Cricket › Bowler; create "My Bowling" tracker; parameters (speed, seam, no-ball, bouncer, yorker, leg-spin) load | FR-CAT-01..03, FR-TRK-01 |
| TS-04 | Add custom parameter `wrist_position` (ENUM); hide `leg_spin`; change speed display unit to mph; concurrent edit from 2 devices → 412 | FR-TRK-02..06 |
| TS-05 | Live Fast Bowler session: 50 balls over ~40 min, each with speed, line, yorker/seam/bouncer attempted→accurate, no-ball; checkpoints observed every 3–5 min; End → COMPLETED with entry_count 50 | FR-REC-01, FR-REC-09..12 |
| TS-05a | Airplane mode from ball 10 to 40, app killed at ball 35 and relaunched: all 50 balls present locally; after network regain, server gets all 50 exactly once | FR-REC-04, FR-REC-10/11, NFR-REL-07 |
| TS-05b | Same checkpoint batch sent 3× and out of order; edit ball 12 and delete ball 16 mid-session → server matches the device exactly | FR-REC-11 |
| TS-05c | Lost checkpoint → `/complete` returns 409 with missing IDs → client resends → COMPLETED | FR-REC-12 |
| TS-05d | Session left open (no End) → auto-closed after idle threshold, `auto_closed=true`, appears in charts | FR-REC-13 |
| TS-05e | Conditional params: `yorker_accurate` hidden until attempted ticked; server rejects `yorker_accurate` with `yorker_attempted=false` (422 for that entry only, others accepted) | FR-CAT-09 |
| TS-05f | Web browser: start session, log balls, close tab mid-session → `pagehide` flush; reopen on mobile and resume | FR-REC-10, FR-REC-15 |
| TS-06 | Record Gym tracker: Bench Press 4 sets (reps, weight); chart weekly volume and max weight | FR-REC-01, FR-ANL-01/02, FR-CAT-08 |
| TS-07 | Charts: daily/weekly/monthly; timezone edge (session at 23:30 local) lands on correct day/week | FR-ANL-01/02/06 |
| TS-07a | Ratio charts: yorker accuracy 12/18 = 66.7 %, seam 23/30 = 76.7 %, bouncer 5/8 = 62.5 %, no-ball rate 3/50 = 6 %; second session seam 20/24 → weekly 43/54 = 79.6 % (not 80.0 %); tooltip shows num/den; den = 0 → gap, not 0 % | FR-CAT-10, FR-ANL-02, FR-ANL-08 |
| TS-07b | Live in-session stats on the device equal the server's metrics for the completed session (same shared evaluator) | FR-REC-14 |
| TS-07c | User adds custom metric `slower_ball_rate` mid-session → applies from next session (session pinned to schema version) | FR-TRK-02 |
| TS-08 | Edit and delete a past session → rollups corrected within 60 s | FR-REC-05, NFR-PERF-03 |
| TS-09 | Free plan limit: 2nd tracker / custom param blocked with 403 plan-limit; upgrade via Stripe/Razorpay test mode → webhook → entitlement active after token refresh | FR-SUB-01..05 |
| TS-10 | Duplicate and out-of-order webhooks → single state transition | FR-SUB-04 |
| TS-11 | Curator publishes Bowler v4; existing trackers stay on v3; user upgrades with overrides preserved | FR-CAT-04, FR-TRK-08 |
| TS-12 | Reminder at 06:00 Asia/Kolkata delivered via push; quiet hours respected | FR-NTF-01/03 |
| TS-13 | Data export produces complete JSON/CSV; account deletion purges data in all services (verify each DB) | FR-PRF-03/04, NFR-PRIV-01 |
| TS-14 | Analytics service down → recording still succeeds; after recovery, lag drains and charts catch up | NFR-REL-05 |
| TS-15 | Trace a request end-to-end in Grafana (Kong → records → Kafka → analytics) using `trace_id` from an error response; switch records-svc to DEBUG at runtime and back | NFR-OBS-01..03 |
| TS-16 | Authorization: user A cannot read or modify user B's trackers/sessions (IDOR tests on every endpoint) | FR-IAM-06, NFR-SEC-01 |
| TS-17 | Catalog seed: fresh deploy seeds 147 activities / 40 templates; re-running is a no-op; changing a template creates v2 and existing trackers stay on v1; curator-edited rows untouched | FR-CAT-13/14 |
| TS-18 | Catalog search: typos ("dumbell", "pushup"), synonyms ("OHP", "RDL"), facets (cricket + fast_bowler; chest + dumbbell + beginner), autocomplete "squ" | FR-CAT-12 |
| TS-19 | History search on the 10K-user dataset: sessions by date, notes text, metric threshold (yorker accuracy ≥ 70 %), entry filter (speed ≥ 140) – correct results and p99 < 2 s on k3s (incl. cold cache) | FR-REC-16, NFR-PERF-10 |
| TS-20 | Search timeouts: an artificially slow query returns 504 `search-timeout` before 2 s (test) / 5 s (prod), never hangs | NFR-PERF-09/10 |

---

## 3. Performance Test Plan (k6)

### 3.1 Workload model (per active user per minute, during a peak hour)

| Action | Share | Endpoint |
|---|---|---|
| Open app / dashboard | 30 % | `GET /analytics/summary`, `GET /trackers` |
| Fetch schema | 15 % | `GET /trackers/{id}/schema` (mostly 304) |
| Live session: start, checkpoint every 3–5 min, complete | 25 % | `POST /sessions`, `POST /sessions/{id}/entries:batch` (10–15 entries), `POST /sessions/{id}/complete` |
| View chart | 25 % | `GET /analytics/series` |
| Browse catalog / profile / other | 5 % | various |

### 3.2 Test types and targets

| Test | k3s test instance (8 vCPU) | AWS beta (pre-launch window) |
|---|---|---|
| **Baseline / load** | 1,000 virtual users, ~150 RPS for 30 min | 10,000 VUs, ~1,500 RPS for 30 min |
| **Stress** | Ramp until p95 > 1 s to find the knee | Ramp to 2× peak (3,000 RPS); HPA/Karpenter must react |
| **Spike** | 0 → 500 VUs in 30 s | 0 → 5,000 VUs in 60 s (e.g. morning reminder burst) |
| **Soak** | 300 VUs for 4 h (memory leaks, connection exhaustion) | 3,000 VUs for 8 h |
| Search mix (with live writes running) | catalog 50 req/s + history 8 req/s on the 45 M-entry dataset; p99 < 2 s | catalog 100 req/s + history 15 req/s on a 13-month dataset; p99 < 1 s (ceiling 5 s) |
| Live-session model | 2,000 concurrent live sessions, 1 ball / 45 s, 240 s checkpoints | 10,000 concurrent live sessions → ~42 checkpoint req/s, ~220 entries/s |
| Pass criteria | p95 reads ≤ 300 ms, writes ≤ 600 ms, errors < 1 % (single-node test env) | NFR-PERF-01/02/06: p95 reads ≤ 200 ms, writes ≤ 400 ms, checkpoint batch ≤ 500 ms, 5xx < 0.5 %, rollup lag after complete ≤ 60 s |

The k3s test environment validates **relative** behaviour: regressions between builds, scaling of pods within the node, and the absence of leaks. The absolute beta targets are proven on AWS before opening registrations.

### 3.3 What to watch during load tests
Kong latency by route; pod CPU/memory and HPA events; Postgres connections, TPS, slow queries (`pg_stat_statements`); Redis hit ratio (target > 90 % for schema/catalog); Kafka consumer lag; GC pauses; error logs with trace IDs.

---

## 4. Test Data Management
- Synthetic data generator (Faker + domain rules) creates users, trackers and up to 2 years of sessions for chart testing.
- The catalog seed is a versioned JSON in Git, loaded by a Kubernetes Job.
- **No real personal data** in test. Beta data never leaves the beta account.
- Payment providers in **test mode** on k3s; store sandbox accounts for IAP.

---

## 5. Entry / Exit Criteria

### 5.1 Promotion: build → k3s test
- CI green (unit, integration, contract, SAST/SCA, image scan, coverage).
- Image signed; SBOM attached.

### 5.2 Promotion: k3s test → AWS beta (release candidate)
- All TS-01…TS-16 pass; no open Sev-1/Sev-2 defects.
- Performance baseline on k3s within ±10 % of the previous release.
- ZAP baseline: no high findings. Trivy: no critical. kube-bench: no fail on critical controls.
- DB migrations proven forward-compatible (old app version against the new schema).
- Release notes and rollback plan approved.

### 5.3 Beta launch (first public release on AWS)
- Infrastructure go-live checklist complete (`04_Deployment_and_Infrastructure.md` §7).
- Full-scale k6 load test passed on AWS.
- Canary analysis templates in Argo Rollouts configured (error rate < 1 %, p95 < 400 ms).
- On-call rota, runbooks and status page ready.
- Store beta tracks approved (TestFlight external testing review, Play open/closed testing).

---

## 6. Beta Release Plan

| Step | Activity | Exit |
|---|---|---|
| 1. Internal alpha | Team + friends on the **k3s test env** via EAS internal builds | Core journeys stable for 1 week |
| 2. Closed beta | 50–200 invited athletes/coaches; **AWS beta**; TestFlight + Play closed testing; payments with 100 % discount coupons | Crash-free sessions ≥ 99 %; feedback triaged |
| 3. Open beta | Public TestFlight link / Play open testing; web open; paid plans live with beta pricing | SLOs met for 30 days; cost within budget |
| 4. GA readiness | 3 AZ, 99.9 % SLO, pen test, DR drill, store production release | Go/No-go review |

**Feedback loop:** in-app feedback (screenshot + logs, opt-in), PostHog funnels (onboarding → first session → day-7 retention), Sentry release health, and a weekly beta review.

---

## 7. Defect Management and Quality Metrics
- Severity: Sev-1 (outage / data loss / security), Sev-2 (major feature broken), Sev-3 (minor), Sev-4 (cosmetic).
- Tracked KPIs: escaped defects per release, change failure rate, MTTR, deployment frequency, lead time (DORA), crash-free users, p95 latency, SLO burn.
