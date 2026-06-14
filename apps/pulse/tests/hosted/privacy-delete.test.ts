import { describe, expect, it } from "vitest";

import { cleanupSqliteFiles, createTempHostedDbPath } from "./temp-db.js";

const dbPath = createTempHostedDbPath("pulse-privacy-delete");
process.env.HOSTED_DB_PATH = dbPath;

const {
  createOrg,
  createTenant,
  getTenant,
  listAuditEvents,
  listPrivacyRequests,
} = await import("../../hosted/db.js");
const { requestPrivacyAction } = await import("../../hosted/privacy-export.js");

describe("privacy delete and anonymize foundation", () => {
  it("soft-deletes only the targeted tenant and records the request lifecycle", async () => {
    const tenantA = createTenant(
      "cn-delete-a",
      "claw_delete_a",
      "delete-a@example.test",
      "Delete A",
    );
    const tenantB = createTenant(
      "cn-delete-b",
      "claw_delete_b",
      "delete-b@example.test",
      "Delete B",
    );
    const orgA = createOrg({
      name: "Delete Org A",
      legacyTenantId: tenantA.id,
    });

    const result = await requestPrivacyAction({
      subjectType: "tenant",
      subjectId: tenantA.id,
      tenantId: tenantA.id,
      orgId: orgA.id,
      action: "delete",
      mode: "soft_delete",
      requestedBy: "usr_privacy_admin",
      execute: true,
    });

    if (!("result" in result)) {
      throw new Error("Expected tenant delete execution result");
    }

    expect(result.result).toBe("soft_deleted");
    expect(result.request.status).toBe("completed");
    expect(getTenant(tenantA.id)?.status).toBe("deleted");
    expect(getTenant(tenantB.id)?.status).toBe("active");
    expect(listPrivacyRequests({ tenantId: tenantA.id })).toHaveLength(1);

    const tenantAAudit = listAuditEvents(tenantA.id);
    expect(tenantAAudit).toHaveLength(1);
    expect(tenantAAudit[0]?.action).toBe("privacy.delete.soft_delete");
    expect(listAuditEvents(tenantB.id)).toEqual([]);
  });

  it("records org anonymize requests for manual review without mutating other orgs", async () => {
    const tenantA = createTenant(
      "cn-anonymize-a",
      "claw_anonymize_a",
      "anonymize-a@example.test",
      "Anonymize A",
    );
    const tenantB = createTenant(
      "cn-anonymize-b",
      "claw_anonymize_b",
      "anonymize-b@example.test",
      "Anonymize B",
    );
    const orgA = createOrg({
      name: "Anonymize Org A",
      legacyTenantId: tenantA.id,
    });
    const orgB = createOrg({
      name: "Anonymize Org B",
      legacyTenantId: tenantB.id,
    });

    const result = await requestPrivacyAction({
      subjectType: "org",
      subjectId: orgA.id,
      orgId: orgA.id,
      action: "anonymize",
      requestedBy: "usr_privacy_admin",
      execute: true,
    });

    if (!("result" in result)) {
      throw new Error("Expected org anonymize execution result");
    }

    expect(result.result).toBe("manual_review_required");
    expect(result.request.status).toBe("manual_review_required");
    expect(getTenant(tenantA.id)?.status).toBe("active");
    expect(getTenant(tenantB.id)?.status).toBe("active");
    expect(listPrivacyRequests({ orgId: orgA.id })).toHaveLength(1);
    expect(listPrivacyRequests({ orgId: orgB.id })).toEqual([]);
  });
});

process.on("exit", () => {
  cleanupSqliteFiles(dbPath);
});
