FROM oven/bun:1.1.36 AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bunfig.toml tsconfig.json ./
COPY libs/fintech-ledger ./libs/fintech-ledger
RUN bun install

COPY src ./src
RUN bun run build:all


# 👇 NEW RUNTIME (glibc 2.34+)
FROM debian:12-slim

# Install bun runtime
RUN apt-get update && apt-get install -y curl ca-certificates \
  && curl -fsSL https://bun.sh/install | bash \
  && ln -s /root/.bun/bin/bun /usr/local/bin/bun \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV SERVICE=api

COPY --from=builder /app/dist ./dist
COPY --from=builder /root/.bun /root/.bun
COPY package.json ./

CMD ["sh", "-c", "bun ./dist/${SERVICE}.js"]
