import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

import Database from "better-sqlite3";
import { createSomaHeart } from "soma-heart";
import { getCryptoProvider } from "soma-heart/crypto-provider";
import { commitGenome, createGenome } from "soma-heart/core";
import { describe, expect, it } from "vitest";

const isWindows = process.platform === "win32";

const backupScript = fs.readFileSync(
  path.join(process.cwd(), "scripts", "backup-production.sh"),
  "utf-8",
);
const backupRunbook = fs.readFileSync(
  path.join(process.cwd(), "docs", "operations", "backup-restore.md"),
  "utf-8",
);
const sqliteBackupScript = fs.readFileSync(
  path.join(process.cwd(), "scripts", "backup-hosted-db.ts"),
  "utf-8",
);
const restoreScript = fs.readFileSync(
  path.join(process.cwd(), "scripts", "restore-production-backup.sh"),
  "utf-8",
);

describe("production backup posture", () => {
  it("backs up configured persistence paths instead of assuming repo data defaults", () => {
    expect(backupScript).toContain("read_env_value()");
    expect(backupScript).toContain("HOSTED_DB_PATH must be set");
    expect(backupScript).toContain("PULSE_HEART_PATH must be set");
    expect(backupScript).toContain("PULSE_HEART_SECRET must be set");
    expect(backupScript).toContain("HOSTED_DB_PATH must be absolute");
    expect(backupScript).toContain("PULSE_HEART_PATH must be absolute");
    expect(backupScript).toContain("Pulse heart file is not readable");
    expect(backupScript).toContain("scripts/backup-hosted-db.ts");
    expect(backupScript).toContain("cp \"$PULSE_HEART_PATH\"");
    expect(backupScript).toContain("meta/manifest.sha256");
    expect(backupScript).toContain("archive_tmp=");
    expect(backupScript).toContain("while [ -e \"$archive\" ]");
    expect(sqliteBackupScript).toContain("new Database(sourcePath");
    expect(sqliteBackupScript).toContain("db.backup(destinationPath)");
    expect(sqliteBackupScript).toContain('db.pragma("quick_check")');
    expect(backupScript).not.toContain("source \"$ENV_FILE\"");
    expect(backupScript).not.toContain("tar -czf \"$archive\" data");
    expect(restoreScript).toContain("PULSE_RESTORE_CONFIRM");
    expect(restoreScript).toContain("must be absolute in restored env file");
    expect(restoreScript).toContain("validate_archive_members");
    expect(restoreScript).toContain("backup archive contains unsafe path");
    expect(restoreScript).toContain('db.pragma("quick_check")');
    expect(restoreScript).toContain("verify_pulse_heart");
    expect(restoreScript).toContain("PULSE_HEART_SECRET must be set");
    expect(restoreScript).toContain("verify_manifest");
    expect(restoreScript).toContain("meta/manifest.sha256");
    expect(restoreScript).toContain("ENV_INSTALL_OWNER");
    expect(restoreScript).toContain("STATE_INSTALL_OWNER");
    expect(restoreScript).toContain("install_file 600 \"$restored_db\"");
  });

  it("rejects unreadable hosted DB snapshots before backup archive creation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-backup-"));
    try {
      const sourcePath = path.join(root, "corrupt-hosted.db");
      const destinationPath = path.join(root, "snapshot.db");
      fs.writeFileSync(sourcePath, "not sqlite");

      const cmd = process.platform === "win32"
        ? `npx.cmd tsx "scripts/backup-hosted-db.ts" "${sourcePath}" "${destinationPath}"`
        : `npx tsx "scripts/backup-hosted-db.ts" "${sourcePath}" "${destinationPath}"`;
      expect(() =>
        execSync(cmd, { cwd: process.cwd(), stdio: "pipe", encoding: "utf-8" }),
      ).toThrow(/file is not a database|database disk image is malformed|ENOENT|not found|EINVAL/);
      expect(fs.existsSync(destinationPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("documents the production backup command and configured-path restore", () => {
    expect(backupRunbook).toContain(
      "sudo env REPO_DIR=/home/deploy/pulse bash scripts/backup-production.sh",
    );
    expect(backupRunbook).toContain("npm run backup:production");
    expect(backupRunbook).toContain("requires absolute `HOSTED_DB_PATH` and");
    expect(backupRunbook).toContain("plus `PULSE_HEART_SECRET`");
    expect(backupRunbook).toContain("verifies the Pulse");
    expect(backupRunbook).toContain("heart before archiving");
    expect(backupRunbook).toContain("online backup API");
    expect(backupRunbook).toContain("quick_check` on the source and");
    expect(backupRunbook).toContain("snapshot");
    expect(backupRunbook).toContain("internal SHA-256 manifest");
    expect(backupRunbook).toContain("temporary file so the");
    expect(backupRunbook).toContain("final path is not partial");
    expect(backupRunbook).toContain("avoids overwriting a same-second backup");
    expect(backupRunbook).toContain(
      "runtime-state restore command is no longer required for launch",
    );
    expect(backupRunbook).toContain("instead of shell-sourcing production");
    expect(backupRunbook).toContain("secrets");
    expect(backupRunbook).toContain("restore-production-backup.sh");
    expect(backupRunbook).toContain("rejects unsafe archive member paths");
    expect(backupRunbook).toContain("verifies the");
    expect(backupRunbook).toContain("manifest");
    expect(backupRunbook).toContain("PULSE_RESTORE_CONFIRM=restore");
    expect(backupRunbook).toContain("STATE_INSTALL_OWNER=deploy");
    expect(backupRunbook).toContain("reads only");
    expect(backupRunbook).toContain("requires both paths to be absolute");
    expect(backupRunbook).toContain("SQLite `quick_check`");
    expect(backupRunbook).toContain("restored `PULSE_HEART_SECRET`");
    expect(backupRunbook).toContain("verifies the");
    expect(backupRunbook).toContain("installed DB and Pulse heart");
    expect(backupRunbook).toContain("remains root-owned");
  });
});

function createSerializedPulseHeart(secret: string): string {
  const provider = getCryptoProvider();
  const keyPair = provider.signing.generateKeyPair();
  const genome = createGenome(
    {
      modelProvider: "pulse",
      modelId: "operator",
      modelVersion: "1",
      systemPrompt: "Pulse operator heart",
      toolManifest: "{}",
      runtimeId: "pulse-operator",
    },
    provider,
  );
  const commitment = commitGenome(genome, keyPair, provider);
  const heart = createSomaHeart({
    genome: commitment,
    signingKeyPair: keyPair,
    modelApiKey: "n/a",
    modelBaseUrl: "https://api.anthropic.com/v1",
    modelId: "claude-sonnet-4-6",
    cryptoProvider: provider,
  });
  return heart.serialize(secret);
}
