import { describe, expect, test } from "bun:test";
import { cleanInlineSlugs, humanizeSku } from "./labels.ts";

describe("cleanInlineSlugs", () => {
  test("turns internal slugs into plain English", () => {
    expect(cleanInlineSlugs("Gatekeeper flagged element_not_existent for the vault")).toBe("Gatekeeper flagged custom diagnostic view for the vault");
    expect(cleanInlineSlugs("Persisted in data/dynamic-catalog.json")).toBe("Persisted in custom view catalog");
    expect(cleanInlineSlugs("Answered by muse-wonder-1.0 in 2 s")).toBe("Answered by live analyzer in 2 s");
    expect(cleanInlineSlugs("license_pool_exhausted on the nsg_rule_drift path")).toBe("License Pool Exhausted on the NSG Rule Drift path");
    expect(cleanInlineSlugs("Reclaim seats (Set-MgUserLicense -UserId x) now")).toBe("Reclaim seats now");
  });

  test("leaves machine ids alone and is idempotent", () => {
    const ids = "SPE_E5 · Directory.ReadWrite.All · ./Device/Vendor/MSFT/Policy · 3f2a-11 · rg-contoso-avd-prod · repo:contoso/erp-sync:pull_request · $env:client_secret · cfg.max_retries";
    expect(cleanInlineSlugs(ids)).toBe(ids);
    const once = cleanInlineSlugs("element_not_existent via vm_quota_check");
    expect(cleanInlineSlugs(once)).toBe(once);
  });

  test("humanizeSku still resolves part numbers", () => {
    expect(humanizeSku("SPE_E5")).toBe("Microsoft 365 E5");
  });
});
