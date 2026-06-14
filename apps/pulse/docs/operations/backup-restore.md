# Pulse Backup And Restore

Status: active runbook

Use this before schema migrations, scheduler cutovers, billing cutovers, or
domain launch.

## What To Back Up

- `/etc/pulse/pulse.env`
- a consistent SQLite snapshot of the configured `HOSTED_DB_PATH`
- `data/tenants/`
- the configured `PULSE_HEART_PATH`
- the deployed Git commit SHA from `/api/deploy-info`

Do not store production backups in the repo checkout.

Parity note: hosted `brand_profiles`, `brand_knowledge_notes`, runtime
approval/content queues, action logs, schedule state, outreach dedup, X rate
counters, and X write operation receipts are included in structured privacy
export and round-trip through the `HOSTED_DB_PATH` backup/restore.
Brand-memory privacy export payloads also have a backend `/api/profile/import`
restore path for matching hosted brand rows. A dedicated structured
runtime-state restore command is no longer required for launch because the
hosted DB backup is the authoritative full-state restore path and privacy import
handles scrubbed brand-memory/runtime-row drills.

## Backup Command

Run from the repo checkout on the production host:

```bash
sudo env REPO_DIR=/home/deploy/pulse bash scripts/backup-production.sh
```

The script reads `/etc/pulse/pulse.env`, requires absolute `HOSTED_DB_PATH` and
`PULSE_HEART_PATH` file paths plus `PULSE_HEART_SECRET`, verifies the Pulse
heart before archiving it, creates a consistent hosted DB snapshot through
SQLite's online backup API, runs SQLite `quick_check` on the source and
snapshot, writes an internal SHA-256 manifest for the env, DB snapshot, and
Pulse heart, copies `data/tenants/` when present, captures deploy metadata,
writes the archive under `/var/backups/pulse` through a temporary file so the
final path is not partial, avoids overwriting a same-second backup, locks it to
mode `600`, and prints its SHA-256 digest. It reads only the required path keys
and Pulse heart secret from the env file instead of shell-sourcing production
secrets.
`npm run backup:production` runs the same script when the current user can read
the env file and write the backup directory.

Then record the deploy state if the script could not reach it automatically:

```bash
curl -s http://localhost:3457/api/deploy-info
```

## Restore Procedure

1. Stop the service:

   ```bash
   sudo systemctl stop pulse-hosted
   ```

2. Move the current state aside:

   ```bash
   ts=$(date -u +%Y%m%dT%H%M%SZ)
   mv data "data.restore-hold-${ts}"
   sudo cp /etc/pulse/pulse.env "/etc/pulse/pulse.env.restore-hold-${ts}"
   ```

3. Restore the chosen backup:

   ```bash
   sudo env \
     PULSE_RESTORE_CONFIRM=restore \
     STATE_INSTALL_OWNER=deploy \
     STATE_INSTALL_GROUP=deploy \
     DATA_DIR=/home/deploy/pulse/data \
     bash scripts/restore-production-backup.sh /var/backups/pulse/pulse-YYYYMMDDTHHMMSSZ.tgz
   ```

   `npm run restore:production -- /path/to/pulse-YYYYMMDDTHHMMSSZ.tgz` runs the
   same script when the current user owns the target env and state paths. The
   restore script rejects unsafe archive member paths, extracts to a temporary
   directory, validates that the archive includes the env file, hosted DB
   snapshot, Pulse heart file, and internal SHA-256 manifest, verifies the
   manifest, reads only `HOSTED_DB_PATH` and `PULSE_HEART_PATH` from the
   restored env, requires both paths to be absolute, opens the DB snapshot and
   runs SQLite `quick_check`, verifies the archived Pulse heart with the
   restored `PULSE_HEART_SECRET`, writes mode-`600` files, verifies the
   installed DB and Pulse heart at their final paths, and keeps `.restore-hold-*`
   copies of overwritten env/state files. In the sudo form above,
   `/etc/pulse/pulse.env` remains root-owned while restored state files are
   installed for the `deploy` service user.

4. Start and verify:

   ```bash
   sudo systemctl start pulse-hosted
   systemctl status pulse-hosted --no-pager
   curl -fsS http://localhost:3457/health
   curl -fsS http://localhost:3457/api/deploy-info
   ```

## Rollback Rules

- Keep `AUTH_PROVIDER=clawnet` until first-party auth cutover is explicitly
  approved.
- Keep `BILLING_PROVIDER=clawnet` until Stripe reconciliation and customer
  billing are proven.
- Keep `SCHEDULER_MODE=legacy` unless durable scheduler mode is being tested.
- Take a backup before enabling any production cutover flag.
- If a cutover fails, restore the previous env file first. Restore data only if
  the failed migration mutated persistent state.
- Hosted privacy exports can be re-imported through `/api/profile/import` for
  matching hosted brand rows. This restores brand-memory rows plus runtime
  action logs, approval queue, content queue, schedule state, outreach dedup,
  and X rate counters. X write operation receipts are export-only audit
  evidence; use full DB backups for receipt history and secrets.

## Restore Test Cadence

Before customer launch, test restore on a non-production host using a scrubbed
backup and verify:

- hosted DB opens cleanly
- tenant config files are readable
- `/health` responds
- `/api/deploy-info` shows the expected commit
- a scrubbed hosted privacy export can be imported through `/api/profile/import`
  and restores brand-memory plus runtime SQL rows for a mapped test brand
- no production webhooks or X write credentials are active in the restore test
