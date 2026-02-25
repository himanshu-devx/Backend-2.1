# Volume 5 — Appendices, Glossary, and Checklists

## Appendix A — API Reference Summary

Source: `Backend-2.1/PAYMENT_API_DOCUMENTATION.md`

### A.1 Merchant Endpoints
- `POST /api/payment/payin/initiate`
- `POST /api/payment/payout/initiate`
- `GET /api/payment/:orderId`
- `GET /api/payment/payin/status/:orderId`
- `GET /api/payment/payout/status/:orderId`

### A.2 UAT Endpoints
- `POST /api/payment/uat/payin/initiate`
- `POST /api/payment/uat/payout/initiate`
- `GET /api/payment/uat/:orderId`
- `GET /api/payment/uat/payin/status/:orderId`
- `GET /api/payment/uat/payout/status/:orderId`

### A.3 Manual Admin Endpoints
- `POST /api/payment/manual/status/update`
- `POST /api/payment/manual/status/sync`
- `POST /api/payment/manual/expire/pending-previous-day`
- `POST /api/payment/manual/provider-fee-settlement`

---

## Appendix B — Configuration Matrix (Partial)

### B.1 Backend Env (selected)
- `PAYIN_AUTO_EXPIRE_MINUTES`
- `REPORT_STORAGE_DIR`
- `AMOUNT_UNIT`
- `OTLP_HTTP_URL`

### B.2 Deployment Env
- `.env.stack` for stack runtime
- `.env.backend` for service settings
- `.env.databases` for DB credentials
- `.env.monitoring` for Grafana/Loki/etc

---

## Appendix C — Glossary

- **Payin**: Customer to merchant transaction
- **Payout**: Merchant to beneficiary transfer
- **Ledger**: Double‑entry accounting system
- **PLE**: Provider Legal Entity
- **OTel**: OpenTelemetry
- **TPS**: Transactions per second

---

## Appendix D — Operational Checklists

### D.1 Deployment Checklist
- Validate client env files
- Deploy databases stack
- Deploy monitoring stack
- Deploy app stack
- Verify health checks
- Verify Prometheus targets

### D.2 Release Checklist
- Build backend image
- Build frontend image
- Update env vars
- Deploy via Ansible
- Smoke tests for payin/payout

---

## Appendix E — Open Questions

- SLA targets and uptime commitments
- Backup and recovery procedures
- Compliance and audit scope
- Production incident response playbooks

---

End of Volume 5.


---
