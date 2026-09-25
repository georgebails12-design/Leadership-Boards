#!/usr/bin/env bash
# One-time setup on the VPS (run as root, e.g. in Hostinger's browser terminal):
#   curl -fsSL https://raw.githubusercontent.com/georgebails12-design/Leadership-Boards/main/deploy/install.sh | bash
#
# - installs Node.js if it's missing
# - asks for the monday.com API token and the team password (stored only in
#   /etc/leadership-boards.env, readable by root only)
# - installs the leadership-boards service on 127.0.0.1:8040 and an updater that
#   pulls new commits from GitHub every 2 minutes (same pattern as the PO app)
# - adds boards.pandawd.online to nginx (with an HTTPS certificate) or Caddy
#
# Re-running is safe. To change the token or password later:
#   curl -fsSL .../deploy/install.sh | bash -s -- --reset-secrets
set -euo pipefail

DOMAIN="${BOARDS_DOMAIN:-boards.pandawd.online}"
PORT="${BOARDS_PORT:-8040}"
RAW="https://raw.githubusercontent.com/georgebails12-design/Leadership-Boards/main/deploy"
ENV_FILE="/etc/leadership-boards.env"
APP_USER="boards"
RESET_SECRETS=""
[ "${1:-}" = "--reset-secrets" ] && RESET_SECRETS=1

[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --- Node.js ---------------------------------------------------------------
node_major() { node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }
if [ -z "$(node_major)" ] || [ "$(node_major)" -lt 18 ]; then
  say "Installing Node.js 22..."
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  else
    echo "Couldn't find apt-get or dnf; install Node.js 18+ and re-run."; exit 1
  fi
fi
NODE_BIN="$(command -v node)"
echo "Node.js $(node -v) at $NODE_BIN"

# --- user, folders, port ---------------------------------------------------
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home /opt/leadership-boards --shell /usr/sbin/nologin "$APP_USER"
mkdir -p /opt/leadership-boards/app
chown -R "$APP_USER:$APP_USER" /opt/leadership-boards

if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN && ! systemctl is-active --quiet leadership-boards; then
  echo "Port $PORT is already in use by something else. Re-run with BOARDS_PORT=<free port>."; exit 1
fi

# --- secrets ---------------------------------------------------------------
if [ ! -f "$ENV_FILE" ] || [ -n "$RESET_SECRETS" ]; then
  say "Secrets (typed input is hidden and stored only in $ENV_FILE)"
  read -r -s -p "monday.com API token: " MONDAY_TOKEN </dev/tty; echo
  read -r -s -p "Team password for the site: " TEAM_PASSWORD </dev/tty; echo
  [ -n "$MONDAY_TOKEN" ] && [ -n "$TEAM_PASSWORD" ] || { echo "Both are required."; exit 1; }
  SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')"
  umask 077
  cat > "$ENV_FILE" <<EOF
MONDAY_API_TOKEN=$MONDAY_TOKEN
REPORT_PASSWORD=$TEAM_PASSWORD
SESSION_SECRET=$SESSION_SECRET
PORT=$PORT
HOST=127.0.0.1
EOF
  chmod 600 "$ENV_FILE"
  unset MONDAY_TOKEN TEAM_PASSWORD
  echo "Saved. Everyone will need to sign in again."
fi

# --- service ---------------------------------------------------------------
cat > /etc/systemd/system/leadership-boards.service <<UNIT
[Unit]
Description=Leadership Boards (monday.com reports)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=/opt/leadership-boards/app
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# --- updater ---------------------------------------------------------------
curl -fsSL "$RAW/update.sh" -o /usr/local/bin/leadership-boards-update
chmod 755 /usr/local/bin/leadership-boards-update

cat > /etc/systemd/system/leadership-boards-update.service <<'UNIT'
[Unit]
Description=Deploy latest Leadership-Boards main
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/leadership-boards-update
UNIT

cat > /etc/systemd/system/leadership-boards-update.timer <<'UNIT'
[Unit]
Description=Check GitHub for Leadership Boards updates every 2 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable leadership-boards >/dev/null
say "Deploying the app..."
/usr/local/bin/leadership-boards-update --force || true
systemctl restart leadership-boards
systemctl enable --now leadership-boards-update.timer >/dev/null
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null; then
  echo "App is running on 127.0.0.1:$PORT"
else
  echo "App didn't start; recent log:"; journalctl -u leadership-boards -n 30 --no-pager; exit 1
fi

# --- reverse proxy + HTTPS -------------------------------------------------
say "Setting up https://$DOMAIN"
if command -v nginx >/dev/null && [ -d /etc/nginx ]; then
  conf_dir=/etc/nginx/sites-available
  [ -d "$conf_dir" ] || conf_dir=/etc/nginx/conf.d
  conf="$conf_dir/$DOMAIN"
  [ "$conf_dir" = /etc/nginx/conf.d ] && conf="$conf_dir/$DOMAIN.conf"
  if [ ! -f "$conf" ]; then
    cat > "$conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
    [ -d /etc/nginx/sites-enabled ] && ln -sf "$conf" "/etc/nginx/sites-enabled/$DOMAIN"
  fi
  nginx -t && systemctl reload nginx
  if command -v certbot >/dev/null; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --register-unsafely-without-email \
      || echo "certbot didn't finish; check that $DOMAIN points to this server, then run: certbot --nginx -d $DOMAIN"
  else
    echo "certbot isn't installed, so the site is HTTP only. Install it (apt-get install -y certbot python3-certbot-nginx) and run: certbot --nginx -d $DOMAIN"
  fi
elif command -v caddy >/dev/null && [ -f /etc/caddy/Caddyfile ]; then
  if ! grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
    printf '\n%s {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" >> /etc/caddy/Caddyfile
  fi
  systemctl reload caddy
else
  echo "Didn't find nginx or Caddy. Whatever serves po.pandawd.online needs a site for $DOMAIN"
  echo "that forwards to http://127.0.0.1:$PORT. What's listening on 80/443:"
  ss -ltnp '( sport = :80 or sport = :443 )' || true
  exit 0
fi

say "Done: https://$DOMAIN/job-milestones/"
echo "Updates from GitHub are picked up within 2 minutes (journalctl -u leadership-boards-update)."
