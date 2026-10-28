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
