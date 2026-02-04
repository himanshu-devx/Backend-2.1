#!/bin/bash
set -e

APP_DIR=$(pwd)
USER_NAME=$(whoami)
BUN_PATH=$(which bun || echo "$HOME/.bun/bin/bun")

echo "🚀 Starting Systemd Deployment..."
echo "   App Dir: $APP_DIR"
echo "   User:    $USER_NAME"
echo "   Bun:     $BUN_PATH"

# --- Helper Functions ---
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# --- 1. Install Dependencies ---
# Bun
if ! command_exists bun; then
  echo "🍞 Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Caddy
if ! command_exists caddy; then
  echo "🌐 Installing Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# --- 2. Build ---
echo "📦 Installing Deps & Building..."
$BUN_PATH install
$BUN_PATH run build:all

# --- 3. Create Systemd Services ---

# API Service
cat <<EOF > /etc/systemd/system/fintech-api.service
[Unit]
Description=Fintech API Service
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStart=$BUN_PATH run dist/api.js
Restart=always
RestartSec=3
EnvironmentFile=$APP_DIR/.env
Environment=API_PORT=4000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Payment Service
cat <<EOF > /etc/systemd/system/fintech-payment.service
[Unit]
Description=Fintech Payment Service
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStart=$BUN_PATH run dist/payment.js
Restart=always
RestartSec=3
EnvironmentFile=$APP_DIR/.env
Environment=PAYMENT_PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo "⚙️  Reloading Systemd..."
systemctl daemon-reload

echo "🔄 Restarting Services..."
systemctl enable --now fintech-api
systemctl enable --now fintech-payment
systemctl restart fintech-api
systemctl restart fintech-payment

# --- 4. Caddy ---
echo "🌐 Configuring Caddy..."
caddy fmt --overwrite Caddyfile
cp Caddyfile /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo "✅ Deployment Complete!"
systemctl status fintech-api --no-pager
systemctl status fintech-payment --no-pager
