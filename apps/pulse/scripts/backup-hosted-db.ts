import Database from "better-sqlite3";

const [sourcePath, destinationPath] = process.argv.slice(2);

if (!sourcePath || !destinationPath) {
  console.error("Usage: tsx scripts/backup-hosted-db.ts <source> <destination>");
  process.exit(1);
}

const db = new Database(sourcePath, { readonly: true, fileMustExist: true });

try {
  verifyQuickCheck(db, "source");
  await db.backup(destinationPath);
  const snapshot = new Database(destinationPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    verifyQuickCheck(snapshot, "snapshot");
  } finally {
    snapshot.close();
  }
} finally {
  db.close();
}

function verifyQuickCheck(db: Database.Database, label: string): void {
  const rows = db.pragma("quick_check") as Array<{ quick_check: string }>;
  const messages = rows
    .map((row) => row.quick_check)
    .filter((message) => message !== "ok");

  if (messages.length > 0) {
    throw new Error(
      `Hosted DB ${label} failed SQLite quick_check: ${messages.join("; ")}`,
    );
  }
}
