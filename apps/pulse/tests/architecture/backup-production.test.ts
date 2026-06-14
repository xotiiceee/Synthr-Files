import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3";
import { createSomaHeart } from "soma-heart";
import { getCryptoProvider } from "soma-heart/crypto-provider";
import { commitGenome, createGenome } from "soma-heart/core";
import { describe, expect, it } from "vitest";

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

  it("runs against a systemd-style env file without shell-sourcing every secret", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-backup-"));
    try {
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const backupDir = path.join(root, "backups");
      const envFile = path.join(root, "pulse.env");
      const heartSecret = "backup_heart_secret_".padEnd(32, "x");

      const db = new Database(dbPath);
      db.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('ok');");
      db.close();
      fs.writeFileSync(heartPath, createSerializedPulseHeart(heartSecret));
      fs.writeFileSync(
        envFile,
        [
          `HOSTED_DB_PATH=${dbPath}`,
          `PULSE_HEART_PATH="${heartPath}"`,
          `PULSE_HEART_SECRET=${heartSecret}`,
          "RESEND_FROM=Pulse <notifications@example.com>",
        ].join("\n"),
      );

      execFileSync("bash", ["scripts/backup-production.sh"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ENV_FILE: envFile,
          BACKUP_DIR: backupDir,
          REPO_DIR: process.cwd(),
          DEPLOY_INFO_URL: "http://127.0.0.1:9/deploy-info",
        },
        stdio: "pipe",
      });

      const archives = fs.readdirSync(backupDir).filter((file) =>
        file.endsWith(".tgz"),
      );
      expect(archives).toHaveLength(1);
      expect(
        fs.readdirSync(backupDir).filter((file) => file.startsWith(".pulse-")),
      ).toEqual([]);
      expect(
        execFileSync("tar", ["-tzf", path.join(backupDir, archives[0] ?? "")], {
          encoding: "utf-8",
        }),
      ).toContain("./meta/manifest.sha256");

      fs.writeFileSync(heartPath, JSON.stringify({ id: "mutated-heart" }));
      const mutatedDb = new Database(dbPath);
      mutatedDb.exec("DELETE FROM marker; INSERT INTO marker VALUES ('mutated');");
      mutatedDb.close();

      execFileSync(
        "bash",
        [
          "scripts/restore-production-backup.sh",
          path.join(backupDir, archives[0] ?? ""),
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: envFile,
            DATA_DIR: path.join(root, "data"),
          },
          stdio: "pipe",
        },
      );

      const restoredDb = new Database(dbPath, { readonly: true });
      const restoredMarker = restoredDb
        .prepare("SELECT value FROM marker")
        .pluck()
        .get();
      restoredDb.close();
      expect(restoredMarker).toBe("ok");
      expect(fs.readFileSync(heartPath, "utf-8")).toContain('"v":1');
      expect(
        fs.readdirSync(root).some((file) => file.includes(".restore-hold-")),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects relative configured persistence paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-backup-"));
    try {
      const backupDir = path.join(root, "backups");
      const envFile = path.join(root, "pulse.env");
      fs.writeFileSync(
        envFile,
        [
          "HOSTED_DB_PATH=data/hosted.db",
          `PULSE_HEART_PATH=${path.join(root, "pulse-heart.json")}`,
          `PULSE_HEART_SECRET=${"relative_heart_secret_".padEnd(32, "x")}`,
        ].join("\n"),
      );

      expect(() =>
        execFileSync("bash", ["scripts/backup-production.sh"], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ENV_FILE: envFile,
            BACKUP_DIR: backupDir,
            REPO_DIR: process.cwd(),
            DEPLOY_INFO_URL: "http://127.0.0.1:9/deploy-info",
          },
          stdio: "pipe",
        }),
      ).toThrow(/HOSTED_DB_PATH must be absolute/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing same-second backup archive", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-backup-"));
    try {
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const backupDir = path.join(root, "backups");
      const envFile = path.join(root, "pulse.env");
      const heartSecret = "backup_heart_secret_".padEnd(32, "x");

      const db = new Database(dbPath);
      db.exec("CREATE TABLE marker (value TEXT)");
      db.close();
      fs.writeFileSync(heartPath, createSerializedPulseHeart(heartSecret));
      fs.writeFileSync(
        envFile,
        [
          `HOSTED_DB_PATH=${dbPath}`,
          `PULSE_HEART_PATH=${heartPath}`,
          `PULSE_HEART_SECRET=${heartSecret}`,
        ].join("\n"),
      );
      fs.mkdirSync(backupDir);

      const fixedDate = path.join(root, "date");
      fs.writeFileSync(
        fixedDate,
        "#!/usr/bin/env bash\nprintf '20260527T000000Z\\n'\n",
        { mode: 0o755 },
      );
      fs.writeFileSync(path.join(backupDir, "pulse-20260527T000000Z.tgz"), "existing");

      execFileSync("bash", ["scripts/backup-production.sh"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ENV_FILE: envFile,
          BACKUP_DIR: backupDir,
          REPO_DIR: process.cwd(),
          DEPLOY_INFO_URL: "http://127.0.0.1:9/deploy-info",
          PATH: `${root}:${process.env.PATH}`,
        },
        stdio: "pipe",
      });

      expect(fs.readFileSync(
        path.join(backupDir, "pulse-20260527T000000Z.tgz"),
        "utf-8",
      )).toBe("existing");
      expect(fs.existsSync(
        path.join(backupDir, "pulse-20260527T000000Z-1.tgz"),
      )).toBe(true);
      expect(
        fs.readdirSync(backupDir).filter((file) => file.startsWith(".pulse-")),
      ).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unreadable Pulse heart files before backup", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-backup-"));
    try {
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const backupDir = path.join(root, "backups");
      const envFile = path.join(root, "pulse.env");

      const db = new Database(dbPath);
      db.exec("CREATE TABLE marker (value TEXT)");
      db.close();
      fs.writeFileSync(heartPath, "{}");
      fs.writeFileSync(
        envFile,
        [
          `HOSTED_DB_PATH=${dbPath}`,
          `PULSE_HEART_PATH=${heartPath}`,
          `PULSE_HEART_SECRET=${"bad_backup_heart_secret_".padEnd(32, "x")}`,
        ].join("\n"),
      );

      expect(() =>
        execFileSync("bash", ["scripts/backup-production.sh"], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ENV_FILE: envFile,
            BACKUP_DIR: backupDir,
            REPO_DIR: process.cwd(),
            DEPLOY_INFO_URL: "http://127.0.0.1:9/deploy-info",
          },
          stdio: "pipe",
        }),
      ).toThrow(/Pulse heart file is not readable/);
      expect(fs.existsSync(backupDir)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unreadable hosted DB snapshots before backup archive creation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-backup-"));
    try {
      const sourcePath = path.join(root, "corrupt-hosted.db");
      const destinationPath = path.join(root, "snapshot.db");
      fs.writeFileSync(sourcePath, "not sqlite");

      expect(() =>
        execFileSync(
          "npx",
          ["tsx", "scripts/backup-hosted-db.ts", sourcePath, destinationPath],
          {
            cwd: process.cwd(),
            stdio: "pipe",
          },
        ),
      ).toThrow(/file is not a database|database disk image is malformed/);
      expect(fs.existsSync(destinationPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses restore archives with relative persistence paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
    try {
      const archive = path.join(root, "pulse-relative.tgz");
      const staging = path.join(root, "staging");
      fs.mkdirSync(path.join(staging, "etc", "pulse"), { recursive: true });
      fs.mkdirSync(path.join(staging, "state"), { recursive: true });
      fs.writeFileSync(
        path.join(staging, "etc", "pulse", "pulse.env"),
        [
          "HOSTED_DB_PATH=data/hosted.db",
          `PULSE_HEART_PATH=${path.join(root, "pulse-heart.json")}`,
        ].join("\n"),
      );
      fs.writeFileSync(path.join(staging, "state", "hosted.db"), "");
      fs.writeFileSync(path.join(staging, "state", "pulse-heart.json"), "{}");
      writeArchiveWithManifest(staging, archive);

      expect(() =>
        execFileSync("bash", ["scripts/restore-production-backup.sh", archive], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: path.join(root, "pulse.env"),
            DATA_DIR: path.join(root, "data"),
          },
          stdio: "pipe",
        }),
      ).toThrow(/HOSTED_DB_PATH must be absolute/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses restore archives with unreadable hosted DB snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
    try {
      const archive = path.join(root, "pulse-corrupt-db.tgz");
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const staging = path.join(root, "staging");
      fs.mkdirSync(path.join(staging, "etc", "pulse"), { recursive: true });
      fs.mkdirSync(path.join(staging, "state"), { recursive: true });
      fs.writeFileSync(
        path.join(staging, "etc", "pulse", "pulse.env"),
        [`HOSTED_DB_PATH=${dbPath}`, `PULSE_HEART_PATH=${heartPath}`].join(
          "\n",
        ),
      );
      fs.writeFileSync(path.join(staging, "state", "hosted.db"), "not sqlite");
      fs.writeFileSync(path.join(staging, "state", "pulse-heart.json"), "{}");
      writeArchiveWithManifest(staging, archive);

      expect(() =>
        execFileSync("bash", ["scripts/restore-production-backup.sh", archive], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: path.join(root, "pulse.env"),
            DATA_DIR: path.join(root, "data"),
          },
          stdio: "pipe",
        }),
      ).toThrow(/hosted DB snapshot is not readable|hosted DB quick_check failed/);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(heartPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses restore archives with unreadable Pulse heart snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
    try {
      const archive = path.join(root, "pulse-corrupt-heart.tgz");
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const heartSecret = "restore_heart_secret_".padEnd(32, "x");
      const staging = path.join(root, "staging");
      fs.mkdirSync(path.join(staging, "etc", "pulse"), { recursive: true });
      fs.mkdirSync(path.join(staging, "state"), { recursive: true });
      fs.writeFileSync(
        path.join(staging, "etc", "pulse", "pulse.env"),
        [
          `HOSTED_DB_PATH=${dbPath}`,
          `PULSE_HEART_PATH=${heartPath}`,
          `PULSE_HEART_SECRET=${heartSecret}`,
        ].join("\n"),
      );
      const db = new Database(path.join(staging, "state", "hosted.db"));
      db.exec("CREATE TABLE marker (value TEXT)");
      db.close();
      fs.writeFileSync(path.join(staging, "state", "pulse-heart.json"), "{}");
      writeArchiveWithManifest(staging, archive);

      expect(() =>
        execFileSync("bash", ["scripts/restore-production-backup.sh", archive], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: path.join(root, "pulse.env"),
            DATA_DIR: path.join(root, "data"),
          },
          stdio: "pipe",
        }),
      ).toThrow(/Pulse heart snapshot is not readable/);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(heartPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies restored state after installing final paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
    try {
      const archive = path.join(root, "pulse-post-install.tgz");
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const heartSecret = "restore_heart_secret_".padEnd(32, "x");
      const staging = path.join(root, "staging");
      fs.mkdirSync(path.join(staging, "etc", "pulse"), { recursive: true });
      fs.mkdirSync(path.join(staging, "state"), { recursive: true });
      fs.writeFileSync(
        path.join(staging, "etc", "pulse", "pulse.env"),
        [
          `HOSTED_DB_PATH=${dbPath}`,
          `PULSE_HEART_PATH=${heartPath}`,
          `PULSE_HEART_SECRET=${heartSecret}`,
        ].join("\n"),
      );
      const db = new Database(path.join(staging, "state", "hosted.db"));
      db.exec("CREATE TABLE marker (value TEXT)");
      db.close();
      fs.writeFileSync(
        path.join(staging, "state", "pulse-heart.json"),
        createSerializedPulseHeart(heartSecret),
      );
      writeArchiveWithManifest(staging, archive);

      const fakeInstall = path.join(root, "install");
      fs.writeFileSync(
        fakeInstall,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          "/usr/bin/install \"$@\"",
          "destination=\"${@: -1}\"",
          "if [[ \"$destination\" == *pulse-heart.json ]]; then",
          "  printf '{}' > \"$destination\"",
          "fi",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );

      expect(() =>
        execFileSync("bash", ["scripts/restore-production-backup.sh", archive], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: path.join(root, "pulse.env"),
            DATA_DIR: path.join(root, "data"),
            PATH: `${root}:${process.env.PATH}`,
          },
          stdio: "pipe",
        }),
      ).toThrow(/Pulse heart snapshot is not readable/);
      expect(fs.readFileSync(heartPath, "utf-8")).toBe("{}");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses restore archives with unsafe member paths before extraction", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
    try {
      const archive = path.join(root, "pulse-unsafe.tgz");
      const marker = path.join(root, "evil");
      fs.writeFileSync(marker, "outside");
      execFileSync(
        "tar",
        [
          "-czf",
          archive,
          "-C",
          root,
          "--transform=s#^evil$#../evil#",
          "evil",
        ],
        { stdio: "pipe" },
      );

      expect(execFileSync("tar", ["-tzf", archive], { encoding: "utf-8" }))
        .toContain("../evil");
      expect(() =>
        execFileSync("bash", ["scripts/restore-production-backup.sh", archive], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: path.join(root, "pulse.env"),
            DATA_DIR: path.join(root, "data"),
          },
          stdio: "pipe",
        }),
      ).toThrow(/backup archive contains unsafe path/);
      expect(fs.existsSync(path.join(path.dirname(root), "evil"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses restore archives without the internal manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
    try {
      const archive = path.join(root, "pulse-no-manifest.tgz");
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const heartSecret = "restore_heart_secret_".padEnd(32, "x");
      const staging = path.join(root, "staging");
      fs.mkdirSync(path.join(staging, "etc", "pulse"), { recursive: true });
      fs.mkdirSync(path.join(staging, "state"), { recursive: true });
      fs.writeFileSync(
        path.join(staging, "etc", "pulse", "pulse.env"),
        [
          `HOSTED_DB_PATH=${dbPath}`,
          `PULSE_HEART_PATH=${heartPath}`,
          `PULSE_HEART_SECRET=${heartSecret}`,
        ].join("\n"),
      );
      const db = new Database(path.join(staging, "state", "hosted.db"));
      db.exec("CREATE TABLE marker (value TEXT)");
      db.close();
      fs.writeFileSync(
        path.join(staging, "state", "pulse-heart.json"),
        createSerializedPulseHeart(heartSecret),
      );
      execFileSync("tar", ["-czf", archive, "."], {
        cwd: staging,
        stdio: "pipe",
      });

      expect(() =>
        execFileSync("bash", ["scripts/restore-production-backup.sh", archive], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: path.join(root, "pulse.env"),
            DATA_DIR: path.join(root, "data"),
          },
          stdio: "pipe",
        }),
      ).toThrow(/missing meta\/manifest\.sha256/);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(heartPath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses restore archives whose manifest no longer matches state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
    try {
      const archive = path.join(root, "pulse-tampered-manifest.tgz");
      const dbPath = path.join(root, "hosted.db");
      const heartPath = path.join(root, "pulse-heart.json");
      const heartSecret = "restore_heart_secret_".padEnd(32, "x");
      const staging = path.join(root, "staging");
      fs.mkdirSync(path.join(staging, "etc", "pulse"), { recursive: true });
      fs.mkdirSync(path.join(staging, "state"), { recursive: true });
      fs.writeFileSync(
        path.join(staging, "etc", "pulse", "pulse.env"),
        [
          `HOSTED_DB_PATH=${dbPath}`,
          `PULSE_HEART_PATH=${heartPath}`,
          `PULSE_HEART_SECRET=${heartSecret}`,
        ].join("\n"),
      );
      const db = new Database(path.join(staging, "state", "hosted.db"));
      db.exec("CREATE TABLE marker (value TEXT)");
      db.close();
      fs.writeFileSync(
        path.join(staging, "state", "pulse-heart.json"),
        createSerializedPulseHeart(heartSecret),
      );
      writeManifest(staging);
      fs.writeFileSync(path.join(staging, "state", "pulse-heart.json"), "{}");
      execFileSync("tar", ["-czf", archive, "."], {
        cwd: staging,
        stdio: "pipe",
      });

      expect(() =>
        execFileSync("bash", ["scripts/restore-production-backup.sh", archive], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PULSE_RESTORE_CONFIRM: "restore",
            ENV_FILE: path.join(root, "pulse.env"),
            DATA_DIR: path.join(root, "data"),
          },
          stdio: "pipe",
        }),
      ).toThrow(/backup archive manifest verification failed/);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(heartPath)).toBe(false);
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
    expect(backupRunbook).toContain("verifies the Pulse\nheart before archiving");
    expect(backupRunbook).toContain("online backup API");
    expect(backupRunbook).toContain("quick_check` on the source and\nsnapshot");
    expect(backupRunbook).toContain("internal SHA-256 manifest");
    expect(backupRunbook).toContain("temporary file so the\nfinal path is not partial");
    expect(backupRunbook).toContain("avoids overwriting a same-second backup");
    expect(backupRunbook).toContain(
      "runtime-state restore command is no longer required for launch",
    );
    expect(backupRunbook).toContain("instead of shell-sourcing production\nsecrets");
    expect(backupRunbook).toContain("restore-production-backup.sh");
    expect(backupRunbook).toContain("rejects unsafe archive member paths");
    expect(backupRunbook).toContain("verifies the\n   manifest");
    expect(backupRunbook).toContain("PULSE_RESTORE_CONFIRM=restore");
    expect(backupRunbook).toContain("STATE_INSTALL_OWNER=deploy");
    expect(backupRunbook).toContain("reads only");
    expect(backupRunbook).toContain("requires both paths to be absolute");
    expect(backupRunbook).toContain("SQLite `quick_check`");
    expect(backupRunbook).toContain("restored `PULSE_HEART_SECRET`");
    expect(backupRunbook).toContain("verifies the\n   installed DB and Pulse heart");
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

function writeArchiveWithManifest(staging: string, archive: string): void {
  writeManifest(staging);
  execFileSync("tar", ["-czf", archive, "."], {
    cwd: staging,
    stdio: "pipe",
  });
}

function writeManifest(staging: string): void {
  fs.mkdirSync(path.join(staging, "meta"), { recursive: true });
  const manifest = execFileSync(
    "sha256sum",
    ["etc/pulse/pulse.env", "state/hosted.db", "state/pulse-heart.json"],
    {
      cwd: staging,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  fs.writeFileSync(path.join(staging, "meta", "manifest.sha256"), manifest);
}
