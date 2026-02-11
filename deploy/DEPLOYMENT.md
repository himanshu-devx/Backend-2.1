# Production Deployment (3 Servers)

You will build the **Docker image once**, push it to your registry, then deploy using **Docker Compose** with env files. No code is needed on servers.

Servers:
1) **App Server** (api, payment, worker)
2) **Data Server** (Postgres, MongoDB, Redis)
3) **Monitoring Server** (Prometheus, Grafana, Loki, Tempo, OTel Collector)

---

## 1) Build & Push Image (CI/CD or Build Host)

From repo root:
```
docker build -t <REGISTRY>/<APP_IMAGE>:<APP_TAG> .
docker push <REGISTRY>/<APP_IMAGE>:<APP_TAG>
```

Example:
```
docker build -t ghcr.io/your-org/your-app:1.0.0 .
docker push ghcr.io/your-org/your-app:1.0.0
```

### One‑Command Docker Hub Push (Recommended)

Use the helper script `deploy/dockerhub/build-push.sh`. It supports a local env file so you don’t have to type secrets each time.

Create a local file **outside the repo** (never commit secrets):
```
# ~/.dockerhub.env
DOCKER_IMAGE=yourdockerhubuser/your-app
DOCKER_TAG=1.0.0
DOCKER_USERNAME=yourdockerhubuser
DOCKER_TOKEN=your_dockerhub_access_token
```

Run:
```
DOCKER_ENV_FILE=~/.dockerhub.env ./deploy/dockerhub/build-push.sh
```

Optional overrides:
- `DOCKER_PLATFORM` (default `linux/amd64`)
- `DOCKERFILE` (default `Dockerfile`)
- `DOCKER_CONTEXT` (default `.`)

---

## 2) App Server Deployment

1. Copy env template:
```
cp deploy/app/.env.example deploy/app/.env
```
2. Update these values in `deploy/app/.env`:
- `APP_IMAGE` and `APP_TAG`
- `MONGODB_URI`, `POSTGRES_HOST`, `REDIS_URL` (point to Data Server)
- `JWT_SECRET`, `API_SECRET_ENC_KEY`
- `APP_BASE_URL`, `FRONTEND_URL`, SMTP settings
- `CADDY_EMAIL`, `API_DOMAIN`, `PAYMENT_DOMAIN`
- `OTLP_HTTP_URL` (Monitoring Server)

3. Start:
```
cd deploy/app
docker compose up -d
```

Scale for more clients/traffic:
```
docker compose up -d --scale api=2 --scale payment=2 --scale worker=2
```

---

## 2.1) Caddy Reverse Proxy (TLS + Domains) – App Server

Caddy is **included in the App stack**. Configure it via `deploy/app/.env`:
- `CADDY_EMAIL`
- `API_DOMAIN` (e.g., api.yourdomain.com)
- `PAYMENT_DOMAIN` (e.g., pay.yourdomain.com)

Ensure DNS for both domains points to the **App Server** IP.
App Caddy overwrites `X-Forwarded-For` and `X-Real-IP` so the backend always receives the real client IP.

---

## 3) Data Server Deployment

1. Copy env template:
```
cp deploy/data/.env.example deploy/data/.env
```
2. Start:
```
cd deploy/data
docker compose up -d
```

Lock down firewall to allow only App Server IPs on DB/Redis ports.

---

## 4) Monitoring Server Deployment

1. Copy env template:
```
cp deploy/monitoring/.env.example deploy/monitoring/.env
```
2. Start:
```
cd deploy/monitoring
docker compose up -d
```

Update App Server `.env`:
```
OTLP_HTTP_URL=http://<monitoring-server-ip>:4318/v1/traces
```

Monitoring Caddy is **included in the Monitoring stack**. Configure it via `deploy/monitoring/.env`:
- `CADDY_EMAIL`
- `GRAFANA_DOMAIN`

Ensure DNS for **Grafana** points to the **Monitoring Server** IP. Loki/Tempo/Prometheus do not require DNS.

---

## Single‑Server (All‑in‑One) Deployment

Use this when you want **one server** running app + database + monitoring + Traefik.

1. Copy env template:
```
cp deploy/all/.env.example deploy/all/.env.prod
```
2. Update these values in `deploy/all/.env.prod`:
- `JWT_SECRET`, `API_SECRET_ENC_KEY`
- Email settings
- `APP_BASE_URL`, `FRONTEND_URL`
- `TRAEFIK_ACME_EMAIL`, `API_DOMAIN`, `PAYMENT_DOMAIN`

3. Start:
```
cd deploy/all
docker compose up -d
```

Notes:
- This uses the same `app_net` network name.
- Promtail/Cadvisor require Docker host mounts.

---

## Multi‑Client Setup

For each client, duplicate the app folder and set a unique compose project name:
```
cp -a deploy/app deploy/app-clientA
cp deploy/app/.env.example deploy/app-clientA/.env
```
Then update `deploy/app-clientA/.env` and add:
```
COMPOSE_PROJECT_NAME=clientA
```
Start:
```
cd deploy/app-clientA
docker compose up -d
```

---

## Notes / Tips

- Use a reverse proxy (Nginx/Caddy) in front of App Server for TLS.
- Back up Postgres and MongoDB volumes regularly.
- Keep Redis password and DB credentials secret.
- Adjust TPS limits per merchant and globally.
