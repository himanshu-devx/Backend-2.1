# Log Schema (JSON) for Loki / Elasticsearch / Kibana / Grafana

This service emits structured JSON logs using `pino`. Fields are designed for
easy search, alerting, and dashboards. All logs are JSON in production.

## Common Fields (All Logs)
- `level`: log level (`info`, `warn`, `error`, `debug`)
- `time`: ISO timestamp
- `service`: service name (`api`, `payment`, `worker`)
- `env`: environment (`development`, `production`)
- `traceId`: OpenTelemetry trace ID
- `spanId`: OpenTelemetry span ID
- `requestId`: HTTP request ID (from `x-request-id` or generated)
- `correlationId`: correlation ID (`x-correlation-id` or request ID)
- `sampled`: boolean indicating if request-level logs are sampled in
- `sampleRate`: sampling rate (0..1)

## HTTP Request Logs
Emitted by `request-logger` middleware.

Example:
```json
{
  "level": "info",
  "time": "2026-02-18T12:01:22.100Z",
  "service": "payment",
  "env": "production",
  "event": "http_request",
  "method": "POST",
  "path": "/payin",
  "status": 200,
  "durationMs": 123.4,
  "requestId": "req_123",
  "correlationId": "req_123",
  "traceId": "4b7f...e1",
  "spanId": "7f3a...b2",
  "merchantId": "MRC_123",
  "ip": "203.0.113.10",
  "userAgent": "curl/8.5.0",
  "contentLength": "512",
  "responseLength": "343"
}
```

## Workflow Logs
Emitted by payment workflows (`PAYIN`, `PAYOUT`).

Step logs:
- `workflow`: `PAYIN` or `PAYOUT`
- `step`: step name (`prepare`, `validate`, `gatewayCall`, etc.)
- `durationMs`: step duration

Completion:
- `event`: `Workflow Completed` or `Workflow Failed`
- `durationMs`: total workflow latency

## Webhook Logs
Fields:
- `type`: `PAYIN`, `PAYOUT`, `COMMON`
- `providerId`, `legalEntityId`
- `transactionId`, `orderId`
- `status`: final status
- `event`: e.g. `WEBHOOK_LATE`, `WEBHOOK_SUCCESS`

## Cache Metrics (Logs + Metrics)
Cache hits/misses are emitted as metrics with labels:
- `kind`: `txn_by_id`, `txn_by_order`, `txn_by_provider_ref`

Use in dashboards:
- Cache hit ratio = hits / (hits + misses)

## Payment Metrics (Prometheus via OTel)
- `payment_request_total{type="PAYIN|PAYOUT"}`
- `payment_outcome_total{type="PAYIN|PAYOUT", outcome="success|failed"}`
- `payment_latency_ms_bucket{type, outcome}`
- `payment_step_latency_ms_bucket{type, step}`
- `payin_expired_total{reason}`
- `payout_status_poll_total{outcome}`

## Suggested Loki Labels
Use these as labels (low cardinality):
- `service`
- `env`
- `level`
- `event`
- `workflow`

Avoid using high-cardinality values (like `requestId`) as labels.

## Suggested Kibana Index Pattern
If using Elasticsearch, index by:
- `service`, `env`, `event`, `workflow`, `level`, `status`

## Redaction
Sensitive fields are redacted:
- Authorization headers
- Signatures
- Passwords, secrets, OTPs

Log schema is designed to be compatible with Grafana Loki and Elasticsearch.
