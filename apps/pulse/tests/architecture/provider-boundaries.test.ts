import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIRS = ["src", "hosted"];

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return walk(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
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

describe("provider boundary guards", () => {
  it("keeps ClawNet X listening reads behind ListeningProvider", () => {
    const allowed = new Set([
      "src/core/listening.ts",
      "src/core/clawnet-client.ts",
    ]);
    const violations = sourceFiles()
      .filter(({ relativePath }) => !allowed.has(relativePath))
      .filter(({ content }) =>
        /import\s*\{[^}]*\b(searchTweets|getUserProfile)\b[^}]*\}\s*from\s*['"][^'"]*core\/clawnet-client\.js['"]/.test(
          content,
        ),
      )
      .map(({ relativePath }) => relativePath);

    expect(violations).toEqual([]);
  });

  it("keeps X write primitives behind XWriteClient", () => {
    const allowed = new Set([
      "src/platforms/x-write-client.ts",
      "src/platforms/x.ts",
    ]);
    const writeCall = /\bx\.(post|reply|like|follow|unfollow)\s*\(/;
    const directMediaImport =
      /import\s*\{[^}]*\b(uploadMedia|setMediaAltText)\b[^}]*\}\s*from\s*['"][^'"]*platforms\/x\.js['"]/;

    const violations = sourceFiles()
      .filter(({ relativePath }) => !allowed.has(relativePath))
      .filter(
        ({ content }) =>
          writeCall.test(content) || directMediaImport.test(content),
      )
      .map(({ relativePath }) => relativePath);

    expect(violations).toEqual([]);
  });

  it("keeps raw ClawNet credit deduction behind the billing provider", () => {
    const allowed = new Set(["hosted/auth.ts", "hosted/billing-provider.ts"]);
    const violations = sourceFiles()
      .filter(({ relativePath }) => !allowed.has(relativePath))
      .filter(({ content }) =>
        /import\s*\{[^}]*\bdeductPulseCredits\b[^}]*\}\s*from\s*['"][^'"]*auth\.js['"]/.test(
          content,
        ),
      )
      .map(({ relativePath }) => relativePath);

    expect(violations).toEqual([]);
  });
});
