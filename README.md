# Fintech Bun + Hono (Single repo, Multi instances)

Instances:

- api (public)
- payment (internal/payments)
- worker (cron/background)

## Dev

```
bun install
cp .env.example .env
bun run dev
```

Run only one:

```
bun run dev:api
bun run dev:payment
bun run dev:worker
```

## Build bundles

```
bun run build
ls dist
```
