import { describe, expect, it } from "vitest";

import { resolveAutopostApprovalMode } from "../../src/modes/autopost.js";

describe("autopost approval mode", () => {
  it("defaults to review_all so generated posts stay draft-first", () => {
    expect(resolveAutopostApprovalMode()).toBe("review_all");
    expect(resolveAutopostApprovalMode({ envMode: "unexpected" })).toBe(
      "review_all",
    );
  });

  it("keeps explicit config and environment overrides intentional", () => {
    expect(
      resolveAutopostApprovalMode({ configMode: "review_risky" }),
    ).toBe("review_risky");
    expect(
      resolveAutopostApprovalMode({
        configMode: "review_risky",
        envMode: "auto_all",
      }),
    ).toBe("auto_all");
  });
});
