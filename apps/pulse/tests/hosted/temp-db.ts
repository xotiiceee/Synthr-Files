import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTempHostedDbPath(prefix: string): string {
  return path.join(
    os.tmpdir(),
    `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
}

export function cleanupSqliteFiles(dbPath: string): void {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}
