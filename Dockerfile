FROM node:20-bookworm-slim AS base

WORKDIR /app
ENV NODE_ENV=production

FROM base AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci --include=dev

COPY src ./src
COPY libs ./libs

RUN npm run build
RUN npm prune --omit=dev

FROM base AS runner

RUN useradd --create-home --uid 10001 appuser
RUN mkdir -p /data/reports && chown -R appuser:appuser /data

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

ENV SERVICE=instances/api
USER appuser

CMD ["sh", "-c", "exec node dist/src/${SERVICE}.js"]
