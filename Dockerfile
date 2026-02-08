FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV SERVICE=api

# Native build deps (argon2)
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source / build output
COPY dist ./dist

# Run selected service
CMD ["sh", "-c", "node dist/${SERVICE}.js"]
