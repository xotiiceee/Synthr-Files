import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const { getDataDir, saveState, setDataDir } = await import(
  "../../src/core/state.js"
);
const { generateDigest } = await import("../../src/core/daily-digest.js");

const originalDataDir = getDataDir();
const tempDirs = new Set<string>();

function createTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-daily-digest-"));
  tempDirs.add(dir);
  return dir;
}

beforeEach(() => {
  setDataDir(createTempDataDir());
});

afterEach(() => {
  setDataDir(originalDataDir);
});

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("daily digest", () => {
  it("counts handled mentions from mention state for the digest date", () => {
    saveState("autopost", { postHistory: [] });
    saveState("autopost-queue", []);
    saveState("mentions", {
      processedIds: [],
      dailyCounts: { "2026-05-25": 2 },
      pendingReplies: [
        {
          id: "mention_1",
          status: "replied",
          detectedAt: "2026-05-25T09:00:00.000Z",
          replyAfter: "2026-05-25T09:05:00.000Z",
        },
        {
          id: "mention_2",
          status: "replied",
          detectedAt: "2026-05-24T09:00:00.000Z",
          replyAfter: "2026-05-24T09:05:00.000Z",
        },
      ],
      lastCheckAt: "2026-05-25T10:00:00.000Z",
    });

    const digest = generateDigest("2026-05-25");

    expect(digest.mentionsHandled).toBe(2);
  });

  it("falls back to replied mention records when daily counts are missing", () => {
    saveState("autopost", { postHistory: [] });
    saveState("autopost-queue", []);
    saveState("mentions", {
      processedIds: [],
      dailyCounts: {},
      pendingReplies: [
        {
          id: "mention_1",
          status: "replied",
          detectedAt: "2026-05-25T09:00:00.000Z",
          replyAfter: "2026-05-25T09:05:00.000Z",
        },
        {
          id: "mention_2",
          status: "queued",
          detectedAt: "2026-05-25T11:00:00.000Z",
          replyAfter: "2026-05-25T11:05:00.000Z",
        },
      ],
      lastCheckAt: "2026-05-25T12:00:00.000Z",
    });

    const digest = generateDigest("2026-05-25");

    expect(digest.mentionsHandled).toBe(1);
  });
});
