# TrainMe – Design Patterns Guide (with Learning Materials)

| Item | Value |
|---|---|
| Version | 1.0 · 2026-10-03 |
| Audience | Engineers building their first end-to-end product. Each pattern is explained from scratch |
| Related | SRS `01` (requirement IDs), HLD `02` (ADRs), LLD `03`, Search `08` |

---

## How to read this guide

Each pattern has the same layout:

- **In one line** – the idea in plain words.
- **Where in TrainMe** – the exact place it is used.
- **Why we adopted it** – the problem it solves for this product.
- **Benefits** and **Costs / watch-outs** – no pattern is free.
- **Helps requirements** – the SRS IDs it supports (FR = functional, NFR = non-functional).
- **Quality attributes** – which "-ilities" it improves (legend below).
- **Learn** – 1–3 hand-picked resources: start with the first link.

### Quality-attribute legend

| Tag | Meaning in this guide |
|---|---|
| **Performance** | Lower latency for a single request |
| **Throughput** | More requests or events handled per second |
| **Scalability** | Can grow by adding instances without redesign |
| **Availability** | System stays up when parts fail |
| **Reliability** | Correct behaviour under retries, crashes and network loss |
| **Data consistency** | Correct database transactions, no lost or duplicated writes |
| **Security** | Authentication, authorization, protection from attacks |
| **Privacy** | Personal data protection, erasure and minimisation |
| **Observability** | Can see what the system is doing (logs, metrics, traces) |
| **Maintainability** | Easy to change and understand |
| **Extensibility** | New features or sports without rewriting old parts |
| **Testability** | Easy to test automatically |
| **Deployability** | Safe, frequent, low-risk releases |
| **Portability** | Runs the same on k3s and AWS |
| **Usability** | Better experience for the user |
| **Cost** | Lower infrastructure or operating cost |

### Suggested learning order (first E2E project)

| Week | Read / practise | Why first |
|---|---|---|
| 1 | Hexagonal architecture, Repository, 12-Factor, Health checks, Structured logging | You need these in the very first service you write |
| 2 | Database per service, API Gateway, Access token (OIDC + PKCE), Optimistic concurrency, Idempotency key | Needed as soon as clients call your API |
| 3 | Pub/Sub, Transactional outbox, Idempotent consumer, Cache-aside, Materialized view | Needed when the second service appears |
| 4 | Retry + backoff, Timeouts, Circuit breaker, Bulkhead, Rate limiting, Distributed tracing | Needed before load testing |
| 5 | GitOps, Canary, Feature toggles, Expand/contract migrations, IaC | Needed before the first AWS beta release |

### Core books (worth buying)

| Book | Covers |
|---|---|
| Chris Richardson – *Microservices Patterns* (Manning) | Most of sections A and B |
| Martin Kleppmann – *Designing Data-Intensive Applications* (O'Reilly) | Databases, replication, partitioning, events, consistency |
| Sam Newman – *Building Microservices*, 2nd ed. (O'Reilly) | Service boundaries, deployment, testing, security |
| Michael Nygard – *Release It!*, 2nd ed. (Pragmatic) | Stability patterns: timeouts, circuit breakers, bulkheads |
| Vaughn Vernon – *Domain-Driven Design Distilled* (Addison-Wesley) | Bounded contexts and aggregates, in a short book |
| Freeman & Robson – *Head First Design Patterns*, 2nd ed. (O'Reilly) | GoF patterns explained gently |

Free pattern catalogues used throughout: [microservices.io](https://microservices.io/patterns/), [Azure Architecture Center – Cloud Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/patterns/), [Martin Fowler – Patterns of Distributed Systems](https://martinfowler.com/articles/patterns-of-distributed-systems/), [AWS Builders' Library](https://aws.amazon.com/builders-library/), [Refactoring.Guru – Design Patterns](https://refactoring.guru/design-patterns).

---

## Summary matrix

| # | Pattern | Category | Main quality attributes | Key requirements |
|---|---|---|---|---|
| A1 | Microservices | Architecture | Scalability, Deployability, Maintainability | NFR-SCAL-02, NFR-MNT-02 |
| A2 | Bounded contexts (DDD) | Architecture | Maintainability, Extensibility | NFR-MNT-02 |
| A3 | Database per service | Architecture / Data | Scalability, Availability, Maintainability | NFR-SCAL-02, NFR-REL-05 |
| A4 | API Gateway + Gateway offloading | Architecture / Security | Security, Performance, Maintainability | FR-API-01, NFR-SEC-05/06, NFR-SCAL-04 |
| A5 | Hexagonal architecture (Ports & Adapters) | Code structure | Testability, Maintainability, Portability | NFR-MNT-04, NFR-PORT-02 |
| A6 | Aggregate | Domain / Data | Data consistency | FR-REC-01, FR-TRK-06 |
| B1 | Publish / Subscribe (event-driven) | Integration | Scalability, Availability, Extensibility | NFR-MNT-02, NFR-REL-05 |
| B2 | Transactional Outbox | Integration / Data | Data consistency, Reliability | NFR-REL-03, NFR-PERF-03 |
| B3 | Idempotent Consumer | Integration | Reliability, Data consistency | FR-ANL-02, NFR-REL-03 |
| B4 | Competing Consumers + Queue-based load levelling | Integration | Throughput, Scalability, Availability | NFR-SCAL-01/02, NFR-PERF-03 |
| B5 | Saga (choreography) + Compensating transaction | Integration / Data | Data consistency, Privacy | FR-PRF-04, NFR-PRIV-01, FR-SUB-02 |
| B6 | Claim Check | Integration | Throughput, Reliability | FR-REC-01, NFR-SCAL-03 |
| B7 | Event schema versioning (Tolerant Reader + CloudEvents) | Integration | Maintainability, Extensibility | NFR-MNT-02 |
| B8 | Dead-letter queue | Integration / Reliability | Reliability, Observability | NFR-REL-02 |
| C1 | CQRS (read models) | Data | Performance, Scalability | FR-ANL-01, FR-REC-16, NFR-PERF-01/09 |
| C2 | Materialized view / pre-aggregation | Data | Performance, Throughput | FR-ANL-01/02/08, NFR-PERF-01/03 |
| C3 | Cache-aside | Data / Performance | Performance, Throughput, Cost | NFR-SCAL-05, NFR-PERF-01 |
| C4 | Metadata-driven schema (JSON Schema) | Data / Extensibility | Extensibility, Maintainability, Data integrity | FR-CAT-02/03/09, FR-REC-02, NFR-MNT-01 |
| C5 | Prototype + Copy-on-write (template ⊕ overrides) | Data / Domain | Extensibility, Data integrity | FR-TRK-01..04 |
| C6 | Immutable versioning | Data | Data consistency, Reliability | FR-CAT-04, FR-TRK-08 |
| C7 | Optimistic concurrency control | Data / API | Data consistency, Performance | FR-TRK-06, FR-REC-05/15 |
| C8 | Idempotency key | API / Data | Reliability, Data consistency | FR-API-03, FR-REC-11, FR-SUB-04 |
| C9 | Tombstone (soft delete) | Data / Sync | Reliability, Data consistency | FR-REC-11, FR-REC-05 |
| C10 | Partitioning + archiving (and sharding later) | Data | Performance, Scalability, Cost | NFR-SCAL-03, NFR-PERF-11 |
| C11 | Keyset pagination + bounded queries | Data / API | Performance | FR-API-02, NFR-PERF-09/10/11 |
| C12 | Read replica | Data | Throughput, Availability | NFR-PERF-09, NFR-SCAL-01 |
| D1 | Local-first / offline-first with checkpoint sync | Client / Reliability | Reliability, Usability, Throughput | FR-REC-04/09..13, NFR-REL-07, NFR-PERF-08 |
| D2 | Timeouts + deadline propagation | Reliability | Availability, Performance | NFR-PERF-09/10, NFR-REL-05 |
| D3 | Retry with exponential backoff + jitter | Reliability | Reliability, Availability | NFR-REL-02, FR-REC-10 |
| D4 | Circuit breaker | Reliability | Availability, Performance | NFR-REL-05 |
| D5 | Bulkhead | Reliability | Availability | NFR-REL-05 |
| D6 | Rate limiting / throttling | Reliability / Security | Security, Availability, Cost | NFR-SEC-06, FR-IAM-07 |
| D7 | Health endpoint monitoring (probes) | Operations | Availability, Deployability | NFR-REL-01/02/06 |
| D8 | Graceful shutdown | Operations | Reliability, Deployability | NFR-REL-06 |
| D9 | Scheduled job + leader election | Operations | Reliability | FR-REC-13, FR-NTF-01 |
| E1 | Access token (OIDC Authorization Code + PKCE) | Security | Security | FR-IAM-01..03, NFR-SEC-05 |
| E2 | Federated identity | Security | Security, Usability | FR-IAM-02/04 |
| E3 | Defence in depth / zero trust | Security | Security, Privacy | NFR-SEC-01/02/05, NFR-PRIV-02 |
| E4 | Externalized configuration & secrets | Security / Operations | Security, Portability | NFR-SEC-04, NFR-MNT-06 |
| E5 | Supply-chain security (signed images + policy as code) | Security / Delivery | Security | NFR-SEC-07 |
| E6 | Audit log | Security | Security, Privacy | FR-ADM-03, NFR-SEC-08 |
| F1 | Distributed tracing + correlation ID | Observability | Observability | NFR-OBS-03, TR-7 |
| F2 | Structured log aggregation | Observability | Observability, Privacy | NFR-OBS-01/02/07, NFR-PRIV-03 |
| F3 | Metrics, SLOs & burn-rate alerting | Observability | Observability, Availability | NFR-OBS-04/05 |
| F4 | Exception tracking | Observability | Observability, Usability | NFR-OBS-06 |
| F5 | Node agent (DaemonSet collector) | Observability | Observability, Cost | NFR-OBS-01/03 |
| G1 | 12-Factor App | Delivery | Portability, Deployability | NFR-MNT-06, NFR-PORT-01 |
| G2 | GitOps | Delivery | Deployability, Security, Reliability | NFR-PORT-01, NFR-REL-06 |
| G3 | Build once, deploy many (immutable artefacts) | Delivery | Deployability, Security | NFR-PORT-01, NFR-SEC-07 |
| G4 | Canary release | Delivery | Availability, Deployability | NFR-REL-06, NFR-PERF-06 |
| G5 | Feature toggles | Delivery | Deployability, Extensibility | NFR-MNT-05 |
| G6 | Expand / contract (parallel change) migrations | Delivery / Data | Availability, Data consistency | NFR-REL-06 |
| G7 | Infrastructure as Code | Delivery | Reliability, Portability, Cost | NFR-PORT-01, NFR-REL-03 |
| G8 | Seed data as code | Delivery / Data | Maintainability, Portability | FR-CAT-13, NFR-MNT-01 |
| G9 | Horizontal autoscaling (HPA / KEDA / Karpenter) | Delivery / Scale | Scalability, Cost, Availability | NFR-SCAL-01/02, NFR-COST-02 |
| H1 | Repository | Code | Testability, Maintainability | NFR-MNT-04 |
| H2 | Adapter | Code | Portability, Testability | NFR-PORT-02 |
| H3 | Strategy | Code | Extensibility | FR-ANL-02, FR-CAT-10 |
| H4 | Interpreter | Code | Extensibility, Security | FR-CAT-08/10 |
| H5 | Specification | Code | Extensibility, Security | FR-CAT-10, FR-REC-16 |
| H6 | Builder | Code | Maintainability, Data integrity | FR-CAT-13 |
| H7 | Factory | Code | Maintainability | FR-REC-02, FR-CAT-09 |
| H8 | Observer | Code | Extensibility | NFR-MNT-02 |
| I1 | Test pyramid + consumer-driven contracts | Testing | Testability, Deployability | NFR-MNT-03/04 |

---

## A. Architecture patterns

### A1. Microservices

**In one line:** build the system as several small services. Each service does one business job, is deployed on its own and scales on its own.

**Where in TrainMe:** 7 services: catalog, tracker, records, analytics, user-profile, subscription and notification (HLD §4).

**Why we adopted it:** the brief demands that "each component can be scaled independently" (TR-1). Recording traffic (records-svc) is about 10× heavier than catalog browsing, so scaling them separately saves money and avoids one hot spot slowing everything.

**Benefits**
- Scale only what is busy: records-svc runs 3–20 pods while subscription-svc runs 2.
- A bug or deployment in notification-svc cannot take recording down.
- Smaller codebases are easier to understand and test.

**Costs / watch-outs**
- More moving parts: network calls fail, data is spread out, and you must learn events, tracing and GitOps.
- Don't split further than needed. 7 services is deliberate, so don't create a service per table.

**Helps requirements:** NFR-SCAL-01, NFR-SCAL-02, NFR-MNT-02, NFR-REL-05, NFR-REL-06 · **Quality attributes:** Scalability, Deployability, Maintainability, Availability

**Learn:** [microservices.io – Microservice architecture](https://microservices.io/patterns/microservices.html) · [Martin Fowler – Microservices](https://martinfowler.com/articles/microservices.html) · Book: *Building Microservices* (Newman)

---

### A2. Bounded contexts (Domain-Driven Design)

**In one line:** draw service boundaries around business areas ("contexts") where words have one clear meaning.

**Where in TrainMe:** "Activity" in the Catalog context is a *definition* (e.g. Bench Press with its parameters). In the Records context it means *what you actually did* (sets on 3 Oct). Each context owns its own model, and the boundaries are exactly the 7 services.

**Why we adopted it:** it gives a principled way to decide service boundaries, so they don't follow technical layers.

**Benefits**
- Teams and code change independently.
- Fewer "god objects".
- New features land in one context (e.g. a future coach context).

**Costs / watch-outs:** the same real-world thing exists in several models, so you translate between them through IDs and events.

**Helps requirements:** NFR-MNT-02, FR-CAT-14, FR-TRK-01 · **Quality attributes:** Maintainability, Extensibility

**Learn:** [Martin Fowler – Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) · [microservices.io – Decompose by subdomain](https://microservices.io/patterns/decomposition/decompose-by-subdomain.html) · Book: *Domain-Driven Design Distilled* (Vernon)

---

### A3. Database per service

**In one line:** each service has its own private database. No other service reads or writes its tables directly.

**Where in TrainMe:** `catalog_db`, `tracker_db`, `records_db`, `analytics_db`, `profile_db`, `billing_db`, `notification_db`. Cross-service references are only IDs (dashed lines in ERD `03`).

**Why we adopted it:** a shared database would silently couple all services. One heavy analytics query could slow recording, and every schema change would need all teams.

**Benefits**
- Each database is tuned and scaled for its workload: records is write-heavy and partitioned, catalog is read-heavy and cached.
- Failure isolation, and safe independent schema changes.

**Costs / watch-outs**
- No SQL joins or foreign keys across services, and no single ACID transaction across services.
- Consistency across services is eventual. The outbox and saga patterns handle this.
- Beta may still put several databases on one RDS instance; the logical separation is what matters.

**Helps requirements:** NFR-SCAL-02, NFR-REL-05, NFR-MNT-02 · **Quality attributes:** Scalability, Availability, Maintainability · **DB transactions:** ACID *inside* a service only

**Learn:** [microservices.io – Database per service](https://microservices.io/patterns/data/database-per-service.html) · Book: *Microservices Patterns* ch. 4–5

---

### A4. API Gateway + Gateway offloading

**In one line:** clients talk to one front door, which routes requests to services and does the common chores (auth checks, rate limits, CORS, request IDs, timeouts).

**Where in TrainMe:** Kong Ingress Controller on both k3s and EKS (HLD ADR-004).

**Why we adopted it:** mobile apps must not know 7 service addresses, and every service would otherwise re-implement token validation and throttling.

**Benefits**
- One place for security policies and rate limits.
- Simpler clients.
- Consistent request IDs and tracing.
- Lets us change service layout without app updates.

**Costs / watch-outs:** it is a critical component, so run ≥ 2 replicas. Keep business logic **out** of the gateway.

**Helps requirements:** FR-API-01, FR-API-04, NFR-SEC-05, NFR-SEC-06, NFR-SCAL-04, NFR-PERF-09/10 (timeouts), NFR-OBS-03 · **Quality attributes:** Security, Performance, Maintainability, Observability

**Learn:** [microservices.io – API Gateway / BFF](https://microservices.io/patterns/apigateway.html) · [Azure – Gateway Offloading](https://learn.microsoft.com/en-us/azure/architecture/patterns/gateway-offloading) · [Kong Gateway docs](https://docs.konghq.com/gateway/latest/)

---

### A5. Hexagonal architecture (Ports & Adapters)

**In one line:** keep business rules in the centre, free of frameworks. Databases, Kafka, HTTP and Redis plug in at the edges through interfaces.

**Where in TrainMe:** every service uses `api/ → application/ → domain/ ← infrastructure/` (LLD §1). For example, the rollup maths lives in `domain/` and has no idea it runs on Kafka.

**Why we adopted it:** your first project will change technologies (e.g. swap the outbox poller for Debezium, Redpanda for MSK). Business logic should not need rewriting when you do.

**Benefits**
- Domain logic is unit-testable in milliseconds without a database.
- Infrastructure can be swapped (k3s ↔ AWS).
- Code is easier to navigate.

**Costs / watch-outs:** more files and interfaces. Keep it pragmatic, with one adapter per real dependency.

**Helps requirements:** NFR-MNT-04, NFR-PORT-01, NFR-PORT-02 · **Quality attributes:** Testability, Maintainability, Portability

**Learn:** [Alistair Cockburn – Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) · [AWS Prescriptive Guidance – Hexagonal architecture pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html)

---

### A6. Aggregate (DDD)

**In one line:** a cluster of objects that must change together inside **one** database transaction, accessed only through its root.

**Where in TrainMe:** `activity_session` (root) with its `activity_entry` rows; `user_tracker` with its overrides and effective schema.

**Why we adopted it:** it defines exactly what one transaction may touch. That keeps transactions small and fast, and the rules always hold (e.g. `entry_count` matches entries, `schema_version` increments with each override).

**Benefits:** clear consistency boundaries, short database transactions, and fewer lock conflicts.

**Costs / watch-outs:** rules spanning two aggregates (e.g. tracker and session) are eventually consistent.

**Helps requirements:** FR-REC-01, FR-REC-12, FR-TRK-06 · **Quality attributes:** Data consistency, Performance

**Learn:** [Martin Fowler – DDD Aggregate](https://martinfowler.com/bliki/DDD_Aggregate.html)

---

## B. Integration & messaging patterns

### B1. Publish / Subscribe (event-driven architecture)

**In one line:** a service announces "something happened" on a topic, and any interested service reacts in its own time.

**Where in TrainMe:** Kafka topics such as `record.events`, `tracker.events` and `user.events` (LLD §5). For example, records-svc publishes `record.session.completed`, and analytics and notification consume it.

**Why we adopted it:** recording must not wait for charts or notifications to update (TR-8). New features (coach dashboards, AI insights) can subscribe later **without changing records-svc**.

**Benefits**
- Loose coupling.
- Graceful degradation: recording works even if analytics is down.
- Easy extension.
- Kafka keeps events, so they can be **replayed** to rebuild rollups.

**Costs / watch-outs**
- Eventual consistency (charts lag by seconds).
- Messages can be duplicated or reordered, so consumers must be idempotent (B3).
- Debugging needs tracing (F1).

> We use events as **notifications**, not **event sourcing**. Tables remain the source of truth (see "Patterns we deliberately did not use").

**Helps requirements:** NFR-MNT-02, NFR-REL-05, NFR-PERF-03, FR-ANL-01, FR-NTF-03 · **Quality attributes:** Scalability, Availability, Extensibility, Throughput

**Learn:** [Azure – Publisher-Subscriber](https://learn.microsoft.com/en-us/azure/architecture/patterns/publisher-subscriber) · [Martin Fowler – What do you mean by "Event-Driven"?](https://martinfowler.com/articles/201701-event-driven.html) · [Apache Kafka – Introduction](https://kafka.apache.org/intro)

---

### B2. Transactional Outbox

**In one line:** write the business change **and** the event to the same database in **one transaction**. A relay then publishes the event to Kafka.

**Where in TrainMe:** every service has an `outbox_event` table (LLD §2.6). Completing a session sets status `COMPLETED` and inserts `record.session.completed` atomically.

**Why we adopted it:** without it, you face the "dual-write" problem. Save to the database, then crash before publishing, and analytics never learns about the session. Publish first, then the database fails, and charts show a session that doesn't exist.

**Benefits**
- **Exactly one source of truth**: the event exists if and only if the change committed.
- No distributed transaction (2PC) needed.
- Works with a simple poller first and Debezium CDC later.

**Costs / watch-outs**
- Events are delivered **at least once** (the relay may republish after a crash), hence B3.
- The outbox table must be cleaned up.

**Helps requirements:** NFR-REL-03, NFR-PERF-03, FR-ANL-01, FR-PRF-04 · **Quality attributes:** Data consistency, Reliability · **DB transactions:** core pattern for safe "save + notify"

**Learn:** [microservices.io – Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) · [Debezium – Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)

---

### B3. Idempotent Consumer

**In one line:** processing the same message twice has the same effect as processing it once.

**Where in TrainMe:** analytics-svc records each processed `event_id` in `processed_event` and skips repeats. Rollups for edits are **recomputed** from DAY rows instead of adding deltas (LLD §2.4).

**Why we adopted it:** Kafka and the outbox guarantee at-least-once delivery. Without idempotency, a retry would double-count a session: yorker accuracy 24/36 instead of 12/18.

**Benefits:** retries and replays become safe, and charts stay correct after crashes or reprocessing.

**Costs / watch-outs:** the de-duplication table needs cleanup, and the duplicate check must be in the **same transaction** as the update.

**Helps requirements:** FR-ANL-02, FR-ANL-08, NFR-REL-03, NFR-REL-02 · **Quality attributes:** Reliability, Data consistency

**Learn:** [microservices.io – Idempotent consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html) · [Martin Fowler – Idempotent Receiver](https://martinfowler.com/articles/patterns-of-distributed-systems/idempotent-receiver.html)

---

### B4. Competing Consumers + Queue-based load levelling

**In one line:** several worker instances share one queue, so work spreads across them. The queue absorbs bursts so workers process at a steady pace.

**Where in TrainMe:** analytics-svc pods form one Kafka consumer group over 12 partitions of `record.events`. KEDA adds pods when the backlog grows (e.g. a 7 pm spike when everyone finishes training).

**Why we adopted it:** session completions are bursty. Kafka buffers the spike, so the API stays fast while analytics catches up within the 60 s freshness target.

**Benefits:** horizontal throughput, smoothing of peaks, and no lost work when a worker dies (its partitions move to another).

**Costs / watch-outs:**
- Ordering is guaranteed only within a partition. We key by `user_id`, so one user's events stay in order.
- Maximum parallelism equals the number of partitions.

**Helps requirements:** NFR-SCAL-01, NFR-SCAL-02, NFR-PERF-03, NFR-COST-02 · **Quality attributes:** Throughput, Scalability, Availability

**Learn:** [Azure – Competing Consumers](https://learn.microsoft.com/en-us/azure/architecture/patterns/competing-consumers) · [Azure – Queue-Based Load Leveling](https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling) · [KEDA – Kafka scaler](https://keda.sh/docs/latest/scalers/apache-kafka/)

---

### B5. Saga (choreography) + Compensating transaction

**In one line:** a business process spanning several services runs as a chain of local transactions coordinated by events. If a step fails, earlier steps are undone by "compensating" actions.

**Where in TrainMe:**
- **Account erasure:** `user.deleted` makes every service delete or crypto-shred its rows and confirm back.
- **Subscription changes:** payment webhook → subscription ACTIVE → Keycloak plan claim → entitlements. A refund or cancellation compensates by downgrading.

**Why we adopted it:** database-per-service means no cross-database transaction. GDPR/DPDP erasure must still reliably reach every service.

**Benefits:** no distributed locks and no 2PC, every step is retriable, and progress is visible.

**Costs / watch-outs:**
- Harder to reason about than one transaction.
- Design compensations carefully: some actions can't be undone (an email that was sent).
- Track saga status (e.g. an erasure request with per-service confirmations).

**Helps requirements:** FR-PRF-04, NFR-PRIV-01, NFR-PRIV-05, FR-SUB-02, FR-SUB-07 · **Quality attributes:** Data consistency, Privacy, Reliability · **DB transactions:** replaces distributed transactions

**Learn:** [microservices.io – Saga](https://microservices.io/patterns/data/saga.html) · [Azure – Compensating Transaction](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction)

---

### B6. Claim Check

**In one line:** when a message would be too big, put a reference in it instead, and let the receiver fetch the payload.

**Where in TrainMe:** `record.session.completed` normally carries the full snapshot (~15 KB for 50 balls). If a snapshot would exceed 512 KB, it carries only IDs, and analytics fetches entries from records-svc (LLD §5).

**Why we adopted it:** it keeps Kafka messages small and fast and avoids broker size limits for unusually long sessions.

**Benefits:** stable broker performance and no failed publishes for big sessions.

**Costs / watch-outs:** the receiver makes an extra call. The referenced data must still exist when it's read.

**Helps requirements:** FR-REC-01, NFR-SCAL-03, NFR-REL-02 · **Quality attributes:** Throughput, Reliability

**Learn:** [Azure – Claim-Check](https://learn.microsoft.com/en-us/azure/architecture/patterns/claim-check)

---

### B7. Event schema versioning (Tolerant Reader + CloudEvents envelope)

**In one line:** all events share a standard envelope, and consumers ignore fields they don't know. Schemas evolve only in backward-compatible ways.

**Where in TrainMe:** CloudEvents 1.0 envelope, schema registry with `BACKWARD` compatibility (LLD §5).

**Why we adopted it:** services deploy independently, so an old consumer will see a new event version and vice versa.

**Benefits:** independent deployments with no "big bang" upgrades.

**Costs / watch-outs:** you may only add optional fields. Breaking changes need a new event type.

**Helps requirements:** NFR-MNT-02, NFR-REL-06 · **Quality attributes:** Maintainability, Extensibility, Deployability

**Learn:** [Martin Fowler – Tolerant Reader](https://martinfowler.com/bliki/TolerantReader.html) · [CloudEvents](https://cloudevents.io/)

---

### B8. Dead-letter queue (DLQ)

**In one line:** messages that keep failing are moved aside to a separate queue, so they don't block the rest, and get an alert.

**Where in TrainMe:** `<topic>.dlq` after 3 retries with backoff (LLD §5).

**Why we adopted it:** one malformed event must not stop all users' charts from updating.

**Benefits:** the pipeline keeps flowing, failures are visible and replayable after a fix.

**Costs / watch-outs:** someone must watch and replay the DLQ. Alert on its size.

**Helps requirements:** NFR-REL-02, NFR-REL-05, NFR-OBS-05 · **Quality attributes:** Reliability, Observability

**Learn:** [AWS – Amazon SQS dead-letter queues (concept)](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)

---

## C. Data patterns

### C1. CQRS (Command Query Responsibility Segregation) – "lite"

**In one line:** use different models for **writing** data and **reading** it, each optimised for its job.

**Where in TrainMe:**
- **Write model:** sessions and entries in `records_db`, optimised for safe, idempotent inserts.
- **Read models:** `metric_rollup` (charts), `session_metric` (history search) and `catalog_search_doc` (catalog search), each shaped for its queries.

**Why we adopted it:** charts and search would otherwise scan millions of raw entries. Reads and writes have very different shapes and volumes.

**Benefits:** fast reads (NFR-PERF-01/09), and reads and writes scale separately.

**Costs / watch-outs:** read models are eventually consistent and must be rebuildable. Kafka replay helps.

**Helps requirements:** FR-ANL-01, FR-ANL-03, FR-REC-16, NFR-PERF-01, NFR-PERF-09, NFR-PERF-11 · **Quality attributes:** Performance, Scalability

**Learn:** [Martin Fowler – CQRS](https://martinfowler.com/bliki/CQRS.html) · [Azure – CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) · [microservices.io – CQRS](https://microservices.io/patterns/data/cqrs.html)

---

### C2. Materialized view / pre-aggregation

**In one line:** compute summaries ahead of time and store them, instead of computing them on every request.

**Where in TrainMe:** DAY/WEEK/MONTH rollups store `sum, count, true_count, num, den`. Ratios are computed as Σnum ÷ Σden, so weekly yorker accuracy (43/54) is exact (LLD §2.4, §6.3).

**Why we adopted it:** a chart over a year then reads about 52 rows instead of about 50,000 entries.

**Benefits:**
- Constant-time charts at any data size.
- Additive numbers make re-aggregation exact.
- Cheaper hardware.

**Costs / watch-outs:**
- More storage.
- Edits and deletes must update the view: we recompute DAY rows, then rebuild WEEK and MONTH from them.

**Helps requirements:** FR-ANL-01, FR-ANL-02, FR-ANL-08, NFR-PERF-01, NFR-PERF-03 · **Quality attributes:** Performance, Throughput, Cost

**Learn:** [Azure – Materialized View](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view) · Book: *Designing Data-Intensive Applications* ch. 3 & 11

---

### C3. Cache-aside

**In one line:** the app checks the cache first. On a miss it reads the database, puts the result in the cache, and returns it.

**Where in TrainMe:** Redis keys for catalog trees, effective schemas (`schema:{id}:v{n}`, immutable), chart series and catalog search, plus CDN caching for public catalog GETs (LLD §7, Search §7).

**Why we adopted it:** most reads are repeated (the same schema on every checkpoint, the same chart on every app open). Caching cuts latency and database load.

**Benefits:** millisecond reads, less database CPU, and resilience: a database blip is invisible for cached data.

**Costs / watch-outs:**
- **Invalidation** is the hard part. Our rules: versioned keys for immutable data, event-driven deletes for charts, and a `catalogVersion` bump for search.
- The cache is never the source of truth.

**Helps requirements:** NFR-SCAL-05, NFR-PERF-01, NFR-PERF-09, NFR-COST-02 · **Quality attributes:** Performance, Throughput, Cost

**Learn:** [Azure – Cache-Aside](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside) · [AWS – Caching best practices](https://aws.amazon.com/caching/best-practices/)

---

### C4. Metadata-driven schema (dynamic forms + JSON Schema validation)

**In one line:** describe *what* to record as data (activities, parameters, conditions, metrics). Generate forms and validation from that description, instead of hard-coding each sport.

**Where in TrainMe:**
- Catalog tables `activity_definition`, `parameter_definition` and `metric_definition`, compiled into a JSON Schema per tracker (LLD §3).
- Entries are stored as JSONB that is validated against that schema.
- Conditional parameters ("`yorker_accurate` only when `yorker_attempted = true`") become JSON Schema `if/then` rules.

**Why we adopted it:** the brief requires "flexible to accommodate different types of activities" (TR-2/TR-8) and user-defined parameters (TR-9). Hard-coding cricket, tennis and gym would mean a code release for every new drill.

**Benefits:**
- New sport = catalog rows, with **no code or database migration**.
- The same validation runs on mobile, web and server.
- Type safety is kept despite flexible storage.

**Costs / watch-outs:**
- Querying inside flexible data is harder, which is why search uses precomputed metrics (C1).
- Keep the type system closed (INT, DECIMAL, BOOL, ENUM, TEXT, DURATION) to avoid chaos.

**Helps requirements:** FR-CAT-02, FR-CAT-03, FR-CAT-09, FR-REC-02, FR-TRK-02..05, NFR-MNT-01 · **Quality attributes:** Extensibility, Maintainability, Data integrity

**Learn:** [JSON Schema – Getting started](https://json-schema.org/learn) · [JSON Schema – Conditionals (if/then/else)](https://json-schema.org/understanding-json-schema/reference/conditionals) · [PostgreSQL – JSON types](https://www.postgresql.org/docs/current/datatype-json.html) · Background: [Entity–attribute–value model](https://en.wikipedia.org/wiki/Entity%E2%80%93attribute%E2%80%93value_model)

---

### C5. Prototype + Copy-on-write (template ⊕ overrides)

**In one line:**
- A user's tracker starts as a **copy** of a shared template (prototype).
- Personal changes are stored as **overrides** on top. The shared template is never modified (copy-on-write).

**Where in TrainMe:** `user_tracker.base_snapshot` plus `tracker_override` (ADD / MODIFY / HIDE) → effective schema (LLD §2.2, §3; diagram `04`).

**Why we adopted it:** users must customise (TR-9) without breaking other users or future template upgrades.

**Benefits:** personalisation, safe template evolution, and a clear diff when a user upgrades to a new template version.

**Costs / watch-outs:** merge rules must be explicit (e.g. MODIFY cannot change a parameter's type).

**Helps requirements:** FR-TRK-01, FR-TRK-02, FR-TRK-03, FR-TRK-04, FR-TRK-08 · **Quality attributes:** Extensibility, Data integrity, Usability

**Learn:** [Refactoring.Guru – Prototype](https://refactoring.guru/design-patterns/prototype) · [Copy-on-write](https://en.wikipedia.org/wiki/Copy-on-write)

---

### C6. Immutable versioning

**In one line:** once published, a version never changes. Edits create version n+1, and records remember which version they used.

**Where in TrainMe:** published templates and activities are immutable, each session pins its `schema_version`, and published catalog versions are cached forever (LLD §2.1, §2.3).

**Why we adopted it:** a bowler's March sessions must still display correctly after the template changes in June.

**Benefits:** history never breaks, caching is trivial (immutable = cache forever), and audits and debugging are reproducible.

**Costs / watch-outs:** more rows over time, and migration tools for "upgrade my tracker".

**Helps requirements:** FR-CAT-04, FR-TRK-06, FR-TRK-08, NFR-REL-03 · **Quality attributes:** Data consistency, Reliability, Performance (caching)

**Learn:** [Pat Helland – Immutability Changes Everything (ACM Queue)](https://queue.acm.org/detail.cfm?id=2884038)

---

### C7. Optimistic concurrency control

**In one line:** don't lock while the user edits. When saving, check that nobody changed the record since you read it; if someone did, reject with a conflict.

**Where in TrainMe:** `row_version` columns plus HTTP `ETag` / `If-Match` → `412 Precondition Failed` (tracker overrides, session edits, edits from two devices) (LLD §4, §6.2).

**Why we adopted it:** conflicts are rare (one user, occasionally two devices). Pessimistic locks would hurt performance and don't work across HTTP requests.

**Benefits:** no lost updates and no long database locks, so it scales well.

**Costs / watch-outs:** the client must handle `412` by refetching and retrying or showing a merge prompt.

**Helps requirements:** FR-TRK-06, FR-REC-05, FR-REC-15 · **Quality attributes:** Data consistency, Performance · **DB transactions:** prevents lost updates without locks

**Learn:** [Martin Fowler – Optimistic Offline Lock](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html) · [MDN – If-Match](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Match) · [PostgreSQL – Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

---

### C8. Idempotency key

**In one line:** the client attaches a unique ID to a create request. If the request is retried, the server recognises the ID and returns the original result instead of creating a duplicate.

**Where in TrainMe:**
- `client_session_id` (start session) and `client_entry_id` (each ball or set) are upserted `ON CONFLICT`.
- The `Idempotency-Key` header is used on POSTs.
- `provider_event_id` is unique for payment webhooks (LLD §2.3, §4.5).

**Why we adopted it:** mobile networks drop responses. The phone can't know whether the server saved the ball, so it must be able to resend safely.

**Benefits:** no duplicate balls, sessions or payments, and offline sync becomes simple.

**Costs / watch-outs:**
- Keys must be generated on the client (UUIDv7).
- The server must remember them: a unique index, plus Redis for 24 h.

**Helps requirements:** FR-API-03, FR-REC-04, FR-REC-11, FR-SUB-04, NFR-REL-07 · **Quality attributes:** Reliability, Data consistency

**Learn:** [Stripe – Designing robust APIs with idempotency](https://stripe.com/blog/idempotency) · [AWS Builders' Library – Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) · [IETF draft – Idempotency-Key header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)

---

### C9. Tombstone (soft delete)

**In one line:** mark a record as deleted (`deleted_at`) instead of physically removing it, so the deletion itself can be synced and replayed.

**Where in TrainMe:** `activity_entry.deleted_at` and `activity_session.deleted_at`. Deletes travel in checkpoint batches (LLD §2.3, §4.5).

**Why we adopted it:** if ball 16 is deleted on the phone while offline, the server must learn "16 is deleted". A missing row can't express that.

**Benefits:** deletes sync idempotently, and there's an undo window and an audit trail.

**Costs / watch-outs:**
- Every query must filter out deleted rows (partial indexes `WHERE deleted_at IS NULL`).
- Real purge jobs are needed for privacy (erasure).

**Helps requirements:** FR-REC-05, FR-REC-11, NFR-PRIV-05 · **Quality attributes:** Reliability, Data consistency

**Learn:** [Tombstone (data store)](https://en.wikipedia.org/wiki/Tombstone_(data_store))

---

### C10. Partitioning + archiving (sharding later)

**In one line:** split a huge table into smaller pieces (by month). Queries touch only the relevant pieces, and old pieces can be moved to cheap storage.

**Where in TrainMe:** `activity_session` and `activity_entry` are range-partitioned monthly with `pg_partman`. Partitions older than 13 months go to S3 Parquet. Future option: shard by `user_id` with Citus (Search §11).

**Why we adopted it:** 10K users produce about 548 M entries a year. Partition pruning keeps indexes small and queries fast, and dropping or archiving a month is instant.

**Benefits:** stable query performance as data grows, cheap retention, and faster vacuum and backups.

**Costs / watch-outs:**
- Queries must include the partition key (date) to benefit.
- Unique constraints must include it.

**Helps requirements:** NFR-SCAL-03, NFR-PERF-11, NFR-PRIV-05, NFR-COST-01 · **Quality attributes:** Performance, Scalability, Cost

**Learn:** [PostgreSQL – Table partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) · [Azure – Sharding](https://learn.microsoft.com/en-us/azure/architecture/patterns/sharding) · Book: *Designing Data-Intensive Applications* ch. 6

---

### C11. Keyset pagination + bounded queries

**In one line:** page through results using "give me items after the last one I saw" (an index-friendly cursor) instead of `OFFSET`. Always cap results and require a date range.

**Where in TrainMe:** `LIMIT ≤ 50`, cursor tokens, a required date range, a 12-month cap on entry search, and user-leading indexes (Search §1, §5).

**Why we adopted it:** `OFFSET 10000` reads and discards 10,000 rows, so it gets slower every page. Unbounded queries are the top cause of timeouts.

**Benefits:** constant-time paging, and predictable latency under the 5 s / 2 s ceilings.

**Costs / watch-outs:** no "jump to page 37". Return `hasMore` instead of exact totals.

**Helps requirements:** FR-API-02, FR-REC-16, NFR-PERF-09, NFR-PERF-10, NFR-PERF-11 · **Quality attributes:** Performance

**Learn:** [Use The Index, Luke – No OFFSET](https://use-the-index-luke.com/no-offset) · [Use The Index, Luke (free book)](https://use-the-index-luke.com/)

---

### C12. Read replica

**In one line:** a continuously updated copy of the database that serves read-only queries, so the primary is free for writes.

**Where in TrainMe:** optional RDS or CloudNativePG replica that serves `/search` traffic once it exceeds ~20 req/s (Search §8, §11).

**Why we adopted it:** it is a simple scaling step before anything more complex.

**Benefits:** more read throughput, protection of write latency, and a warm standby.

**Costs / watch-outs:** replication lag means a just-written session may appear a second later. Fine for search.

**Helps requirements:** NFR-PERF-09, NFR-SCAL-01, NFR-REL-02 · **Quality attributes:** Throughput, Availability

**Learn:** [AWS – Working with RDS read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html) · [CloudNativePG docs](https://cloudnative-pg.io/documentation/current/)

---

## D. Reliability & resilience patterns

### D1. Local-first / offline-first with checkpoint sync

**In one line:** the app saves everything on the device first, so it works with no network. It syncs to the server in background batches and confirms completeness at the end.

**Where in TrainMe:** SQLite / IndexedDB entries, checkpoint `entries:batch` every 3–5 min plus on background or network regain, `/complete` with an entry-count check, and auto-close (LLD §4.5, §6.2; HLD ADR-009; diagram `06`).

**Why we adopted it:** grounds and gyms have poor signal. A 40-minute, 50-ball session must never be lost, and tapping a ball must feel instant.

**Benefits:**
- Instant UI (≤ 100 ms per tap).
- No data loss.
- About 5× fewer requests than one call per ball.
- The session can be resumed on another device.

**Costs / watch-outs:** sync logic, conflict handling and battery-friendly background work need careful testing (TS-05a–f).

**Helps requirements:** FR-REC-04, FR-REC-09, FR-REC-10, FR-REC-11, FR-REC-12, FR-REC-13, FR-REC-15, NFR-REL-07, NFR-PERF-07, NFR-PERF-08, NFR-USE-02 · **Quality attributes:** Reliability, Usability, Throughput, Performance

**Learn:** [Ink & Switch – Local-first software](https://www.inkandswitch.com/local-first/) · [Android – Build an offline-first app](https://developer.android.com/topic/architecture/data-layer/offline-first)

---

### D2. Timeouts + deadline propagation

**In one line:** every call has a maximum wait time. Inner layers time out before outer ones, so nothing hangs.

**Where in TrainMe:** client 6 s / 3 s → Kong 5 s / 2 s → service 4.5 s / 1.8 s → PostgreSQL `statement_timeout` 4 s / 1.5 s → `504 search-timeout` (Search §6).

**Why we adopted it:** it directly enforces your requirement of < 5 s in production and < 2 s on test. It also stops slow calls from piling up and exhausting threads and connections.

**Benefits:** guaranteed response ceilings and protection from cascading failure.

**Costs / watch-outs:** a timeout that's too short causes false failures. Tune it with real p99 data.

**Helps requirements:** NFR-PERF-09, NFR-PERF-10, NFR-REL-05, NFR-PERF-06 · **Quality attributes:** Availability, Performance

**Learn:** [AWS Builders' Library – Timeouts, retries and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) · Book: *Release It!* (Nygard), "Stability Patterns"

---

### D3. Retry with exponential backoff + jitter

**In one line:** retry failed calls, waiting longer each time and adding randomness, so thousands of clients don't retry at the same instant.

**Where in TrainMe:**
- The mobile and web sync worker (max 5 min backoff).
- The checkpoint timer with ±30 s jitter.
- Kafka consumers retry 3 times before the DLQ.
- Service-to-service calls.

**Why we adopted it:** most failures are brief (Wi-Fi switch, pod restart). Synchronised retries would hammer a recovering server, the "thundering herd".

**Benefits:** automatic recovery from transient faults, and kind to the server.

**Costs / watch-outs:** **only retry idempotent operations** (C8). Cap the attempts.

**Helps requirements:** NFR-REL-02, NFR-REL-07, FR-REC-10 · **Quality attributes:** Reliability, Availability

**Learn:** [Azure – Retry](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry) · [AWS Architecture Blog – Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)

---

### D4. Circuit breaker

**In one line:** after repeated failures, stop calling a broken dependency for a while ("open the circuit") and fail fast. Then test again carefully.

**Where in TrainMe:** service-to-service HTTP calls (e.g. records-svc fetching a schema on a cache miss) and calls to external providers (FCM, SES, payment APIs), using `opossum` (LLD §1, HLD §7).

**Why we adopted it:** a slow dependency would otherwise tie up all request threads and take healthy services down with it.

**Benefits:** fast failures, room for the dependency to recover, and graceful degradation (e.g. queue the push for later).

**Costs / watch-outs:** you need a fallback behaviour for when the circuit is open, and thresholds need tuning.

**Helps requirements:** NFR-REL-05, NFR-REL-02, NFR-REL-01 · **Quality attributes:** Availability, Performance

**Learn:** [Martin Fowler – Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html) · [Azure – Circuit Breaker](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)

---

### D5. Bulkhead

**In one line:** separate resources (connection pools, worker pools, pods) per workload, so one overloaded area can't sink the whole ship.

**Where in TrainMe:**
- Separate services and pods.
- Separate DB pools for API traffic vs Kafka consumers.
- A dedicated search database role with its own timeout.
- An optional read replica for search.

**Why we adopted it:** a burst of heavy history searches must not slow down live session recording.

**Benefits:** failure and overload stay contained.

**Costs / watch-outs:** resources are split, so they need sizing.

**Helps requirements:** NFR-REL-05, NFR-PERF-02, NFR-PERF-07 · **Quality attributes:** Availability

**Learn:** [Azure – Bulkhead](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead)

---

### D6. Rate limiting / throttling

**In one line:** cap how many requests a user, IP or route can make per second, and reject the excess with `429`.

**Where in TrainMe:**
- Kong: 20 req/s per user, and 2 req/s on `entries:batch`.
- WAF rate rules.
- Keycloak brute-force protection on login.

**Why we adopted it:** it protects against abuse, buggy clients in a retry loop, and credential stuffing, and keeps costs predictable.

**Benefits:** fairness, security and cost control.

**Costs / watch-outs:** limits must allow normal bursts. Return `Retry-After`.

**Helps requirements:** NFR-SEC-06, FR-IAM-07, NFR-SEC-01, NFR-COST-01 · **Quality attributes:** Security, Availability, Cost

**Learn:** [Azure – Rate Limiting](https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern) · [Azure – Throttling](https://learn.microsoft.com/en-us/azure/architecture/patterns/throttling) · [OWASP API4 – Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)

---

### D7. Health endpoint monitoring (liveness / readiness / startup probes)

**In one line:** each service exposes endpoints saying "I'm alive" and "I'm ready for traffic". The platform restarts or stops routing to unhealthy pods.

**Where in TrainMe:** `/health/live`, `/health/ready` (checks the DB, Kafka and Redis) and `/health/startup` (LLD §10).

**Why we adopted it:** Kubernetes needs these to do zero-downtime rollouts and self-healing.

**Benefits:** automatic recovery and safe deployments.

**Costs / watch-outs:**
- Readiness checks must be cheap.
- Liveness must **not** depend on external systems, or one database blip restarts everything.

**Helps requirements:** NFR-REL-01, NFR-REL-02, NFR-REL-06 · **Quality attributes:** Availability, Deployability

**Learn:** [microservices.io – Health Check API](https://microservices.io/patterns/observability/health-check-api.html) · [Kubernetes – Liveness, readiness and startup probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)

---

### D8. Graceful shutdown

**In one line:** on stop, finish in-flight work, commit progress and close connections cleanly before exiting.

**Where in TrainMe:** SIGTERM → stop accepting traffic → drain for ≤ 25 s → commit Kafka offsets → exit (LLD §10).

**Why we adopted it:** rolling updates and Spot node reclaims happen daily. Without this, checkpoints would fail mid-request and events would be reprocessed.

**Benefits:** true zero-downtime deployments and fewer duplicates.

**Costs / watch-outs:** the drain must fit inside `terminationGracePeriodSeconds`.

**Helps requirements:** NFR-REL-06, NFR-COST-02 (safe Spot use) · **Quality attributes:** Reliability, Deployability

**Learn:** [Kubernetes – Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)

---

### D9. Scheduled job + leader election

**In one line:** run periodic background work exactly once across many replicas. Use a Kubernetes CronJob, or let one elected instance do it.

**Where in TrainMe:**
- Auto-close of forgotten sessions (CronJob every 10 min, `concurrencyPolicy: Forbid`).
- The reminder scheduler.
- Nightly catalog popularity updates.

**Why we adopted it:** with 3–20 records-svc pods, each running the job would close sessions many times and race.

**Benefits:** exactly-one execution and simple operations.

**Costs / watch-outs:** jobs must still be idempotent in case they run twice.

**Helps requirements:** FR-REC-13, FR-NTF-01 · **Quality attributes:** Reliability

**Learn:** [Azure – Leader Election](https://learn.microsoft.com/en-us/azure/architecture/patterns/leader-election) · [Kubernetes – CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)

---

## E. Security patterns

### E1. Access token (OIDC Authorization Code + PKCE)

**In one line:**
- Users log in at the identity provider and the app receives a short-lived signed token (JWT).
- Every API call carries this token, and services verify it without calling the identity provider.
- PKCE stops an intercepted login code from being used by an attacker.

**Where in TrainMe:** Keycloak issues 10–15 min access tokens with rotating refresh tokens. Claims include `sub`, `roles` and `plan` (HLD §8; sequence `05`).

**Why we adopted it:** mobile apps can't keep secrets. PKCE is the standard for public clients, and stateless tokens scale without a session store.

**Benefits:** standard and audited security, social login and MFA for free, and stateless scaling.

**Costs / watch-outs:**
- Token revocation is delayed until expiry, so keep tokens short and rotate refresh tokens.
- Store tokens in Keychain / Keystore.

**Helps requirements:** FR-IAM-01, FR-IAM-03, FR-IAM-05, FR-IAM-06, FR-IAM-08, FR-SUB-05, NFR-SEC-05, NFR-SEC-10 · **Quality attributes:** Security, Scalability

**Learn:** [microservices.io – Access token](https://microservices.io/patterns/security/access-token.html) · [oauth.net – PKCE](https://oauth.net/2/pkce/) · [RFC 8252 – OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252) · [Keycloak docs](https://www.keycloak.org/documentation)

---

### E2. Federated identity

**In one line:** delegate authentication to a trusted identity provider (and through it to Google or Apple) instead of building login yourself.

**Where in TrainMe:** Keycloak brokers Google and Apple sign-in and provides MFA and passkeys.

**Why we adopted it:** building secure password storage, MFA and account recovery yourself is risky for a first project.

**Benefits:** less security code to own, a better sign-up experience, and stronger auth.

**Costs / watch-outs:** a dependency on the identity provider, so run Keycloak with ≥ 2 replicas.

**Helps requirements:** FR-IAM-02, FR-IAM-04, NFR-USE-05 · **Quality attributes:** Security, Usability

**Learn:** [Azure – Federated Identity](https://learn.microsoft.com/en-us/azure/architecture/patterns/federated-identity)

---

### E3. Defence in depth / zero trust

**In one line:** never rely on one security layer. Verify at every hop and give each part only the access it needs.

**Where in TrainMe:**
- WAF → Kong JWT check → service JWT check plus ownership check (`user_id = sub`).
- PostgreSQL row-level security as an extra guard.
- Kubernetes NetworkPolicies (default deny), least-privilege IAM per service.
- TLS everywhere and KMS encryption.

**Why we adopted it:** fitness data is sensitive (NFR-PRIV-02). A single bug (e.g. a missing check in one endpoint) must not expose other users' data.

**Benefits:** a much smaller blast radius for any vulnerability, and ASVS L2 alignment.

**Costs / watch-outs:** more configuration, and performance overhead is negligible if done right.

**Helps requirements:** NFR-SEC-01, NFR-SEC-02, NFR-SEC-03, NFR-SEC-05, NFR-PRIV-02, FR-IAM-06 · **Quality attributes:** Security, Privacy

**Learn:** [NIST SP 800-207 – Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final) · [OWASP API Security Top 10](https://owasp.org/API-Security/) · [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) · [PostgreSQL – Row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

---

### E4. Externalized configuration & secrets

**In one line:** keep config and secrets out of code and images. Inject them per environment at runtime.

**Where in TrainMe:** ConfigMaps for config. Secrets come from Sealed Secrets on k3s and from AWS Secrets Manager via External Secrets Operator on EKS (Deployment §1).

**Why we adopted it:** the same image must run on k3s and AWS (NFR-PORT-01), and secrets in Git are a top cause of breaches.

**Benefits:** portability, secret rotation without rebuilding, and safer repositories.

**Costs / watch-outs:** secret tooling must be learned. Never log secrets.

**Helps requirements:** NFR-SEC-04, NFR-MNT-06, NFR-PORT-01 · **Quality attributes:** Security, Portability

**Learn:** [microservices.io – Externalized configuration](https://microservices.io/patterns/externalized-configuration.html) · [Azure – External Configuration Store](https://learn.microsoft.com/en-us/azure/architecture/patterns/external-configuration-store) · [External Secrets Operator](https://external-secrets.io/) · [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)

---

### E5. Supply-chain security (signed images + policy as code)

**In one line:** prove that what runs in the cluster is exactly what CI built and scanned, and let the cluster reject anything else.

**Where in TrainMe:**
- CI: SAST (CodeQL / Semgrep), dependency and image scanning (Trivy), SBOM (Syft) and cosign signatures.
- Cluster: Kyverno admits only signed, non-root images with resource limits (Deployment §4).

**Why we adopted it:** compromised dependencies and images are a major attack vector.

**Benefits:** tamper resistance, vulnerability visibility and compliance evidence.

**Costs / watch-outs:** CI takes a bit longer, and vulnerabilities must be triaged.

**Helps requirements:** NFR-SEC-07, NFR-SEC-09 · **Quality attributes:** Security

**Learn:** [SLSA framework](https://slsa.dev/) · [Sigstore / cosign docs](https://docs.sigstore.dev/) · [Kyverno docs](https://kyverno.io/docs/)

---

### E6. Audit log

**In one line:** keep an append-only record of who did what and when for sensitive actions.

**Where in TrainMe:** admin and curator actions (catalog publish, plan changes, support lookups) and authentication events. Retained for 1 year, tamper-evident (SRS FR-ADM-03).

**Why we adopted it:** it gives accountability, incident investigation and privacy compliance.

**Benefits:** traceability and trust.

**Costs / watch-outs:** storage. Don't put sensitive payloads in audit lines.

**Helps requirements:** FR-ADM-02, FR-ADM-03, NFR-SEC-08, NFR-PRIV-01 · **Quality attributes:** Security, Privacy

**Learn:** [microservices.io – Audit logging](https://microservices.io/patterns/observability/audit-logging.html) · [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

---

## F. Observability patterns (brief TR-7)

### F1. Distributed tracing + correlation ID

**In one line:** give each request a trace ID that travels through every service and message, so you can see the whole path and timing of one user action.

**Where in TrainMe:** OpenTelemetry SDKs, W3C `traceparent` through Kong, HTTP and Kafka headers, and Tempo for storage. `traceId` is returned in error responses (HLD §11; diagram `12`).

**Why we adopted it:** "my chart didn't update" crosses the app, Kong, records, Kafka, analytics and Redis. Without traces, finding the slow or failed hop is guesswork.

**Benefits:** fast root-cause analysis, latency breakdown, and the ability to link a support ticket to an exact trace.

**Costs / watch-outs:** trace volume costs money, so use tail sampling (keep errors and slow traces).

**Helps requirements:** NFR-OBS-03, NFR-OBS-01, TR-7 · **Quality attributes:** Observability

**Learn:** [microservices.io – Distributed tracing](https://microservices.io/patterns/observability/distributed-tracing.html) · [OpenTelemetry – Concepts](https://opentelemetry.io/docs/concepts/) · [W3C Trace Context](https://www.w3.org/TR/trace-context/)

---

### F2. Structured log aggregation

**In one line:** every service writes JSON logs with standard fields to stdout. A collector ships them to one searchable store.

**Where in TrainMe:** pino JSON → OTel Collector → Loki. Fields include `trace_id`, `request_id` and a pseudonymised `user_id`. The log level can be changed at runtime and auto-reverts. PII is redacted in the collector.

**Why we adopted it:** pods come and go, so logs must outlive them and be queryable across services.

**Benefits:** one place to search, correlation with traces, and debug logging without a redeploy.

**Costs / watch-outs:** volume and cost, which need retention limits. **Never** log tokens or health data.

**Helps requirements:** NFR-OBS-01, NFR-OBS-02, NFR-OBS-07, NFR-PRIV-03 · **Quality attributes:** Observability, Privacy

**Learn:** [microservices.io – Log aggregation](https://microservices.io/patterns/observability/application-logging.html) · [Grafana Loki docs](https://grafana.com/docs/loki/latest/) · [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

---

### F3. Metrics, SLOs & burn-rate alerting

**In one line:**
- Measure rate, errors and duration (RED) per endpoint.
- Define service-level objectives (SLOs).
- Alert when you are burning the error budget too fast, not on every blip.

**Where in TrainMe:**
- Prometheus and Grafana dashboards, with SLOs from the SRS (e.g. 99.5 % availability, p95 latency).
- Alerts: p99 search > 1.5 s for 10 min; any `search-timeout`.

**Why we adopted it:** it tells you **before users do** that something is degrading, and makes the NFR targets measurable.

**Benefits:** objective release gates (canary analysis), fewer noisy alerts, and capacity planning.

**Costs / watch-outs:** choosing good SLOs takes iteration.

**Helps requirements:** NFR-OBS-04, NFR-OBS-05, NFR-REL-01, NFR-PERF-01..11 (measurement) · **Quality attributes:** Observability, Availability

**Learn:** [Google SRE Book – Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) · [Google SRE Workbook – Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) · [Prometheus – Overview](https://prometheus.io/docs/introduction/overview/)

---

### F4. Exception tracking

**In one line:** capture crashes and exceptions from apps and services with stack traces and release versions in one tool.

**Where in TrainMe:** Sentry (React Native, Next.js, NestJS) and optionally Firebase Crashlytics.

**Why we adopted it:** mobile crashes never reach your server logs.

**Benefits:** crash-free-session metrics per release, faster fixes, and better beta quality.

**Costs / watch-outs:** scrub PII before sending, and upload source maps.

**Helps requirements:** NFR-OBS-06, NFR-USE-05 · **Quality attributes:** Observability, Usability

**Learn:** [microservices.io – Exception tracking](https://microservices.io/patterns/observability/exception-tracking.html) · [Sentry docs](https://docs.sentry.io/)

---

### F5. Node agent (DaemonSet collector)

**In one line:** run one telemetry agent per node to collect logs, metrics and traces from all pods, instead of adding a sidecar to every pod.

**Where in TrainMe:** an OTel Collector DaemonSet (agent) plus a gateway Deployment for sampling and redaction (diagram `12`).

**Why we adopted it:** it uses fewer resources than a sidecar per pod and gives one place to configure collection.

**Benefits:** cost efficiency and central policy (PII redaction).

**Costs / watch-outs:** a misconfigured agent affects the whole node.

**Helps requirements:** NFR-OBS-01, NFR-OBS-03, NFR-PRIV-03, NFR-COST-02 · **Quality attributes:** Observability, Cost

**Learn:** [OpenTelemetry – Collector deployment patterns](https://opentelemetry.io/docs/collector/deployment/) · [Kubernetes – DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/)

---

## G. Delivery, deployment & operations patterns

### G1. 12-Factor App

**In one line:** twelve rules for cloud-ready services: config in the environment, stateless processes, logs as streams, disposability, dev/prod parity, and more.

**Where in TrainMe:** all services: env config validated with zod, stateless pods, stdout logs, fast start and stop (LLD §9–10).

**Why we adopted it:** it is the foundation that makes k3s ↔ AWS portability and autoscaling work.

**Benefits:** portability, easy scaling and predictable deployments.

**Costs / watch-outs:** state must live in backing services (PostgreSQL, Redis, S3).

**Helps requirements:** NFR-MNT-06, NFR-PORT-01, NFR-SCAL-02 · **Quality attributes:** Portability, Deployability, Scalability

**Learn:** [The Twelve-Factor App](https://12factor.net/)

---

### G2. GitOps

**In one line:** the desired state of every environment lives in Git. An agent (Argo CD) continuously makes the cluster match Git.

**Where in TrainMe:** `gitops` repo with `envs/test` (k3s) and `envs/beta` (EKS). Promotion is a pull request (Deployment §4; diagram `11`).

**Why we adopted it:** every change is reviewed, auditable and revertible. Environments can't silently drift apart.

**Benefits:** a reproducible k3s test environment that matches AWS, easy rollback (`git revert`), and no `kubectl` access needed for deployments, which is also more secure.

**Costs / watch-outs:** a learning curve, and secrets need special handling (E4).

**Helps requirements:** NFR-PORT-01, NFR-REL-06, NFR-SEC-08 · **Quality attributes:** Deployability, Reliability, Security

**Learn:** [OpenGitOps principles](https://opengitops.dev/) · [Argo CD docs](https://argo-cd.readthedocs.io/en/stable/)

---

### G3. Build once, deploy many (immutable artefacts)

**In one line:** build a container image once, sign it, and promote the **same digest** through every environment. Never rebuild for production.

**Where in TrainMe:** a git-SHA tag and digest are copied from GHCR to ECR and promoted from k3s test to AWS beta.

**Why we adopted it:** what you tested is exactly what you ship, with no "works in test, broken in prod" from a different build.

**Benefits:** confidence, traceability and supply-chain integrity.

**Costs / watch-outs:** environment differences must be config only (E4).

**Helps requirements:** NFR-PORT-01, NFR-SEC-07, NFR-MNT-06 · **Quality attributes:** Deployability, Security

**Learn:** [Martin Fowler – Immutable Server](https://martinfowler.com/bliki/ImmutableServer.html) · [Continuous Delivery – principles](https://continuousdelivery.com/principles/)

---

### G4. Canary release

**In one line:** send a small share of real traffic (10 %) to the new version, compare its metrics with the old one, then expand or automatically roll back.

**Where in TrainMe:** Argo Rollouts on EKS, 10 % → 50 % → 100 % with Prometheus analysis of error rate and p95 (Deployment §4).

**Why we adopted it:** a bad release affects 10 % of users for minutes instead of everyone.

**Benefits:** safer releases, automatic rollback, and production validation.

**Costs / watch-outs:** both versions run at once, so APIs, events and the database must be backward compatible (B7, G6).

**Helps requirements:** NFR-REL-06, NFR-PERF-06, NFR-REL-01 · **Quality attributes:** Availability, Deployability

**Learn:** [Martin Fowler – Canary Release](https://martinfowler.com/bliki/CanaryRelease.html) · [Argo Rollouts docs](https://argoproj.github.io/argo-rollouts/)

---

### G5. Feature toggles

**In one line:** turn features on or off at runtime (for everyone, a percentage, or specific users) without deploying.

**Where in TrainMe:** OpenFeature SDK + Unleash or Flagsmith, e.g. `csv-import`, `derived-params`, `new-chart-ui` (LLD §9).

**Why we adopted it:** ship code dark, test with beta users, and switch off instantly if something misbehaves.

**Benefits:** decouples deployment from release, enables A/B tests, and gives a kill switch.

**Costs / watch-outs:** old flags become technical debt, so remove them after rollout.

**Helps requirements:** NFR-MNT-05, FR-ADM-01, NFR-REL-06 · **Quality attributes:** Deployability, Extensibility

**Learn:** [Martin Fowler – Feature Toggles](https://martinfowler.com/articles/feature-toggles.html) · [OpenFeature](https://openfeature.dev/)

---

### G6. Expand / contract (parallel change) database migrations

**In one line:** change schemas in safe steps:
1. **Expand:** add a new column or table, compatible with old code.
2. **Migrate:** move data and switch code to the new structure.
3. **Contract:** remove the old structure in a later release.

**Where in TrainMe:** migrations run as Argo CD PreSync Jobs and never drop what the running version still uses (LLD §10). It is needed, for example, when moving from v1.1 `entry_value` to v1.2 JSONB.

**Why we adopted it:** canary and rolling deployments run old and new code at the same time.

**Benefits:** zero-downtime schema changes and safe rollback of application code.

**Costs / watch-outs:** a migration takes 2–3 releases. Plan it.

**Helps requirements:** NFR-REL-06, NFR-REL-03 · **Quality attributes:** Availability, Data consistency, Deployability · **DB transactions:** each step is a safe, small transaction

**Learn:** [Martin Fowler – Parallel Change](https://martinfowler.com/bliki/ParallelChange.html) · [Martin Fowler – Evolutionary Database Design](https://martinfowler.com/articles/evodb.html)

---

### G7. Infrastructure as Code (IaC)

**In one line:** define servers, networks and databases in versioned code, and apply it automatically.

**Where in TrainMe:** Terraform for AWS (VPC, EKS, RDS, MSK, IAM) and Ansible for the RHEL / Ubuntu test VM (Deployment §3.5).

**Why we adopted it:** it gives repeatable environments, reviews for infrastructure changes, and disaster recovery by re-applying.

**Benefits:** reproducibility, audit trail, cost visibility, and rebuild in under an hour.

**Costs / watch-outs:** state management (S3 + lock). Don't click-edit in the console.

**Helps requirements:** NFR-PORT-01, NFR-REL-03, NFR-REL-04, NFR-COST-01 · **Quality attributes:** Reliability, Portability, Cost

**Learn:** [HashiCorp – Terraform tutorials](https://developer.hashicorp.com/terraform/tutorials) · [Martin Fowler – Infrastructure As Code](https://martinfowler.com/bliki/InfrastructureAsCode.html)

---

### G8. Seed data as code

**In one line:** reference data (the activity catalog) is generated, validated and reviewed in Git like code, then applied idempotently on each deployment.

**Where in TrainMe:** `catalog/tools/build_phase1_catalog.py` → `catalog/phase1/catalog.json` → catalog-seed PostSync Job (LLD §11; HLD ADR-013).

**Why we adopted it:** k3s and AWS must have the identical catalog. Content errors are caught by the validator in CI, not by users.

**Benefits:** reproducible environments, reviewed content, versioned templates, and no manual data entry.

**Costs / watch-outs:** must never overwrite curator edits. We use the `source` field and versioning for that.

**Helps requirements:** FR-CAT-13, FR-CAT-14, NFR-MNT-01, NFR-PORT-01 · **Quality attributes:** Maintainability, Portability, Data integrity

**Learn:** [Martin Fowler – Evolutionary Database Design (reference data section)](https://martinfowler.com/articles/evodb.html)

---

### G9. Horizontal autoscaling (HPA / KEDA / Karpenter)

**In one line:** add or remove pods automatically based on load (CPU, requests/s, queue lag), and add or remove nodes to fit the pods.

**Where in TrainMe:**
- HPA for API services.
- KEDA on Kafka lag for analytics and notification.
- Karpenter on EKS, with Spot for stateless pods (Deployment §3.6).

**Why we adopted it:** traffic peaks in mornings and evenings. Paying for peak capacity all day wastes money.

**Benefits:** handles growth to "thousands of concurrent users" (TR-6) automatically and cuts cost at night.

**Costs / watch-outs:** services must be stateless and start fast (G1, D8). Set sensible minimums.

**Helps requirements:** NFR-SCAL-01, NFR-SCAL-02, NFR-COST-02, NFR-REL-02 · **Quality attributes:** Scalability, Cost, Availability

**Learn:** [Kubernetes – Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) · [KEDA](https://keda.sh/) · [Karpenter](https://karpenter.sh/)

---

## H. Code-level patterns (GoF & enterprise)

### H1. Repository

**In one line:** a class that looks like an in-memory collection of domain objects and hides SQL behind methods such as `findActiveByUser()`.

**Where in TrainMe:** `infrastructure/` repositories in every service. All queries include `user_id = :sub` (ownership by construction).

**Why we adopted it:** domain code stays independent of SQL, and repositories can be faked in unit tests.

**Benefits:** testability, a single place for query tuning, and security (ownership filters in one place).

**Costs / watch-outs:** don't hide performance-critical SQL behind leaky generic methods.

**Helps requirements:** NFR-MNT-04, FR-IAM-06 · **Quality attributes:** Testability, Maintainability, Security

**Learn:** [Martin Fowler – Repository (P of EAA)](https://martinfowler.com/eaaCatalog/repository.html)

---

### H2. Adapter

**In one line:** wrap an external API in your own interface so the rest of the code doesn't depend on it.

**Where in TrainMe:**
- Payment providers (Stripe, Razorpay, App Store, Play) behind one `PaymentGateway` interface.
- Push (FCM, APNs), email (SES / SMTP / Mailpit) and object storage (S3 / MinIO).

**Why we adopted it:** test and beta use different providers, and India vs global markets may need different payment providers.

**Benefits:** swap providers via configuration, and fake adapters in tests.

**Costs / watch-outs:** keep the interface minimal and business-oriented.

**Helps requirements:** NFR-PORT-02, FR-SUB-03, FR-NTF-02, FR-NTF-03 · **Quality attributes:** Portability, Testability

**Learn:** [Refactoring.Guru – Adapter](https://refactoring.guru/design-patterns/adapter)

---

### H3. Strategy

**In one line:** pick one of several interchangeable algorithms at runtime through a common interface.

**Where in TrainMe:** aggregation functions (`COUNT`, `COUNT_TRUE`, `SUM`, `MAX`, `MIN`) and display formats (PERCENT, PACE, DURATION) in the metric evaluator, and sync triggers (timer, background, network regain).

**Why we adopted it:** new aggregation functions or formats can be added without touching the evaluator core.

**Benefits:** open for extension, closed for modification, and each strategy is unit-testable.

**Costs / watch-outs:** don't over-abstract simple `if` statements.

**Helps requirements:** FR-ANL-02, FR-CAT-10, FR-ANL-08 · **Quality attributes:** Extensibility, Testability

**Learn:** [Refactoring.Guru – Strategy](https://refactoring.guru/design-patterns/strategy)

---

### H4. Interpreter

**In one line:** define a small language and evaluate expressions written in it.

**Where in TrainMe:** the metric grammar, e.g. `{"fn":"SUM","expr":"reps * weight_kg"}` and `MAX(weight_kg * (1 + reps / 30))`. It is parsed by a whitelist parser and **never** passed to `eval()` (LLD §2.1).

**Why we adopted it:** curators and users can define new metrics as data (FR-CAT-10, TR-9) safely.

**Benefits:** unlimited metrics without code releases, and identical results on device and server (shared library).

**Costs / watch-outs:** keep the language tiny. A safe parser is a **security** requirement (no code injection).

**Helps requirements:** FR-CAT-08, FR-CAT-10, FR-TRK-02, NFR-MNT-01 · **Quality attributes:** Extensibility, Security

**Learn:** [Interpreter pattern](https://en.wikipedia.org/wiki/Interpreter_pattern) · Book: *Design Patterns* (Gamma et al.), "Interpreter"

---

### H5. Specification

**In one line:** represent a business rule or filter ("second serves that were out") as an object that can be combined, tested and translated (e.g. to SQL or in-memory checks).

**Where in TrainMe:** metric `where` filters and entry-search filters. They are built only from known schema keys and typed operators, then translated to parameterised SQL (Search §5).

**Why we adopted it:** one definition of a filter is reused by live stats (device), rollups (analytics) and search (records). Building filters only from schema keys prevents SQL injection.

**Benefits:** consistent results everywhere, and secure query building.

**Costs / watch-outs:** limit the operator set.

**Helps requirements:** FR-CAT-10, FR-REC-16, NFR-SEC-01 · **Quality attributes:** Extensibility, Security, Maintainability

**Learn:** [Specification pattern](https://en.wikipedia.org/wiki/Specification_pattern) · [Evans & Fowler – Specifications (PDF)](https://martinfowler.com/apsupp/spec.pdf)

---

### H6. Builder

**In one line:** construct a complex object step by step, validating it at the end.

**Where in TrainMe:** the catalog builder (`P()`, `T()`, `M()`, `A()`, `TP()` helpers) assembles 147 activities and validates conditions, metric references and types before writing `catalog.json`.

**Why we adopted it:** hand-writing 900 parameters in JSON would be error-prone. The builder makes invalid catalogs impossible to ship.

**Benefits:** correctness, readability and reuse (`attempt_pair()` creates attempted → accurate pairs).

**Costs / watch-outs:** the builder becomes the source of truth, so don't hand-edit its output.

**Helps requirements:** FR-CAT-13, NFR-MNT-01 · **Quality attributes:** Maintainability, Data integrity

**Learn:** [Refactoring.Guru – Builder](https://refactoring.guru/design-patterns/builder)

---

### H7. Factory

**In one line:** put object-creation logic in one place that decides *which* concrete object to create.

**Where in TrainMe:** the schema compiler creates the right validator and UI widget per parameter type (BOOL → toggle, INT → stepper, ENUM → chips) and conditional rules (FR-REC-02, FR-REC-03).

**Why we adopted it:** adding a new parameter type means one new branch in one place.

**Benefits:** a single point of change, and consistent forms across mobile and web.

**Costs / watch-outs:** keep factories simple.

**Helps requirements:** FR-REC-02, FR-REC-03, FR-CAT-09 · **Quality attributes:** Maintainability, Extensibility

**Learn:** [Refactoring.Guru – Factory Method](https://refactoring.guru/design-patterns/factory-method)

---

### H8. Observer

**In one line:** objects subscribe to notifications from another object and react when something changes. Pub/Sub (B1) is the distributed version.

**Where in TrainMe:** inside apps (live stats update after each ball, UI state stores) and inside services (domain events → outbox writer).

**Why we adopted it:** it decouples "something happened" from "who cares".

**Benefits:** extensibility and clean UI updates.

**Costs / watch-outs:** too many observers make flows hard to follow, so trace them.

**Helps requirements:** FR-REC-14, NFR-MNT-02 · **Quality attributes:** Extensibility

**Learn:** [Refactoring.Guru – Observer](https://refactoring.guru/design-patterns/observer)

---

## I. Testing patterns

### I1. Test pyramid + consumer-driven contracts

**In one line:**
- Many fast unit tests, fewer integration tests and a few end-to-end tests.
- Services verify each other's API and event expectations with contract tests, instead of slow full-system tests.

**Where in TrainMe:**
- Jest (unit), Testcontainers (PostgreSQL, Redpanda, Redis), Pact (HTTP and message contracts).
- Playwright / Maestro (E2E), k6 (load) and query-plan tests (`06_Test_Strategy`).

**Why we adopted it:** with 7 services, end-to-end tests alone would be slow and flaky. Contracts catch breaking changes at PR time.

**Benefits:** fast feedback, safe independent deployments and reliable CI.

**Costs / watch-outs:** contract tests need a broker and discipline.

**Helps requirements:** NFR-MNT-03, NFR-MNT-04, NFR-REL-06 · **Quality attributes:** Testability, Deployability

**Learn:** [Martin Fowler – The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) · [Martin Fowler – Consumer-Driven Contracts](https://martinfowler.com/articles/consumerDrivenContracts.html) · [Pact docs](https://docs.pact.io/) · [Testcontainers](https://testcontainers.com/)

---

## Patterns we deliberately did **not** use (and why)

| Pattern | Why not (for now) | When to reconsider |
|---|---|---|
| **Event sourcing** (store events as the source of truth) | Adds complexity: event store, projections and snapshots. Tables + outbox give us what we need. | If a full audit history of every state change becomes a product feature. [Learn](https://microservices.io/patterns/data/event-sourcing.html) |
| **Distributed transactions (2PC / XA)** | Kafka, cloud services and HTTP don't support them well. They hurt availability. | Never. Use saga + outbox |
| **Shared database across services** | Couples all services, and one slow query hurts everyone. | Never for new code |
| **Service mesh (Istio / Linkerd)** | Extra operational load for a small team. NetworkPolicies + TLS are enough for beta. | GA, if mTLS between pods or advanced traffic shaping is needed. [Learn](https://microservices.io/patterns/deployment/service-mesh.html) |
| **Backend-for-frontend / GraphQL** | One REST API serves mobile, web and admin well today. | When the mobile and web needs diverge strongly |
| **Separate search engine (OpenSearch)** | PostgreSQL meets the < 5 s / < 2 s targets with big headroom (ADR-012). | Cross-user discovery, or > 1 M catalog documents |

---

## How the patterns work together: one bowler's session

1. **Login (E1, E2):** the app gets a short-lived token via OIDC + PKCE through Keycloak, optionally with Google.
2. **Start session (A4, C8, D2):** Kong validates the token and applies the rate limit and timeout. records-svc creates the session idempotently with `client_session_id`.
3. **Log 50 balls (D1, C4, H7, H5, H3):** each ball is saved locally first, the form comes from the metadata-driven schema, and conditional fields appear ("yorker accurate?"). Live stats are computed by the shared evaluator.
4. **Every 3–5 min (D1, D3, C8, C9):** a checkpoint batch is sent with retries, backoff and jitter. Entries are upserted by `client_entry_id`, and deletes travel as tombstones.
5. **End (A6, B2):** `/complete` checks the count and, in **one transaction**, marks the session COMPLETED and writes the outbox event.
6. **Events (B1, B4, B3, B6, B8):** Kafka delivers the event to analytics consumers, which skip duplicates. Large payloads use a claim check, and poison messages go to the DLQ.
7. **Charts (C1, C2, C3):** rollups and `session_metric` are updated as Σnum ÷ Σden, and the chart cache is invalidated.
8. **Search later (C10, C11, C12, D2):** user-scoped, partition-pruned, keyset-paginated queries run, possibly on a replica, and always under the timeout ceiling.
9. **Throughout (F1–F5, D7, D8, G9):** traces, logs and metrics are collected. Probes and graceful shutdown keep deployments safe, and autoscaling follows the load.
10. **Release of a fix (G2–G6, E5, I1):** contract tests, signed image, GitOps PR, canary on EKS, and a backward-compatible migration.

---

## Reverse index – which patterns serve each NFR area

| NFR area | Patterns |
|---|---|
| **Performance** (NFR-PERF-01..11) | C1, C2, C3, C10, C11, C12, D1, D2, A4, C6 |
| **Throughput / scalability** (NFR-SCAL-01..05) | A1, A3, B1, B4, C2, C3, C10, C12, G9, D1 |
| **Availability / reliability** (NFR-REL-01..07) | B2, B3, B8, D1–D9, G4, G6, C12, A3 |
| **Data consistency / DB transactions** | A3, A6, B2, B3, B5, C6, C7, C8, C9, G6 |
| **Security** (NFR-SEC-01..10) | A4, E1–E6, D6, H1, H4, H5, G2, G3 |
| **Privacy** (NFR-PRIV-01..06) | B5, E3, E6, F2, F5, C9, C10 |
| **Observability** (NFR-OBS-01..07, TR-7) | F1–F5, B8, D7 |
| **Maintainability / extensibility** (NFR-MNT-01..06, TR-8/9) | A1, A2, A5, B1, B7, C4, C5, G5, G8, H1–H8 |
| **Portability** (NFR-PORT-01..04) | A5, E4, G1, G2, G3, G7, H2 |
| **Usability** (NFR-USE-*) | D1, C5, E2, F4 |
| **Cost** (NFR-COST-01..02) | C2, C3, C10, D6, F5, G7, G9 |
