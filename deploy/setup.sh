#!/usr/bin/env bash
# Installs or updates Cista on a VPS that already runs Caddy. Run as root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/phoenix-2203/cista/main/deploy/setup.sh)
# Optional: a different DuckDNS name, e.g.  ... setup.sh) mycista
#
# What it sets up:
# - the web app, built to static files that Caddy serves;
# - the Cista server as a systemd service (cista.service) on 127.0.0.1:8787,
#   running as its own "cista" user, with its database in /var/lib/cista;
# - a Caddy site that serves both over HTTPS and relays read-only chain requests.
# No keys, mnemonics or secrets are needed: the server signs nothing.
# Other sites on this server are left alone: the Caddy config is checked before
# reloading, and the change is undone if the check fails.
set -euo pipefail
NAME="${1:-cista}"
DOMAIN="${NAME%.duckdns.org}.duckdns.org"
DIR=/opt/cista
SITE=/etc/caddy/cista.caddy
MAIN=/etc/caddy/Caddyfile
UNIT=/etc/systemd/system/cista.service

[ "$(uname -s)" = "Linux" ] || { echo "Log in to the server first (ssh), then run this there."; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Run this as root on the server (for example: sudo -i, then run it again)."; exit 1; }
command -v caddy >/dev/null || { echo "Caddy isn't installed. See https://caddyserver.com/docs/install"; exit 1; }
[ -f "$MAIN" ] || { echo "No $MAIN found. Is Caddy set up as a system service?"; exit 1; }
command -v node >/dev/null || { echo "Node.js 22.13 or newer is needed: https://nodejs.org"; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Node.js 22.13 or newer is needed (this server has $(node -v)). The server uses Node's built-in SQLite."; exit 1; }

if [ ! -d "$DIR/.git" ]; then
  git clone https://github.com/phoenix-2203/cista "$DIR"
else
  git -C "$DIR" pull --ff-only
fi

echo "Installing and building (uses up to 3 GB of memory)…"
cd "$DIR"
PNPM="npx -y pnpm@10"
command -v pnpm >/dev/null && PNPM=pnpm
$PNPM install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=3072 $PNPM --filter @cista/web build
chmod -R a+rX "$DIR"

echo "Starting the Cista server…"
id cista >/dev/null 2>&1 || useradd --system --home-dir /var/lib/cista --shell /usr/sbin/nologin cista
install -d -o cista -g cista -m 700 /var/lib/cista
sed "s/^Environment=CISTA_DOMAIN=.*/Environment=CISTA_DOMAIN=$DOMAIN/" "$DIR/deploy/cista.service" > "$UNIT"
systemctl daemon-reload
systemctl enable --now cista >/dev/null
systemctl restart cista
sleep 2
curl -fsS http://127.0.0.1:8787/api/health >/dev/null || { echo "The Cista server didn't start. See: journalctl -u cista -n 50"; exit 1; }

echo "Configuring Caddy for https://$DOMAIN …"
sed "s/^cista\.duckdns\.org {/$DOMAIN {/" "$DIR/deploy/Caddyfile" > "$SITE"
cp "$MAIN" "$MAIN.bak-cista"
grep -qxF "import $SITE" "$MAIN" || printf '\nimport %s\n' "$SITE" >> "$MAIN"
if ! caddy validate --config "$MAIN" --adapter caddyfile >/dev/null 2>&1; then
  cp "$MAIN.bak-cista" "$MAIN"
  echo "Caddy rejected the new config, so nothing was changed. Details:"
  caddy validate --config "$MAIN" --adapter caddyfile || true
  exit 1
fi
systemctl reload caddy

echo
echo "Done. Cista is at https://$DOMAIN (the HTTPS certificate can take a minute the first time)."
echo "Server logs: journalctl -u cista -f    To update later, run this script again."
