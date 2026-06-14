#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
REPO_DIR="${REPO_DIR:-/home/${DEPLOY_USER}/pulse}"
SERVICE_NAME="${SERVICE_NAME:-pulse-hosted}"
PORT="${PORT:-3457}"
MAX_WAIT="${MAX_WAIT:-15}"
ENV_FILE="${ENV_FILE:-/etc/pulse/pulse.env}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"
AUTO_SWITCH_BRANCH="${AUTO_SWITCH_BRANCH:-0}"
ALLOW_DEPLOY_BRANCH_SWITCH="${ALLOW_DEPLOY_BRANCH_SWITCH:-0}"
DEPLOY_BRANCH_ALLOWLIST="${DEPLOY_BRANCH_ALLOWLIST:-master main}"
ALLOW_UNLISTED_DEPLOY_BRANCH="${ALLOW_UNLISTED_DEPLOY_BRANCH:-0}"

cd "$REPO_DIR"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  echo "[git] ERROR: repo is in detached HEAD state."
  echo "      Check out the branch you want to deploy before running this script."
  exit 1
fi

TARGET_BRANCH="${GIT_BRANCH:-$CURRENT_BRANCH}"

if ! git check-ref-format --branch "$TARGET_BRANCH" >/dev/null 2>&1; then
  echo "[git] ERROR: invalid deploy branch name: ${TARGET_BRANCH}"
  exit 1
fi

if [ "$ALLOW_UNLISTED_DEPLOY_BRANCH" != "1" ]; then
  branch_allowed=false
  for allowed_branch in $DEPLOY_BRANCH_ALLOWLIST; do
    if [ "$TARGET_BRANCH" = "$allowed_branch" ]; then
      branch_allowed=true
      break
    fi
  done
  if [ "$branch_allowed" != "true" ]; then
    echo "[git] ERROR: deploy target branch is not allowlisted: ${TARGET_BRANCH}"
    echo "      Allowed branches: ${DEPLOY_BRANCH_ALLOWLIST}"
    echo "      Set ALLOW_UNLISTED_DEPLOY_BRANCH=1 only for a reviewed manual deploy."
    exit 1
  fi
fi

if [ "$ALLOW_DIRTY" != "1" ] && [ -n "$(git status --porcelain)" ]; then
  echo "[git] ERROR: working tree is dirty."
  echo "      Commit/stash changes before deploy, or re-run with ALLOW_DIRTY=1 if you really intend to deploy local edits."
  git status --short
  exit 1
fi

if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
  if [ "$AUTO_SWITCH_BRANCH" = "1" ]; then
    if [ "$ALLOW_DEPLOY_BRANCH_SWITCH" != "1" ]; then
      echo "[git] ERROR: branch switching is disabled for deploys."
      echo "      Checked out branch: ${CURRENT_BRANCH}"
      echo "      Requested branch: ${TARGET_BRANCH}"
      echo "      Check out the intended branch first, or set ALLOW_DEPLOY_BRANCH_SWITCH=1 for a reviewed manual deploy."
      exit 1
    fi
    echo "[git] Switching from ${CURRENT_BRANCH} to ${TARGET_BRANCH}..."
    git fetch origin "$TARGET_BRANCH"
    git checkout "$TARGET_BRANCH"
    CURRENT_BRANCH="$TARGET_BRANCH"
  else
    echo "[git] ERROR: checked out branch is ${CURRENT_BRANCH}, but deploy target is ${TARGET_BRANCH}."
    echo "      Check out ${TARGET_BRANCH} first."
    exit 1
  fi
fi

echo "[git] Fetching and fast-forwarding ${TARGET_BRANCH}..."
git fetch origin "$TARGET_BRANCH"
git pull --ff-only origin "$TARGET_BRANCH"

DEPLOY_COMMIT="$(git rev-parse HEAD)"
DEPLOY_COMMIT_SHORT="$(git rev-parse --short HEAD)"
DEPLOY_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[git] Deploying ${TARGET_BRANCH} @ ${DEPLOY_COMMIT_SHORT}"

echo "[deps] Installing server dependencies..."
npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent 2>/dev/null || npm install --silent

echo "[ui] Building React SPA..."
cd "$REPO_DIR/hosted/ui"
npm ci --silent 2>/dev/null || npm install --silent
npm run build
echo "[ui] Build complete."
cd "$REPO_DIR"

UI_BUNDLE="$(find "$REPO_DIR/hosted/ui/dist/assets" -maxdepth 1 -type f -name 'index-*.js' | head -n 1 | xargs -r basename)"
DEPLOY_META_FILE="$REPO_DIR/hosted/deploy-meta.json"
cat > "$DEPLOY_META_FILE" <<EOF
{
  "service": "${SERVICE_NAME}",
  "branch": "${TARGET_BRANCH}",
  "commit": "${DEPLOY_COMMIT}",
  "commitShort": "${DEPLOY_COMMIT_SHORT}",
  "deployedAt": "${DEPLOY_TIMESTAMP}",
  "uiBundle": "${UI_BUNDLE}"
}
EOF
echo "[meta] Wrote deploy metadata to ${DEPLOY_META_FILE}"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
if [ ! -f "$SERVICE_FILE" ] || ! diff -q "$REPO_DIR/scripts/${SERVICE_NAME}.service" "$SERVICE_FILE" >/dev/null 2>&1; then
  echo "[systemd] Installing/updating service file..."
  sudo cp "$REPO_DIR/scripts/${SERVICE_NAME}.service" "$SERVICE_FILE"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
fi

echo "[env] Ensuring external env file path is configured: ${ENV_FILE}"
if [ ! -f "$ENV_FILE" ]; then
  echo "[env] ERROR: ${ENV_FILE} not found."
  echo "      Create the production env file before deploying; the systemd unit requires it."
  exit 1
fi

if command -v screen >/dev/null 2>&1 && screen -list 2>/dev/null | grep -q "$SERVICE_NAME"; then
  echo "[migrate] Stopping legacy screen session..."
  screen -S "$SERVICE_NAME" -X quit 2>/dev/null || true
  sleep 2
fi

echo "[restart] Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"

echo -n "[health] Waiting for startup"
HEALTHY=false
for i in $(seq 1 "$MAX_WAIT"); do
  sleep 1
  echo -n "."
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "[fail] Process crashed on startup. Last 30 lines:"
    journalctl -u "$SERVICE_NAME" --no-pager -n 30
    echo ""
    echo "[fail] Deploy failed. Fix the error and re-deploy."
    exit 1
  fi
done
echo ""

if $HEALTHY; then
  DEPLOY_INFO_FILE="$(mktemp)"
  cleanup_deploy_info() {
    rm -f "$DEPLOY_INFO_FILE"
  }
  trap cleanup_deploy_info EXIT
  if ! curl -sf "http://localhost:${PORT}/api/deploy-info" > "$DEPLOY_INFO_FILE"; then
    echo "[fail] Could not fetch /api/deploy-info after restart."
    exit 1
  fi

  if ! node - "$DEPLOY_INFO_FILE" "$DEPLOY_COMMIT" "$TARGET_BRANCH" <<'NODE'
const fs = require('node:fs');
const [file, expectedCommit, expectedBranch] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(file, 'utf8'));
const deploy = info.deploy || {};
if (deploy.commit !== expectedCommit || deploy.branch !== expectedBranch) {
  console.error(
    `[fail] /api/deploy-info mismatch. Expected ${expectedBranch}@${expectedCommit}, got ${deploy.branch || 'unknown'}@${deploy.commit || 'unknown'}`,
  );
  process.exit(1);
}
if (info.spaReady === false) {
  console.error('[fail] /api/deploy-info reports spaReady=false.');
  process.exit(1);
}
NODE
  then
    exit 1
  fi
  cleanup_deploy_info
  trap - EXIT
  echo "[verify] /api/deploy-info reports ${TARGET_BRANCH} @ ${DEPLOY_COMMIT_SHORT}"
  echo "[done] Pulse deployed successfully - healthy on port ${PORT}"
  echo "       Commit: ${DEPLOY_COMMIT_SHORT} (${TARGET_BRANCH})"
  echo "       UI bundle: ${UI_BUNDLE:-unknown}"
  echo "       View logs: journalctl -u ${SERVICE_NAME} -f"
else
  echo "[fail] Health check failed after ${MAX_WAIT}s. Last 30 lines:"
  journalctl -u "$SERVICE_NAME" --no-pager -n 30
  echo ""
  echo "Check full logs: journalctl -u ${SERVICE_NAME} -f"
  exit 1
fi
