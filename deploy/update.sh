#!/usr/bin/env bash
# Pull-based deploy for Leadership Boards (boards.pandawd.online).
#
# Run by the leadership-boards-update.timer systemd unit every 2 minutes.
# Checks the latest commit on main; if the app files changed since the last
# deploy, copies them into APP_DIR, restarts the service and checks /healthz.
# If the app doesn't come back, the previous code is restored and restarted.
#
# Secrets live in /etc/leadership-boards.env, never in the repository.
set -euo pipefail

REPO="georgebails12-design/Leadership-Boards"
BRANCH="main"
APP_DIR="/opt/leadership-boards/app"
APP_OWNER="boards"
SERVICE="leadership-boards"
ENV_FILE="/etc/leadership-boards.env"
STATE_DIR="/var/lib/leadership-boards-update"
BACKUP_DIR="$STATE_DIR/backups"

PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -n1)
HEALTH_URL="http://127.0.0.1:${PORT:-8040}/healthz"

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$APP_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

sha=$(curl -fsS -H "Accept: application/vnd.github.sha" \
  "https://api.github.com/repos/$REPO/commits/$BRANCH")
[ "$sha" = "$(cat "$STATE_DIR/last_sha" 2>/dev/null)" ] && [ "${1:-}" != "--force" ] && exit 0

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$sha" \
  | tar -xz -C "$tmp" --strip-components=1
[ -f "$tmp/server.js" ] || { echo "no server.js in $sha, skipping"; exit 1; }
src="$tmp"

tree_hash=$(cd "$src" && find . -type f -not -path './deploy/*' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
if [ "$tree_hash" = "$(cat "$STATE_DIR/last_tree" 2>/dev/null)" ] && [ "${1:-}" != "--force" ]; then
  echo "$sha" > "$STATE_DIR/last_sha"
  exit 0
fi

echo "Deploying $sha"
backup="$BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -C "$APP_DIR" -czf "$backup" .

rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
tar -C "$src" --exclude=./deploy -cf - . | tar -C "$APP_DIR.new" -xf -
rm -rf "$APP_DIR.old"
mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"
rm -rf "$APP_DIR.old"
chown -R "$APP_OWNER:$APP_OWNER" "$APP_DIR"

systemctl restart "$SERVICE"
healthy=""
for _ in $(seq 1 15); do
  sleep 2
  if curl -fsS -o /dev/null "$HEALTH_URL"; then healthy=1; break; fi
done

if [ -z "$healthy" ]; then
  echo "Health check failed for $sha -- restoring previous code from $backup"
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  tar -C "$APP_DIR" -xzf "$backup"
  chown -R "$APP_OWNER:$APP_OWNER" "$APP_DIR"
  systemctl restart "$SERVICE"
  # Record the sha so a broken commit isn't retried every 2 minutes;
  # the next commit on main will be tried as normal.
  echo "$sha" > "$STATE_DIR/last_sha"
  exit 1
fi

echo "$sha" > "$STATE_DIR/last_sha"
echo "$tree_hash" > "$STATE_DIR/last_tree"
echo "$sha" > "$APP_DIR/DEPLOYED_COMMIT"
ls -1t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
echo "Deployed $sha"
