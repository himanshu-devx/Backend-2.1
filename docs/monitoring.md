# Monitoring & Grafana Dashboard Notes

This system exposes Prometheus metrics via the OpenTelemetry Prometheus exporter.
Default metrics endpoint: `http://<host>:9464/metrics`.

## Core Panels (Suggested)

### TPS (Requests / Workflow)
- `rate(payment_request_total[1m])` by `type`

### Success / Failure Rate
- Success: `rate(payment_outcome_total{outcome="success"}[5m])`
- Failure: `rate(payment_outcome_total{outcome="failed"}[5m])`
- Error rate: `rate(payment_outcome_total{outcome="failed"}[5m]) / rate(payment_request_total[5m])`

### p95 / p99 Latency
- p95: `histogram_quantile(0.95, sum(rate(payment_latency_ms_bucket[5m])) by (le, type, outcome))`
- p99: `histogram_quantile(0.99, sum(rate(payment_latency_ms_bucket[5m])) by (le, type, outcome))`

### Provider Timeouts / Errors
- Timeouts: `rate(provider_call_total{outcome="timeout"}[5m])`
- Circuit open: `rate(provider_call_total{outcome="circuit_open"}[5m])`
- Errors: `rate(provider_call_total{outcome="error"}[5m])`
- Provider latency p95: `histogram_quantile(0.95, sum(rate(provider_call_latency_ms_bucket[5m])) by (le, action, outcome))`

### Webhook Lag (p95)
- `histogram_quantile(0.95, sum(rate(webhook_lag_ms_bucket[5m])) by (le, type))`

### Cache Hit Ratio
- `sum(rate(payment_cache_hit_total[5m])) / (sum(rate(payment_cache_hit_total[5m])) + sum(rate(payment_cache_miss_total[5m])))`

### Queue Health
- Track worker logs for queue depth and retries.
- If you add custom metrics for queue length, chart those over time.

## Loki / Elasticsearch Notes
Use labels/tags:
- `service`, `env`, `level`, `event`, `workflow`

Avoid using `requestId` as a label (high cardinality).

Refer to `docs/log-schema.md` for the field-level schema.
