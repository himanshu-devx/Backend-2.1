# -------- BUILD STAGE (Bun) --------
FROM oven/bun:1.1.36 AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bunfig.toml tsconfig.json ./
COPY libs/fintech-ledger ./libs/fintech-ledger
RUN bun install

COPY src ./src
RUN bun run build:all


# -------- RUNTIME STAGE (Node) --------
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV SERVICE=api

# Install only prod deps (argon2 etc.)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy compiled JS
COPY --from=builder /app/dist ./dist

CMD ["sh", "-c", "node dist/${SERVICE}.js"]
