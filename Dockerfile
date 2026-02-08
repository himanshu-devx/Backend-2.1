FROM oven/bun:1.1.36 AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bunfig.toml tsconfig.json ./
COPY libs/fintech-ledger ./libs/fintech-ledger
ENV npm_config_napi_build_version=8
RUN bun install

COPY src ./src

RUN bun run build:all

FROM oven/bun:1.1.36 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV SERVICE=api

COPY --from=builder /app/dist ./dist
COPY package.json ./

CMD ["sh", "-c", "bun run dist/${SERVICE}.js"]
