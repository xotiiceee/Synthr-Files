#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/pulse/pulse.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pulse}"
REPO_DIR="${REPO_DIR:-$(pwd)}"
DEPLOY_INFO_URL="${DEPLOY_INFO_URL:-http://localhost:3457/api/deploy-info}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[backup] ERROR: env file not found: ${ENV_FILE}" >&2
  exit 1
fi

read_env_value() {
  node - "$ENV_FILE" "$1" <<'NODE'
const fs = require("node:fs");

const [file, key] = process.argv.slice(2);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=\\s*(.*)$`);

for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const match = line.match(pattern);
  if (!match) continue;

  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }
  process.stdout.write(value);
  process.exit(0);
}
NODE
}

HOSTED_DB_PATH="$(read_env_value HOSTED_DB_PATH)"
PULSE_HEART_PATH="$(read_env_value PULSE_HEART_PATH)"
PULSE_HEART_SECRET="$(read_env_value PULSE_HEART_SECRET)"

if [ -z "${HOSTED_DB_PATH:-}" ]; then
  echo "[backup] ERROR: HOSTED_DB_PATH must be set in ${ENV_FILE}" >&2
  exit 1
fi

if [ -z "${PULSE_HEART_PATH:-}" ]; then
  echo "[backup] ERROR: PULSE_HEART_PATH must be set in ${ENV_FILE}" >&2
  exit 1
fi

if [ -z "${PULSE_HEART_SECRET:-}" ]; then
  echo "[backup] ERROR: PULSE_HEART_SECRET must be set in ${ENV_FILE}" >&2
  exit 1
fi

case "$HOSTED_DB_PATH" in
  /*) ;;
  *)
    echo "[backup] ERROR: HOSTED_DB_PATH must be absolute: ${HOSTED_DB_PATH}" >&2
    exit 1
    ;;
esac

case "$PULSE_HEART_PATH" in
  /*) ;;
  *)
    echo "[backup] ERROR: PULSE_HEART_PATH must be absolute: ${PULSE_HEART_PATH}" >&2
    exit 1
    ;;
esac

if [ ! -f "$HOSTED_DB_PATH" ]; then
  echo "[backup] ERROR: hosted DB not found: ${HOSTED_DB_PATH}" >&2
  exit 1
fi

if [ ! -f "$PULSE_HEART_PATH" ]; then
  echo "[backup] ERROR: Pulse heart file not found: ${PULSE_HEART_PATH}" >&2
  exit 1
fi

node - "$PULSE_HEART_PATH" "$PULSE_HEART_SECRET" <<'NODE'
const fs = require("node:fs");
const { loadSomaHeart } = require("soma-heart");

const [heartPath, secret] = process.argv.slice(2);
try {
  loadSomaHeart(fs.readFileSync(heartPath, "utf8"), secret);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backup] ERROR: Pulse heart file is not readable: ${message}`);
  process.exit(1);
}
NODE

mkdir -p "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
staging="$(mktemp -d)"
archive_base="${BACKUP_DIR}/pulse-${ts}"
archive="${archive_base}.tgz"
archive_tmp="$(mktemp "${BACKUP_DIR}/.pulse-${ts}.XXXXXX.tgz")"

counter=1
while [ -e "$archive" ]; do
  archive="${archive_base}-${counter}.tgz"
  counter=$((counter + 1))
done

cleanup() {
  rm -rf "$staging"
  rm -f "$archive_tmp"
}
trap cleanup EXIT

mkdir -p "$staging/etc/pulse" "$staging/state" "$staging/meta"
cp "$ENV_FILE" "$staging/etc/pulse/pulse.env"

(
  cd "$REPO_DIR"
  npx tsx scripts/backup-hosted-db.ts "$HOSTED_DB_PATH" "$staging/state/hosted.db"
)

cp "$PULSE_HEART_PATH" "$staging/state/pulse-heart.json"

if [ -d "$REPO_DIR/data/tenants" ]; then
  mkdir -p "$staging/state/tenants"
  cp -a "$REPO_DIR/data/tenants/." "$staging/state/tenants/"
fi

if [ -f "$REPO_DIR/hosted/deploy-meta.json" ]; then
  cp "$REPO_DIR/hosted/deploy-meta.json" "$staging/meta/deploy-meta.json"
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsS "$DEPLOY_INFO_URL" > "$staging/meta/deploy-info.json" || true
fi

(
  cd "$staging"
  sha256sum \
    etc/pulse/pulse.env \
    state/hosted.db \
    state/pulse-heart.json \
    > meta/manifest.sha256
  tar -czf "$archive_tmp" .
)
chmod 600 "$archive_tmp"
mv "$archive_tmp" "$archive"

sha256sum "$archive"
echo "[backup] wrote ${archive}"
