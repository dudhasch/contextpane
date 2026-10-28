/** Display names for the Microsoft 365 SKU part numbers ContextPane renders. */
const SKU_LABEL: Record<string, string> = {
  SPE_E5: "Microsoft 365 E5",
  SPE_E3: "Microsoft 365 E3",
  SPE_F1: "Microsoft 365 F1",
  SPB: "Microsoft 365 Business Premium",
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  ENTERPRISEPACK: "Office 365 E3",
  ENTERPRISEPREMIUM: "Office 365 E5",
  STANDARDPACK: "Office 365 E1",
  EMS: "Enterprise Mobility + Security E3",
  EMSPREMIUM: "Enterprise Mobility + Security E5",
  AAD_PREMIUM: "Entra ID P1",
  AAD_PREMIUM_P2: "Entra ID P2",
  INTUNE_A: "Intune Plan 1",
  MICROSOFT_INTUNE_SUITE: "Intune Suite",
  WIN_DEF_ATP: "Defender for Endpoint P2",
  POWER_BI_PRO: "Power BI Pro",
  FLOW_FREE: "Power Automate Free",
  DEVELOPERPACK_E5: "Microsoft 365 E5 Developer",
  WINDOWS_STORE: "Windows Store for Business",
};

/** `SPE_E5` → "Microsoft 365 E5", `Microsoft_Intune_Suite` → "Intune Suite"; unknown part numbers keep their id with spaces. */
export function humanizeSku(skuPartNumber: string | null | undefined): string {
  if (!skuPartNumber) return "";
  const key = skuPartNumber.trim().toUpperCase();
  const known = SKU_LABEL[key];
  if (known) return known;
  return skuPartNumber.replace(/_/g, " ").trim();
}

/** Acronyms that stay upper case when a snake_case slug is turned into words. */
const SLUG_ACRONYM = /^(vm|rg|az|ca|spn|sku|dns|bgp|iam|pim|mfa|arm|rbac|oidc|kv|pr|id|ip|nsg|avd)$/i;

function formatSlugWord(w: string): string {
  if (SLUG_ACRONYM.test(w)) return w.toUpperCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * Model-written titles, summaries and plan steps leak internal slugs (`element_not_existent`,
 * `dynamic-catalog.json`, `muse-wonder-1.0`, `license_pool_exhausted`). The orchestrator runs this
 * once where it produces a brief or a synthesized plan, so every client shows plain English. It is
 * idempotent, and machine ids (`SPE_E5`, `Directory.ReadWrite.All`, `repo:org/app:pull_request`)
 * are left alone.
 */
export function cleanInlineSlugs(text: string): string {
  return (
    text
      .replace(/\belement_not_existent\b/gi, "custom diagnostic view")
      .replace(/\b(?:data\/)?dynamic-catalog\.json\b/gi, "custom view catalog")
      .replace(/\bmuse-(?:wonder|spark|glimmer|voice)[a-z0-9.-]*\b/gi, "live analyzer")
      .replace(/\s*\((?:Remove-MgGroupMemberByRef|Invoke-MgLicenseUser|Set-MgUserLicense|Update-MgIdentityConditionalAccessPolicy)[^)]*\)/g, "")
      // A slug glued to a path, a subject claim or a member access (`repo:org/app:pull_request`,
      // `$env:client_secret`, `cfg.max_retries`) is a machine id and stays verbatim.
      .replace(/(?<![\w:/.@$=-])([a-z]{2,}(?:_[a-z0-9]{2,})+)(?![\w:/(-]|\.\w)/g, (match) => match.split("_").map(formatSlugWord).join(" "))
  );
}
