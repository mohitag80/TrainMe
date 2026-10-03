# TrainMe – Prerequisites, Tools & Middleware

| Item | Value |
|---|---|
| Version | 1.0 · 2026-10-03 |
| Purpose | Everything the team needs before and during implementation: accounts, skills, workstation setup, and the recommended tool or middleware per concern, with alternatives |

> Versions: pin the latest **stable / LTS** release of each tool at project start (e.g. Node.js 24 LTS, PostgreSQL 17, the latest Kubernetes minor supported by both k3s and EKS) and record them in `tool-versions` / `.nvmrc` / Renovate config.

---

## 1. Prerequisites

### 1.1 Business and legal
| # | Prerequisite | Why |
|---|---|---|
| B1 | Company / legal entity, bank account | Needed for app store developer accounts and payment providers |
| B2 | **Apple Developer Program** (USD 99/yr) and **Google Play Console** (USD 25 one-time) accounts | Publish iOS/Android apps; TestFlight / Play beta tracks |
| B3 | Payment provider account(s): **Stripe** and/or **Razorpay**; App Store Connect & Play in-app products | Subscriptions and webhooks |
| B4 | Domain name (e.g. `trainme.app`) and DNS control | APIs, web, email (SPF/DKIM/DMARC) |
| B5 | Privacy policy, terms of service, cookie/consent text; DPDP / GDPR assessment (DPIA) for health-like data | Store review and legal compliance |
| B6 | Brand assets: logo, app icons, splash, store screenshots | Store listings |
| B7 | Initial catalog content: at least Cricket (Batter, Bowler, Wicket-keeper), Gym (Strength, Hypertrophy, Cardio), Diet (Daily Meal Log) templates, reviewed by a coach / nutritionist | Valuable first-run experience |

### 1.2 Cloud and SaaS accounts
| # | Account | Used for |
|---|---|---|
| C1 | **AWS Organization** with `shared`, `beta` (later `prod`) accounts; IAM Identity Center; billing alerts | Beta hosting |
| C2 | Test instance: EC2 / VPS / on-prem VM (8 vCPU, 32 GB, 250 GB SSD, Ubuntu 24.04) with a public IP | k3s test environment |
| C3 | **GitHub** organisation (repos, Actions, GHCR, Dependabot/Renovate, Advanced Security optional) | Source, CI, registry |
| C4 | **Expo / EAS** account | Mobile builds, OTA updates, store submission |
| C5 | **Firebase** project (FCM; Crashlytics optional) and **APNs** auth key (.p8) | Push notifications |
| C6 | **Sentry** (SaaS or self-hosted) | Mobile/web/backend error tracking |
| C7 | Google Cloud OAuth client and Apple "Sign in with Apple" service ID | Social login in Keycloak |
| C8 | Amazon SES verified domain (or SendGrid / Postmark) | Transactional email |
| C9 | SonarCloud / SonarQube, Slack, PagerDuty / Opsgenie (optional) | Quality gates, alerts, on-call |
| C10 | Off-host backup bucket (S3 / Backblaze B2) for the test environment | DR for test |

### 1.3 Team skills
| Role | Core skills |
|---|---|
| Backend engineers (2–3) | TypeScript, NestJS, PostgreSQL, Kafka, REST/OpenAPI, DDD, testing (Jest, Testcontainers) |
| Mobile engineer (1–2) | React Native, Expo, offline storage (SQLite/WatermelonDB), push, store publishing |
| Web engineer (1) | Next.js, React, charts (ECharts / Recharts), accessibility |
| DevOps / platform (1) | Kubernetes (k3s, EKS), Helm, Argo CD, Terraform, AWS networking/IAM, observability |
| QA (1) | Playwright, Maestro, k6, Postman/Newman, Pact |
| UX/UI designer (1, part-time) | Mobile-first design systems, Figma, WCAG |
| Product owner | Backlog, catalog content, pricing |

### 1.4 Developer workstation
| Tool | Purpose |
|---|---|
| macOS / Linux (or WSL2), 16–32 GB RAM | Running the local stack |
| **Git**, GitHub CLI (`gh`) | Source control |
| **Node.js 24 LTS** via `fnm`/`nvm`, **pnpm** | Monorepo tooling |
| **Docker Desktop / OrbStack / Colima** | Containers |
| **k3d** (k3s in Docker) or kind, **Tilt** / Skaffold | Local Kubernetes and live reload |
| **kubectl**, **Helm**, **k9s**, **kubectx/kubens**, **stern** | Cluster operations, logs |
| **Argo CD CLI**, **kubeseal** | GitOps and Sealed Secrets |
| **Terraform** (or OpenTofu), **tflint**, **checkov** | AWS IaC |
| **AWS CLI v2**, `aws-vault` / SSO login | AWS access |
| **psql** / pgAdmin / DBeaver, **rpk** (Redpanda CLI), **redis-cli** | Data stores |
| Xcode (macOS) + Android Studio, Expo CLI / EAS CLI | Mobile builds and simulators |
| VS Code / JetBrains IDE + ESLint, Prettier, EditorConfig | Coding standards |
| **draw.io** (desktop or VS Code extension "Draw.io Integration") | Editing the `.drawio` design diagrams |
| Postman / Bruno / Insomnia, **k6** | API exploration and load tests |
| `mkcert` | Local TLS |

---

## 2. Recommended Technology Stack, Tools & Middleware

✅ = recommended choice for TrainMe; alternatives are valid swaps if the team prefers them.

### 2.1 Client applications
| Concern | ✅ Recommended | Alternatives |
|---|---|---|
| Mobile framework | **React Native + Expo** (TypeScript) | Flutter; native Swift/Kotlin |
| Mobile local DB / offline | **WatermelonDB** or **expo-sqlite** + Drizzle | Realm (note: MongoDB Atlas Device Sync is deprecated), MMKV for key-value |
| Mobile navigation / UI | Expo Router, **Tamagui** or React Native Paper | NativeBase, gluestack-ui |
| Web app | **Next.js** (App Router) + React, PWA | Remix, Vite + React SPA |
| Admin console | **Next.js** + **Refine** or React-Admin | Retool (internal), Appsmith |
| Charts | **Victory Native XL** (mobile), **Apache ECharts** / Recharts (web) | react-native-gifted-charts, Chart.js |
| State / data fetching | **TanStack Query**, Zustand | Redux Toolkit + RTK Query |
| Forms from schema | **react-hook-form** + Ajv / zod (schema-driven renderer) | JSON Forms, RJSF (web) |
| Auth client | **react-native-app-auth** / expo-auth-session (PKCE), next-auth / Auth.js (web) | Keycloak JS adapter |
| Design system | Figma + tokens (Style Dictionary) shared by web and mobile | Storybook for component catalog |
| Crash / performance | **Sentry**, Firebase Crashlytics | Bugsnag, Datadog RUM |
| Product analytics | **PostHog** (self-host or cloud, no PII) | Amplitude, Mixpanel |
| In-app purchases | **RevenueCat** (optional) or `react-native-iap` | Direct StoreKit 2 / Play Billing |

### 2.2 Backend services
| Concern | ✅ Recommended | Alternatives |
|---|---|---|
| Language / framework | **TypeScript + NestJS** (Fastify adapter) | Java 21/25 + Spring Boot 3; Go (chi/echo) for hot paths; Kotlin + Ktor |
| ORM / SQL | **Kysely** or **Prisma**; raw SQL for analytics | TypeORM, Drizzle, MikroORM |
| Validation | **zod** / class-validator, **Ajv** (JSON Schema 2020-12) | Joi, Valibot |
| API specification | **OpenAPI 3.1** + `openapi-typescript` / Orval for generated clients | GraphQL (Apollo) for a future BFF; gRPC internally if needed |
| Kafka client | **KafkaJS** or `@confluentinc/kafka-javascript` | node-rdkafka |
| Resilience | **opossum** (circuit breaker), p-retry, timeouts | cockatiel |
| Scheduling (reminders) | **BullMQ** (Redis) delayed jobs or a DB-backed scheduler | Temporal (for complex workflows), Kubernetes CronJobs |
| Feature flags | **OpenFeature** + **Unleash** (self-hosted) | Flagsmith, LaunchDarkly, GrowthBook |
| Monorepo | **Nx** or **Turborepo** + pnpm workspaces | Lerna, Rush |
| Testing | **Jest/Vitest**, **Testcontainers**, **Pact** (contracts), Supertest | Mocha, Karate |

### 2.3 Middleware and data
| Concern | ✅ Recommended (test k3s → beta AWS) | Alternatives |
|---|---|---|
| API gateway | **Kong Gateway OSS + Kong Ingress Controller** (both envs) | AWS API Gateway; Traefik (k3s default) + middlewares; Envoy Gateway; APISIX; Tyk |
| Load balancer | k3s **ServiceLB (klipper)** → **AWS ALB** via AWS Load Balancer Controller | MetalLB (on-prem), NLB |
| Identity provider | **Keycloak** (both envs) | Amazon Cognito; Auth0; Zitadel; Ory Kratos/Hydra; Clerk |
| Relational DB | **PostgreSQL 17**: **CloudNativePG** → **Amazon RDS / Aurora PostgreSQL** | Crunchy PGO, Zalando operator; Citus for sharding at scale |
| Connection pooling | **PgBouncer** (CNPG pooler) → **RDS Proxy** | Pgpool-II |
| DB migrations | **Flyway** (SQL) or Prisma Migrate / Kysely migrations | Liquibase, Atlas, Sqitch |
| Partitioning | **pg_partman** | Native partitioning with custom jobs |
| Event bus | **Kafka API**: **Redpanda** → **Amazon MSK** | Apache Kafka via **Strimzi**; RabbitMQ / Amazon MQ; NATS JetStream; SNS + SQS |
| CDC / outbox relay | In-service poller → **Debezium** (Kafka Connect / MSK Connect) | Redpanda Connect, AWS DMS |
| Schema registry | **Redpanda Schema Registry** → **AWS Glue Schema Registry** (or Confluent-compatible) | Apicurio Registry |
| Cache | **Valkey / Redis**: Bitnami chart → **ElastiCache (Valkey)** | Dragonfly, KeyDB, Memcached |
| Object storage | **MinIO** → **Amazon S3** | Ceph RGW, SeaweedFS |
| Email | **Amazon SES** (both envs; sandbox in test) | SendGrid, Postmark, Mailgun; **Mailpit** for local |
| Push | **FCM HTTP v1** + **APNs** (token auth) | Expo Push Service, OneSignal, Amazon SNS mobile push |
| Search (future) | PostgreSQL full-text + `pg_trgm` | OpenSearch, Meilisearch, Typesense |
| Analytical store (future) | Kafka → S3 Parquet + Athena; **ClickHouse** | Amazon Redshift, TimescaleDB (self-managed), Apache Druid |

### 2.4 Platform, Kubernetes and DevOps
| Concern | ✅ Recommended | Alternatives |
|---|---|---|
| Kubernetes (test) | **k3s** (single node, Traefik disabled) | MicroK8s, k0s, RKE2, kubeadm |
| Kubernetes (beta) | **Amazon EKS** + **Karpenter** | ECS Fargate (not k8s – loses parity), EKS Auto Mode |
| Packaging | **Helm** (one shared service chart + umbrella chart) | Kustomize (overlays on top of Helm also fine) |
| GitOps / CD | **Argo CD** + **Argo Rollouts** (canary) | Flux + Flagger |
| CI | **GitHub Actions** | GitLab CI, Jenkins, CircleCI, Buildkite |
| Container registry | **GHCR** (test) / **Amazon ECR** (beta) | Harbor, Docker Hub, Quay |
| IaC | **Terraform** (or OpenTofu) + Terraform AWS modules; **Ansible** for the test VM | Pulumi (TypeScript), AWS CDK, Crossplane |
| Secrets | **Sealed Secrets** (k3s) / **AWS Secrets Manager + External Secrets Operator** (EKS) | HashiCorp Vault / OpenBao, SOPS + age |
| Certificates | **cert-manager** + Let's Encrypt; **ACM** on AWS | — |
| Policy and admission | **Kyverno** | OPA Gatekeeper |
| Autoscaling | **HPA**, **KEDA** (Kafka lag), **VPA** (recommend), **Karpenter** | Cluster Autoscaler |
| Service mesh (GA, optional) | **Linkerd** (mTLS, golden metrics) | Istio Ambient, Cilium Service Mesh |
| Networking / CNI | k3s Flannel (test), **AWS VPC CNI** (EKS) + NetworkPolicies (Calico / VPC CNI policy) | Cilium |
| Backup | **CNPG Barman** to S3/MinIO, **Velero** (cluster), **AWS Backup** | Kasten K10 |
| Supply chain | **cosign** (Sigstore), **Syft** SBOM, **Trivy**, **Renovate** | Grype, Snyk, Dependabot |
| Code quality and security | **SonarCloud**, **CodeQL / Semgrep**, **Gitleaks**, **Checkov** / tfsec | Snyk Code, GitGuardian |
| Mobile CI/CD | **EAS Build / Submit / Update** | Fastlane + GitHub Actions, Bitrise, Codemagic |

### 2.5 Observability (TR-7)
| Concern | ✅ Recommended | Alternatives |
|---|---|---|
| Instrumentation | **OpenTelemetry SDK** (Node auto-instrumentations), W3C traceparent | Vendor agents |
| Collection | **OpenTelemetry Collector** (DaemonSet agent + gateway) | Grafana Alloy, Fluent Bit (logs), Vector |
| Logs | **pino** (JSON) → **Loki** (S3 backend on AWS) | OpenSearch, CloudWatch Logs, Elastic |
| Metrics | **Prometheus** (kube-prometheus-stack) | Amazon Managed Prometheus, VictoriaMetrics, Grafana Mimir |
| Traces | **Grafana Tempo** | Jaeger, AWS X-Ray |
| Dashboards and alerting | **Grafana** + **Alertmanager** / Grafana Alerting | Amazon Managed Grafana, Datadog, New Relic |
| SLOs | **Sloth** or Pyrra (SLO → Prometheus rules) | Grafana SLO |
| Errors | **Sentry** | Rollbar, Bugsnag |
| Synthetic monitoring | Grafana Synthetic Monitoring / k6 browser checks | CloudWatch Synthetics, Checkly |
| On-call | Slack + PagerDuty / Opsgenie / Grafana OnCall | — |

### 2.6 Testing tools
| Type | ✅ Tool |
|---|---|
| Unit | Jest / Vitest |
| Integration | Testcontainers (Postgres, Redpanda, Redis) |
| Contract | Pact (+ Pact Broker / PactFlow) |
| API functional | Postman/Newman or Bruno, REST Assured-style Supertest |
| Web E2E | Playwright |
| Mobile E2E | Maestro (or Detox) |
| Load / performance | **k6** (+ k6 Operator to run in-cluster on k3s) |
| Security | OWASP ZAP (baseline + API scan), Trivy, kube-bench, kube-hunter, MobSF (mobile binaries) |
| Chaos (pre-GA) | Chaos Mesh / LitmusChaos, AWS Fault Injection Service |
| Accessibility | axe-core / Lighthouse CI, React Native accessibility checks |

### 2.7 Documentation and collaboration
| Concern | ✅ Tool |
|---|---|
| Architecture diagrams | **draw.io** (`.drawio` files in this repo; C4, AWS 2025, Kubernetes, UML and ER shape libraries) |
| API docs | OpenAPI + Redocly / Scalar / Swagger UI published per environment |
| Architecture decisions | ADR markdown files (`docs/adr/`), MADR template |
| Developer portal (optional) | Backstage (service catalog, templates) |
| Work tracking | Jira / Linear / GitHub Projects |

---

## 3. Repository Layout

**All code lives under `src/`** (owner's rule). Design material and content stay at the top level.

```
TrainMe/
  src/
    apps/
      mobile/            # React Native (Expo)
      web/               # Next.js
      admin/             # Next.js + Refine
    services/
      catalog-svc/  tracker-svc/  records-svc/  analytics-svc/
      user-profile-svc/  subscription-svc/  notification-svc/
    libs/                # auth, observability, kafka, errors, schema, units, sync, ui-tokens, api-clients
    deploy/
      compose/                  # Docker Compose stack for local / RHEL VM testing
      charts/trainme-service/   # shared Helm chart
      charts/trainme/           # umbrella chart
    infra/
      terraform/                # AWS
      ansible/                  # test VM hardening + k3s install
  catalog/                      # Phase 1 catalog content (seed JSON) + its builder script
  docs/                         # these design documents
  diagrams/                     # draw.io sources + PNG exports
  design/                       # UI mockups and demo video tooling
gitops/ (separate repo)
  bootstrap/  platform/  envs/{test,beta}/
```

---

## 4. Implementation Phases (suggested)

| Phase | Duration (indicative) | Scope | Environment |
|---|---|---|---|
| 0 – Foundations | 2–3 weeks | Monorepo, service template, CI, k3s test env, Argo CD, Keycloak, Kong, observability baseline | k3s |
| 1 – Core tracking (MVP) | 6–8 weeks | Catalog (+ admin), trackers + custom params, records + offline sync, basic charts, profile | k3s |
| 2 – Monetisation and engagement | 3–4 weeks | Subscriptions (Stripe/Razorpay + IAP), entitlements, reminders/push, PRs and streaks | k3s |
| 3 – Hardening | 2–3 weeks | Load tests, security tests, accessibility, data export/erasure, runbooks | k3s |
| 4 – AWS beta | 2 weeks | Terraform AWS, migrate charts to EKS, canary releases, store beta tracks, go-live checklist | AWS |
| 5 – Beta feedback loop | ongoing | Iterate on catalog, UX, performance; plan GA (3 AZ, SLO 99.9 %) | AWS |
