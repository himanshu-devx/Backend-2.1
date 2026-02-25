# Wisipay Finetech 2.1 — Full Technical Project Report

Audience: Internal Engineering
Purpose: Knowledge Transfer
Language: English
Generated from repo state

---

# Wisipay Finetech 2.1 — Technical Project Report (Internal Engineering)

Document Type: Full Technical Report (HLD + LLD + System Design)
Version: 0.1 (generated from repo state)
Audience: Internal Engineering
Language: English
Scope: Backend, Frontend, Deployment/Infra, Workflows, Security, Observability

---

## Document Map

- `Wisipay-Finetech-2.1-Full-Report.md`
- `00-table-of-contents.md`
- `01-executive-summary-and-hld.md`
- `02-backend-lld.md`
- `03-frontend-lld.md`
- `04-infra-ops-nfr.md`
- `05-appendices.md`
- `06-extended-addendum.md`
- `07-data-dictionary.md`
- `08-api-spec-detailed.md`
- `09-observability-full.md`
- `10-env-catalog.md`
- `11-security-compliance.md`
- `12-runbooks.md`
- `13-ci-cd-testing.md`
- `14-reference-docs.md`
- `15-api-list.md`

## Diagram Index

- System Context (C4 L1): `01-executive-summary-and-hld.md` + `diagrams/system-context.svg`
- Container Architecture (C4 L2): `01-executive-summary-and-hld.md` + `diagrams/container-architecture.svg`
- Payin Sequence: `02-backend-lld.md` + `diagrams/payin-sequence.svg`
- Payout Sequence: `02-backend-lld.md` + `diagrams/payout-sequence.svg`
- Dashboard Data Flow: `03-frontend-lld.md` + `diagrams/frontend-dashboard-flow.svg`
- Deployment Topology: `04-infra-ops-nfr.md` + `diagrams/deployment-topology.svg`
- Core Data Model: `07-data-dictionary.md` + `diagrams/data-model.svg`
- Observability Pipeline: `09-observability-full.md` + `diagrams/observability-pipeline.svg`
- Request Validation Flow: `11-security-compliance.md` + `diagrams/security-request-validation.svg`
- CI/CD Pipeline: `13-ci-cd-testing.md` + `diagrams/cicd-pipeline.svg`

## Volume Plan (Target 100+ pages total)

- Volume 1: Executive Summary, Scope, System Context, HLD Overview
- Volume 2: Backend LLD (Services, Controllers, Workflows, Ledger, Providers)
- Volume 3: Frontend LLD, Data Model, API Contract, Integration Details
- Volume 4: Infrastructure, Deployment, Observability, NFRs, Security, Ops
- Volume 5: Appendices (Config, Glossary, Checklists, Risk Register)

---

## Detailed Table of Contents

### 1. Executive Summary
1.1 Business Objective and Scope
1.2 Outcomes and Key Capabilities
1.3 Target Users and Stakeholders

### 2. Project Context
2.1 Problem Statement
2.2 Constraints and Assumptions
2.3 Out-of-Scope Items
2.4 Terminology and Acronyms

### 3. System Context (C4 Level 1)
3.1 Actors and Roles (Merchants, Admins, Providers)
3.2 External Systems and Integrations
3.3 Context Diagram (Logical)
3.4 Trust Boundaries

### 4. High-Level Architecture (HLD)
4.1 Architectural Style and Tenets
4.2 Service Topology (API, Payment, Worker, Frontend)
4.3 Data Stores (Postgres, MongoDB, Redis)
4.4 Observability and Logging Stack
4.5 Deployment Topology (App, Databases, Monitoring Stacks)
4.6 HLD Diagram (System/Container)

### 5. Core Business Capabilities
5.1 Payin Lifecycle
5.2 Payout Lifecycle
5.3 Status Polling and Webhooks
5.4 Ledger and Accounting
5.5 Reporting and Exports
5.6 Manual Operations (Admin)

### 6. System Design (Flows)
6.1 Payin Initiation — Sequence
6.2 Payin Webhook — Sequence
6.3 Payout Initiation — Sequence
6.4 Payout Polling — Sequence
6.5 Manual Status Update — Sequence
6.6 Provider Fee Settlement — Sequence

### 7. Data Architecture
7.1 Primary Data Entities (Transaction, Merchant, Provider, Ledger)
7.2 Storage Mapping (Mongo vs Postgres)
7.3 Indexing and Query Patterns
7.4 Data Consistency and Idempotency

### 8. Backend LLD
8.1 Layering Overview (Controllers, Services, Repos, Workflows)
8.2 Instances (api, payment, worker)
8.3 Payment Module (Controllers, DTOs, Service)
8.4 Ledger Module (Transfer, Entry, Operations)
8.5 Provider Config and Provider Client
8.6 Security Middleware (HMAC, IP Whitelist)
8.7 Job and Webhook Queues
8.8 Audit and Logging

### 9. Frontend LLD
9.1 Dashboard Structure
9.2 UI Components and Data Model
9.3 Auth/Session (if any)
9.4 API Integration Points

### 10. Infrastructure & Deployment
10.1 Docker Packaging
10.2 App Stack (Caddy, API, Payment, Worker, Frontend)
10.3 Databases Stack (Postgres, Mongo, Redis)
10.4 Monitoring Stack (Prometheus, Loki, Grafana, Tempo, OTel Collector)
10.5 Network Segmentation and Ports
10.6 Ansible Deployment Workflow
10.7 Environment Configuration and Secrets

### 11. Non-Functional Requirements
11.1 Performance and Throughput
11.2 Availability and Resilience
11.3 Security Controls
11.4 Compliance (Documented / TBD)
11.5 Observability (Logs, Metrics, Traces)
11.6 Operational Controls and Maintenance

### 12. Risk Register
12.1 Known Risks
12.2 Mitigations
12.3 Residual Risks

### 13. Testing Strategy
13.1 Unit Testing
13.2 Integration Testing
13.3 UAT Flows
13.4 Performance Testing

### 14. CI/CD and Release Strategy
14.1 Build Pipeline
14.2 Artifact Strategy
14.3 Deployment Strategy
14.4 Rollback Strategy

### 15. Appendices
15.1 API Reference Summary
15.2 Configuration Matrix
15.3 Glossary
15.4 Open Questions / TBD Items

---

Notes:
- This report is generated from repo structure and configuration. Items not found in code/config are marked as TBD.
- Detailed volumes will be produced iteratively to reach 100+ pages.


---
