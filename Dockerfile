FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV SERVICE=instances/api

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* tsconfig.build.json tsconfig.json ./
RUN npm install

COPY src ./src
COPY libs ./libs

RUN npm run build
RUN npm prune --omit=dev

CMD ["sh", "-c", "node dist/${SERVICE}.js"]
