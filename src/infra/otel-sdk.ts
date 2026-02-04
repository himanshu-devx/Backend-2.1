// src/infra/otel.ts

// MUST be first
import "@opentelemetry/api";

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ENV } from "@/config/env";

const traceExporter = new OTLPTraceExporter({
  url: ENV.OTLP_HTTP_URL, // http://localhost:4318/v1/traces
});

const metricReader = new PrometheusExporter({
  port: 9464, // optional, for Prometheus metrics
});

const sdk = new NodeSDK({
  serviceName: ENV.SERVICE_NAME || "API-SERVICE", // <- sets service.name in your SDK version
  traceExporter,
  metricReader,
  instrumentations: [getNodeAutoInstrumentations()],
});

// autostart
(async () => {
  await sdk.start();
  console.log("[OTEL] initialized with:", {
    serviceName: ENV.SERVICE_NAME,
    otlpUrl: ENV.OTLP_HTTP_URL,
  });
})();
