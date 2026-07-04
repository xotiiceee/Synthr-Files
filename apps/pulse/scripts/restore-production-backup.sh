#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:-}"
ENV_FILE="${ENV_FILE:-/etc/pulse/pulse.env}"
DATA_DIR="${DATA_DIR:-data}"
RESTORE_CONFIRM="${PULSE_RESTORE_CONFIRM:-}"
ENV_INSTALL_OWNER="${ENV_INSTALL_OWNER:-}"
ENV_INSTALL_GROUP="${ENV_INSTALL_GROUP:-}"
STATE_INSTALL_OWNER="${STATE_INSTALL_OWNER:-${INSTALL_OWNER:-}}"
STATE_INSTALL_GROUP="${STATE_INSTALL_GROUP:-${INSTALL_GROUP:-}}"

if [ -z "$ARCHIVE" ]; then
  echo "Usage: PULSE_RESTORE_CONFIRM=restore bash scripts/restore-production-backup.sh <backup.tgz>" >&2
  exit 1
fi

if [ "$RESTORE_CONFIRM" != "restore" ]; then
  echo "[restore] ERROR: set PULSE_RESTORE_CONFIRM=restore to overwrite local production state" >&2
  exit 1
fi

if [ ! -f "$ARCHIVE" ]; then
  echo "[restore] ERROR: backup archive not found: ${ARCHIVE}" >&2
  exit 1
fi

read_env_value() {
  node - "$1" "$2" <<'NODE'
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

require_absolute_path() {
  local key="$1"
  local value="$2"

  if [ -z "$value" ]; then
    echo "[restore] ERROR: ${key} must be set in restored env file" >&2
    exit 1
  fi

  case "$value" in
    /*) ;;
    *)
      echo "[restore] ERROR: ${key} must be absolute in restored env file: ${value}" >&2
      exit 1
      ;;
  esac
}

validate_archive_members() {
  tar -tzf "$ARCHIVE" | node -e '
const readline = require("node:readline");

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (entry) => {
  const normalized = entry.replace(/^\.\/+/, "");
  const parts = normalized.split("/");
  if (
    entry.startsWith("/") ||
    normalized === ".." ||
    parts.includes("..")
  ) {
    console.error(`[restore] ERROR: backup archive contains unsafe path: ${entry}`);
    process.exitCode = 1;
    rl.close();
  }
});
'
}

verify_sqlite_db() {
  node - "$1" <<'NODE'
const Database = require("better-sqlite3");

const [dbPath] = process.argv.slice(2);
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.pragma("quick_check");
  const messages = rows
    .map((row) => row.quick_check)
    .filter((message) => message !== "ok");
  if (messages.length > 0) {
    console.error(`[restore] ERROR: hosted DB quick_check failed: ${messages.join("; ")}`);
    process.exit(1);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[restore] ERROR: hosted DB snapshot is not readable: ${message}`);
  process.exit(1);
} finally {
  db?.close();
}
NODE
}

verify_manifest() {
  local manifest="$staging/meta/manifest.sha256"
  if [ ! -f "$manifest" ]; then
    echo "[restore] ERROR: backup archive is missing meta/manifest.sha256" >&2
    exit 1
  fi

  (
    cd "$staging"
    sha256sum -c meta/manifest.sha256 >/dev/null
  ) || {
    echo "[restore] ERROR: backup archive manifest verification failed" >&2
    exit 1
  }
}

verify_pulse_heart() {
  node - "$1" "$2" <<'NODE'
const fs = require("node:fs");
const { loadSomaHeart } = require("soma-heart");

const [heartPath, secret] = process.argv.slice(2);
if (!secret) {
  console.error("[restore] ERROR: PULSE_HEART_SECRET must be set in restored env file");
  process.exit(1);
}

try {
  loadSomaHeart(fs.readFileSync(heartPath, "utf8"), secret);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[restore] ERROR: Pulse heart snapshot is not readable: ${message}`);
  process.exit(1);
}
NODE
}

install_file() {
  local mode="$1"
  local source="$2"
  local destination="$3"
  local owner="$4"
  local group="$5"

  mkdir -p "$(dirname "$destination")"
  if [ -n "$owner" ] || [ -n "$group" ]; then
    if [ -z "$owner" ] || [ -z "$group" ]; then
      echo "[restore] ERROR: set owner and group together, or leave both unset" >&2
      exit 1
    fi
    install -o "$owner" -g "$group" -m "$mode" "$source" "$destination"
  else
    install -m "$mode" "$source" "$destination"
  fi
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging="$(mktemp -d)"

cleanup() {
  rm -rf "$staging"
}
trap cleanup EXIT

validate_archive_members
tar -xzf "$ARCHIVE" -C "$staging"

restored_env="$staging/etc/pulse/pulse.env"
restored_db="$staging/state/hosted.db"
restored_heart="$staging/state/pulse-heart.json"
restored_tenants="$staging/state/tenants"

if [ ! -f "$restored_env" ]; then
  echo "[restore] ERROR: backup archive is missing etc/pulse/pulse.env" >&2
  exit 1
fi

if [ ! -f "$restored_db" ]; then
  echo "[restore] ERROR: backup archive is missing state/hosted.db" >&2
  exit 1
fi

if [ ! -f "$restored_heart" ]; then
  echo "[restore] ERROR: backup archive is missing state/pulse-heart.json" >&2
  exit 1
fi

verify_manifest

HOSTED_DB_PATH="$(read_env_value "$restored_env" HOSTED_DB_PATH)"
PULSE_HEART_PATH="$(read_env_value "$restored_env" PULSE_HEART_PATH)"
PULSE_HEART_SECRET="$(read_env_value "$restored_env" PULSE_HEART_SECRET)"

require_absolute_path HOSTED_DB_PATH "$HOSTED_DB_PATH"
require_absolute_path PULSE_HEART_PATH "$PULSE_HEART_PATH"
verify_sqlite_db "$restored_db"
verify_pulse_heart "$restored_heart" "$PULSE_HEART_SECRET"

if [ -e "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "${ENV_FILE}.restore-hold-${timestamp}"
fi
if [ -e "$HOSTED_DB_PATH" ]; then
  cp -a "$HOSTED_DB_PATH" "${HOSTED_DB_PATH}.restore-hold-${timestamp}"
fi
if [ -e "$PULSE_HEART_PATH" ]; then
  cp -a "$PULSE_HEART_PATH" "${PULSE_HEART_PATH}.restore-hold-${timestamp}"
fi
if [ -d "$DATA_DIR/tenants" ]; then
  mv "$DATA_DIR/tenants" "$DATA_DIR/tenants.restore-hold-${timestamp}"
fi

install_file 600 "$restored_env" "$ENV_FILE" "$ENV_INSTALL_OWNER" "$ENV_INSTALL_GROUP"
install_file 600 "$restored_db" "$HOSTED_DB_PATH" "$STATE_INSTALL_OWNER" "$STATE_INSTALL_GROUP"
install_file 600 "$restored_heart" "$PULSE_HEART_PATH" "$STATE_INSTALL_OWNER" "$STATE_INSTALL_GROUP"
verify_sqlite_db "$HOSTED_DB_PATH"
verify_pulse_heart "$PULSE_HEART_PATH" "$PULSE_HEART_SECRET"

if [ -d "$restored_tenants" ]; then
  mkdir -p "$DATA_DIR/tenants"
  cp -a "$restored_tenants/." "$DATA_DIR/tenants/"
fi

echo "[restore] restored env to ${ENV_FILE}"
echo "[restore] restored hosted DB to ${HOSTED_DB_PATH}"
echo "[restore] restored Pulse heart to ${PULSE_HEART_PATH}"
if [ -d "$restored_tenants" ]; then
  echo "[restore] restored tenants to ${DATA_DIR}/tenants"
fi
