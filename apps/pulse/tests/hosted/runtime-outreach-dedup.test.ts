import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-runtime-outreach-dedup");
process.env.HOSTED_DB_PATH = dbPath;

const { runInContext } = await import("../../hosted/context.js");
const { createRuntimeOutreachDedupRepository } =
  await import("../../hosted/repositories/runtime-outreach-dedup.js");
const { getDataDir, loadOutreachState, saveOutreachState, setDataDir } =
  await import("../../src/core/state.js");

const dedup = createRuntimeOutreachDedupRepository();
const originalDataDir = getDataDir();
const tempDirs = new Set<string>();

function createTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-outreach-dedup-"));
  tempDirs.add(dir);
  return dir;
}

function tenantContext(tenantId: string, dataDir: string) {
  return {
    tenantId,
    dataDir,
    configPath: path.join(dataDir, "pulse.yaml"),
    secrets: {},
  };
}

beforeEach(() => {
  setDataDir(createTempDataDir());
});

afterEach(() => {
  setDataDir(originalDataDir);
});

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  cleanupSqliteFiles(dbPath);
});

describe("runtime outreach dedup", () => {
  it("stores and lists replied ids by tenant, agent, and platform", () => {
    dedup.upsertRepliedIds({
      tenantId: "tn_outreach",
      agentId: "agent_1",
      platform: "x",
      postIds: ["post_1", "post_2", "post_1"],
      now: "2026-05-26T12:00:00.000Z",
    });

    expect(
      dedup.listRepliedIds({
        tenantId: "tn_outreach",
        agentId: "agent_1",
        platform: "x",
      }),
    ).toEqual(["post_1", "post_2"]);
    expect(
      dedup.listRepliedIds({
        tenantId: "tn_outreach",
        agentId: "agent_2",
        platform: "x",
      }),
    ).toEqual([]);
  });

  it("uses SQL replied ids for hosted outreach state while preserving JSON counters", async () => {
    const tenantAData = createTempDataDir();
    const tenantBData = createTempDataDir();

    await runInContext(
      tenantContext("tn_outreach_a", tenantAData),
      async () => {
        saveOutreachState({
          repliedIds: ["post_a"],
          dailyCounts: { "2026-05-26": 1 },
          lastRunAt: "2026-05-26T12:00:00.000Z",
          totalReplies: 1,
          totalSearches: 3,
        });
      },
    );
    await runInContext(
      tenantContext("tn_outreach_b", tenantBData),
      async () => {
        saveOutreachState({
          repliedIds: ["post_b"],
          dailyCounts: { "2026-05-26": 2 },
          lastRunAt: "2026-05-26T13:00:00.000Z",
          totalReplies: 2,
          totalSearches: 4,
        });
      },
    );

    await runInContext(
      tenantContext("tn_outreach_a", tenantAData),
      async () => {
        expect(loadOutreachState()).toMatchObject({
          repliedIds: ["post_a"],
          dailyCounts: { "2026-05-26": 1 },
          totalReplies: 1,
          totalSearches: 3,
        });
      },
    );
    await runInContext(
      tenantContext("tn_outreach_b", tenantBData),
      async () => {
        expect(loadOutreachState()).toMatchObject({
          repliedIds: ["post_b"],
          dailyCounts: { "2026-05-26": 2 },
          totalReplies: 2,
          totalSearches: 4,
        });
      },
    );
  });
});
