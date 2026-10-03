# TrainMe – Design Package

TrainMe is a subscription app for tracking daily work: gym workouts, diet and sports practice. Users pick a curated profile (e.g. *Sports › Cricket › Bowler*), customise its parameters, record sessions every day, and see daily, weekly and monthly charts on mobile and web.

The product brief is in [`Product_requirements.txt`](Product_requirements.txt).

## Documents (`docs/`)

> **v1.3 (2026-10-03):** sessions are identified by **date + unique name** per user, with any number of sessions per day (several can be in progress at once), and **units are editable** per user and per parameter (km/h ↔ mph ↔ m/s, kg ↔ lb ↔ g ↔ oz, km ↔ mi …) with values stored in canonical units. See SRS FR-PRF-06, FR-TRK-09..10, FR-REC-17..20, FR-ANL-10..11, HLD ADR-014/015, LLD §2.3, §3.1 and §4.5.
>
> **v1.2 (2026-10-03):** Phase 1 catalog knowledge base (147 activities, 40 templates, seed file + builder), reusable activity library and parameter sets, JSONB entry storage, and the search design for 10K users (< 5 s prod / < 2 s test).
>
> **v1.1 (2026-10-03):** granular live sessions (log every ball / set / item; checkpoint sync every 3–5 min; submit on End; auto-close), conditional parameters (attempted → accurate), and catalog-defined ratio metrics (Σnum ÷ Σden). See SRS FR-CAT-09..11 and FR-REC-09..15, HLD ADR-009/010, LLD §2.4.1 (worked Fast Bowler example) and §4.5.

| # | Document | Contents |
|---|---|---|
| 01 | [Software Requirements Specification](docs/01_Software_Requirements_Specification.md) | Scope, personas, **functional requirements** (IAM, profile, subscription, catalog, trackers, recording, analytics, notifications, admin, API), **non-functional requirements** (performance, scalability, availability, security, privacy, observability, extensibility, usability, portability, cost), traceability matrix |
| 02 | [High-Level Design](docs/02_High_Level_Design.md) | Principles, C4 context/containers, service catalog, ADRs (microservices, PostgreSQL + JSONB vs MongoDB, Kafka, Kong + Keycloak, rollups, React Native, offline-first, GitOps), security, caching and scaling, extensibility roadmap, risks |
| 03 | [Low-Level Design](docs/03_Low_Level_Design.md) | Service structure, PostgreSQL DDL per service, effective schema compilation, REST API spec, error model, Kafka event catalog, sequence flows, caching keys, validation, config |
| 04 | [Deployment & Infrastructure](docs/04_Deployment_and_Infrastructure.md) | Environments, **k3s test instance** setup, **AWS beta** (VPC, EKS, RDS, ElastiCache, MSK, S3…), Terraform, scaling, CI/CD, DR, cost estimate, go-live checklist |
| 05 | [Prerequisites, Tools & Middleware](docs/05_Prerequisites_Tools_and_Middleware.md) | Accounts and legal prerequisites, team skills, workstation setup, recommended tools and middleware with alternatives, repo layout, phases |
| 06 | [Test Strategy & Release Plan](docs/06_Test_Strategy_and_Release_Plan.md) | Test pyramid, critical scenarios, k6 performance plan, entry/exit criteria, beta release plan |
| 07 | [Phase 1 Activity Catalog](docs/07_Phase1_Activity_Catalog.md) | **Generated** knowledge base: cricket roles (batter, fast/spin bowler, keeper, fielder, all-rounder), tennis & badminton (no roles), football positions, athletics, shared conditioning, gym by muscle group; parameters, conditions, metrics, sources |
| 08 | [Search & Query Performance](docs/08_Search_and_Query_Performance.md) | 10K-user workload model, search types → tables/indexes, DDL, query shapes, timeouts (< 5 s prod / < 2 s test), caching, Postgres tuning, verification plan, growth path |
| 09 | [Design Patterns Guide](docs/09_Design_Patterns.md) | ~60 patterns used in TrainMe (architecture, messaging, data, resilience, security, observability, delivery, code, testing). Each has a beginner explanation, where it is used, why it was adopted, benefits and costs, the FR/NFR IDs it supports, quality attributes and learning links. Also covers patterns deliberately not used and a suggested learning order |
| 10 | [Implementation Conventions](docs/10_Implementation_Conventions.md) | Toolchain pins and naming rules for code, APIs, database objects, events, config and secrets |
| 11 | [Test Environment Runbook](docs/11_Test_Environment_Runbook.md) | **Start here for hands-on work**: URLs, deploy/update steps, test users, access tokens, creating users, API endpoints, database (DBeaver) access, Kafka/cache inspection, logs, smoke test, troubleshooting |

## UI mockups & demo video (`design/`)

- `design/demo/TrainMe_Demo.mp4` – narrated, subtitled product demo (member sign-up, login, live ball-by-ball logging, offline sync, charts, history, compare, gym, plans; admin MFA, overview, catalog manager, support, releases)
- `design/mockups/index.html` – clickable mockups (use the ← → keys); `design/screens/` – 1920×1080 PNG of every screen
- `design/README.md` – scene list with requirement IDs, plus rebuild instructions

## Catalog seed (`catalog/`)

- `catalog/tools/build_phase1_catalog.py` – the source of truth for Phase 1 content. It validates the catalog and regenerates the seed file and doc 07: `python3 catalog/tools/build_phase1_catalog.py`
- `catalog/phase1/catalog.json` – seed loaded into `catalog_db` by the catalog-seed Job on every deployment (LLD §11)

## Diagrams (`diagrams/`)

Editable **draw.io** files. Open them with [diagrams.net](https://app.diagrams.net), draw.io Desktop, or the VS Code *Draw.io Integration* extension. PNG previews are in `diagrams/png/`. `TrainMe_All_Diagrams.drawio` contains every diagram as a separate page.

| File | Diagram | Shapes used |
|---|---|---|
| `01_system_context.drawio` | System context (C4 L1) | C4 person / system / external |
| `02_microservices_architecture.drawio` | Microservices architecture (C4 L2) | Containers, cylinders (DBs), horizontal cylinder (event bus) |
| `03_data_model_erd.drawio` | Logical data model per service | ER tables, crow's-foot relationships |
| `04_activity_taxonomy_schema.drawio` | Catalog taxonomy, templates, overrides, effective schema | Tree, UML-style class lists |
| `05_seq_auth_subscription.drawio` | Sign-up / login (OIDC + PKCE) + subscription | UML sequence (lifelines, activations, alt frame) |
| `06_seq_record_session.drawio` | Live granular session: log per ball, checkpoint every 3–5 min, submit on End | UML sequence |
| `07_seq_view_charts.drawio` | View daily/weekly/monthly charts | UML sequence |
| `08_seq_custom_parameter.drawio` | User adds / edits a custom parameter | UML sequence |
| `09_deploy_k3s_test.drawio` | k3s test environment | Kubernetes icons (deploy, sts, svc, hpa, pvc, ds) |
| `10_deploy_aws_beta.drawio` | AWS beta deployment | AWS 2025 icon set, AWS groups (cloud, region, VPC, AZ, subnets) |
| `11_cicd_pipeline.drawio` | CI/CD and release flow | BPMN-style swimlanes, decisions |
| `12_observability.drawio` | Logs, metrics, traces, alerting | Flow |
| `13_phase1_catalog_taxonomy.drawio` | Phase 1 catalog: sports → roles, gym → muscle groups → templates | Tree |
| `14_search_query_paths.drawio` | Search types → APIs → tables/indexes, caches and timeouts | Flow, cylinders |
