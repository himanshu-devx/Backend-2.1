# Deployment Folder

This folder contains **only deployment artifacts** (compose files, monitoring configs, env templates, and docs).

Build the Docker image from repo root, push it to your registry, then deploy using compose.

Files:
- `DEPLOYMENT.md` – full production setup guide
- `app/docker-compose.yml` – app stack (api, payment, worker) using prebuilt image
- `data/docker-compose.yml` – data stack (Postgres, MongoDB, Redis)
- `monitoring/docker-compose.yml` – metrics/logs/tracing stack
- `app/Caddyfile` – TLS reverse proxy for API + Payment (App Server)
- `monitoring/Caddyfile` – TLS reverse proxy for Grafana/Prometheus/Loki/Tempo
- `all/docker-compose.yml` – single‑server stack (app + data + monitoring + caddy)
- `*/.env.example` – env templates per stack
