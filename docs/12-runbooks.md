# Volume 12 — Operational Runbooks

This section documents operational procedures for engineers and SREs.

---

## 1. Deploy App Stack

1. Ensure env files exist under `Deployment/clients/<client>`
2. Deploy DB stack first
3. Deploy monitoring stack
4. Deploy app stack
5. Verify health checks

Commands:
```
ansible-playbook ansible/playbooks/databases.yml -e client=<client>
ansible-playbook ansible/playbooks/monitoring.yml -e client=<client>
ansible-playbook ansible/playbooks/app.yml -e client=<client>
```

---

## 2. Rollback Procedure

1. Identify previous stable image tags
2. Update image tag in docker-compose
3. Redeploy stack
4. Validate health endpoints

---

## 3. Provider Outage Handling

1. Detect elevated provider error rates in Grafana
2. Pause routing for affected provider
3. Enable fallback routing if configured
4. Notify operations/merchant support

---

## 4. Ledger Integrity Issue

1. Run integrity check job manually
2. Inspect ledger audit logs
3. Rebuild EOD snapshots if needed

---

## 5. Webhook Backlog

1. Inspect Redis delayed and DLQ queues
2. Confirm worker health
3. Increase worker instances
4. Re‑enqueue failed tasks if safe

---

## 6. Payin Auto‑Expiry Issues

1. Validate `PAYIN_AUTO_EXPIRE_MINUTES`
2. Verify cron sweep job is running
3. Monitor `PAYIN_AUTO_EXPIRE` job queue

---

## 7. Payout Status Polling Issues

1. Check polling flags in Redis
2. Validate provider status endpoint
3. Re‑enqueue polling jobs if needed

---

## 8. Report Generation Failures

1. Inspect `generated_reports` status
2. Check report storage dir
3. Verify disk permissions

---

End of Volume 12.


---
