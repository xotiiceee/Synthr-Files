import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serviceFile = fs.readFileSync(
  path.join(process.cwd(), "scripts", "pulse-hosted.service"),
  "utf-8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("hosted service hardening", () => {
  it("keeps production secrets outside the repo checkout", () => {
    expect(serviceFile).toContain("User=deploy");
    expect(serviceFile).toContain("WorkingDirectory=/home/deploy/pulse");
    expect(serviceFile).toContain("EnvironmentFile=/etc/pulse/pulse.env");
    expect(serviceFile).not.toContain("/home/guardian/pulse/.env");
  });

  it("keeps the TypeScript runtime available after production installs", () => {
    expect(packageJson.dependencies).toHaveProperty("tsx");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("tsx");
  });
});
