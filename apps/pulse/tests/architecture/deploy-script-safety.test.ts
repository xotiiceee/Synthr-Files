import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const deployScript = fs.readFileSync(
  path.join(process.cwd(), "scripts", "deploy.sh"),
  "utf-8",
);
const gitignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf-8");

describe("deploy script safety", () => {
  it("does not allow branch switching from AUTO_SWITCH_BRANCH alone", () => {
    expect(deployScript).toContain(
      'ALLOW_DEPLOY_BRANCH_SWITCH="${ALLOW_DEPLOY_BRANCH_SWITCH:-0}"',
    );
    expect(deployScript).toContain('if [ "$AUTO_SWITCH_BRANCH" = "1" ]; then');
    expect(deployScript).toContain(
      'if [ "$ALLOW_DEPLOY_BRANCH_SWITCH" != "1" ]; then',
    );
    expect(deployScript).toContain(
      "branch switching is disabled for deploys",
    );
  });

  it("requires deploy target branches to be explicitly allowlisted", () => {
    expect(deployScript).toContain(
      'DEPLOY_BRANCH_ALLOWLIST="${DEPLOY_BRANCH_ALLOWLIST:-master main}"',
    );
    expect(deployScript).toContain(
      'ALLOW_UNLISTED_DEPLOY_BRANCH="${ALLOW_UNLISTED_DEPLOY_BRANCH:-0}"',
    );
    expect(deployScript).toContain("git check-ref-format --branch");
    expect(deployScript).toContain(
      "deploy target branch is not allowlisted",
    );
    expect(deployScript).toContain(
      "Set ALLOW_UNLISTED_DEPLOY_BRANCH=1 only for a reviewed manual deploy.",
    );
  });

  it("fails before restart when the production env file is missing", () => {
    expect(deployScript).toContain(
      'echo "[env] Ensuring external env file path is configured: ${ENV_FILE}"',
    );
    expect(deployScript).toContain('if [ ! -f "$ENV_FILE" ]; then');
    expect(deployScript).toContain(
      'echo "[env] ERROR: ${ENV_FILE} not found."',
    );
    expect(deployScript).toContain(
      "the systemd unit requires it",
    );
  });

  it("verifies the running deploy-info commit after restart", () => {
    expect(deployScript).toContain(
      'curl -sf "http://localhost:${PORT}/api/deploy-info"',
    );
    expect(deployScript).toContain("deploy.commit !== expectedCommit");
    expect(deployScript).toContain("deploy.branch !== expectedBranch");
    expect(deployScript).toContain(
      "/api/deploy-info reports spaReady=false",
    );
  });

  it("keeps generated deploy metadata out of the git working tree", () => {
    expect(deployScript).toContain(
      'DEPLOY_META_FILE="$REPO_DIR/hosted/deploy-meta.json"',
    );
    expect(gitignore).toContain("hosted/deploy-meta.json");
  });
});
