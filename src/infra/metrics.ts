import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("payment-metrics");

const cacheHitCounter = meter.createCounter("payment_cache_hit_total", {
  description: "Cache hits for payment-related caches",
});

const cacheMissCounter = meter.createCounter("payment_cache_miss_total", {
  description: "Cache misses for payment-related caches",
});

const payinExpiredCounter = meter.createCounter("payin_expired_total", {
  description: "Payin transactions expired due to webhook timeout",
});

const payoutPollCounter = meter.createCounter("payout_status_poll_total", {
  description: "Payout status polling outcomes",
});

const paymentRequestCounter = meter.createCounter("payment_request_total", {
  description: "Total payment workflow requests",
});

const paymentOutcomeCounter = meter.createCounter("payment_outcome_total", {
  description: "Payment workflow outcomes",
});

const paymentLatencyMs = meter.createHistogram("payment_latency_ms", {
  description: "Payment workflow latency in milliseconds",
});

const paymentStepLatencyMs = meter.createHistogram("payment_step_latency_ms", {
  description: "Payment workflow step latency in milliseconds",
});

const providerCallCounter = meter.createCounter("provider_call_total", {
  description: "Total provider calls by action and outcome",
});

const providerCallLatencyMs = meter.createHistogram("provider_call_latency_ms", {
  description: "Provider call latency in milliseconds",
});

const webhookLagMs = meter.createHistogram("webhook_lag_ms", {
  description: "Webhook processing lag from transaction creation",
});

const safe = (fn: () => void) => {
  try {
    fn();
  } catch {
    // Metrics must never break business logic
  }
};

export const Metrics = {
  cacheHit(kind: string) {
    safe(() => cacheHitCounter.add(1, { kind }));
  },
  cacheMiss(kind: string) {
    safe(() => cacheMissCounter.add(1, { kind }));
  },
  payinExpired(reason: string) {
    safe(() => payinExpiredCounter.add(1, { reason }));
  },
  payoutPoll(outcome: string) {
    safe(() => payoutPollCounter.add(1, { outcome }));
  },
  paymentRequest(type: string) {
    safe(() => paymentRequestCounter.add(1, { type }));
  },
  paymentOutcome(type: string, outcome: "success" | "failed") {
    safe(() => paymentOutcomeCounter.add(1, { type, outcome }));
  },
  paymentLatency(type: string, outcome: "success" | "failed", ms: number) {
    safe(() => paymentLatencyMs.record(ms, { type, outcome }));
  },
  paymentStepLatency(type: string, step: string, ms: number) {
    safe(() => paymentStepLatencyMs.record(ms, { type, step }));
  },
  providerCall(action: string, outcome: string) {
    safe(() => providerCallCounter.add(1, { action, outcome }));
  },
  providerCallLatency(action: string, outcome: string, ms: number) {
    safe(() => providerCallLatencyMs.record(ms, { action, outcome }));
  },
  webhookLag(type: string, ms: number) {
    safe(() => webhookLagMs.record(ms, { type }));
  },
} as const;
