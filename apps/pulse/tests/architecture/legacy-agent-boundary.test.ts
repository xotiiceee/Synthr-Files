import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_DIRS = ["src", "hosted"];

const allowedLegacyAgentImports = new Set<string>();

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return walk(fullPath);
    }
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function sourceFiles(): Array<{ relativePath: string; content: string }> {
  return SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))).map(
    (file) => ({
      relativePath: path.relative(ROOT, file),
      content: fs.readFileSync(file, "utf-8"),
    }),
  );
}

describe("legacy agent boundary", () => {
  it("freezes direct runtime imports of the file-backed agent system", () => {
    const legacyImportPattern =
      /(?:from\s*['"][^'"]*(?:core\/agents|core\/agent-state)\.js['"]|import\(\s*['"][^'"]*(?:core\/agents|core\/agent-state)\.js['"]\s*\))/;

    const currentImports = sourceFiles()
      .filter(({ content }) => legacyImportPattern.test(content))
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(currentImports).toEqual([...allowedLegacyAgentImports].sort());
  });

  it("keeps public Pulse API routes out of the legacy brand-preset system", () => {
    const agentRoutes = fs.readFileSync(
      path.join(ROOT, "hosted", "agent-routes.ts"),
      "utf-8",
    );

    expect(agentRoutes).not.toMatch(/core\/agents\.js|core\/agent-state\.js/);
  });

  it("keeps hosted UI brand runtime calls on the standalone brands API", () => {
    const hostedUiCalls = sourceFiles()
      .filter(({ relativePath }) => relativePath.startsWith("hosted/ui/src/"))
      .map(({ relativePath, content }) => ({ relativePath, content }));

    const legacyAgentApiCalls = hostedUiCalls
      .filter(({ content }) => content.includes("/api/agents"))
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(legacyAgentApiCalls).toEqual([]);
  });

  it("keeps hosted runtime routes off the removed agents compatibility API", () => {
    const hostedServer = fs.readFileSync(
      path.join(ROOT, "hosted", "server.ts"),
      "utf-8",
    );

    expect(hostedServer).not.toMatch(/app\.(?:get|post)\(['"]\/api\/agents/);
  });
});
