import type { CaPolicyInspector, IntuneDevice, IntunePolicyRef, IntuneSettingDrift } from "@contextpane/catalog";

/**
 * Fixtures for the proactive tenant anomalies and the Intune side of INC-4099.
 * scripts/Invoke-SeedContextPaneLab.ps1 creates the same objects (prefixed
 * [ContextPane-Demo]) in the lab tenant; the service overlays whatever it finds
 * live on top of these, so a seeded tenant drives the cards and an unseeded one
 * still renders the full story, labelled as a fixture.
 */

export const LAB_DOMAIN = "c4a8shili.onmicrosoft.com";
export const DEMO_PREFIX = "[ContextPane-Demo]";

/** Display name the seed script gives a demo object in the lab tenant. */
export const demoName = (name: string) => `${DEMO_PREFIX} ${name}`;

const hoursAgo = (h: number, now = Date.now()) => new Date(now - h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/* -------------------------------------------------------------------------- */
/* ANOM-LIC-101 · CountViolation + orphaned licenses on disabled accounts      */
/* -------------------------------------------------------------------------- */

export interface LicenseAnomalyUser {
  upn: string;
  displayName: string;
  jobTitle: string;
  accountEnabled: boolean;
  lastSignIn: string;
  /** SKUs held in the drifted state. */
  heldSkus: string[];
  assignmentPath: "Direct" | "Group" | "Direct + Group";
  role: "orphaned" | "new-hire";
}

export const LICENSE_ANOMALY = {
  groupName: "SG-Contoso-M365-E5",
  sku: { skuPartNumber: "SPE_E5", skuName: "Microsoft 365 E5" },
  /** Seats held by everyone outside the anomaly; the users below add to these. */
  pools: [
    { skuPartNumber: "SPE_E5", skuName: "Microsoft 365 E5", enabled: 15, othersConsumed: 12 },
    { skuPartNumber: "Microsoft_365_Copilot", skuName: "Microsoft 365 Copilot", enabled: 10, othersConsumed: 8 },
  ],
  users: [
    { upn: `henrietta.mueller.contoso@${LAB_DOMAIN}`, displayName: "Henrietta Mueller", jobTitle: "Former Finance Analyst", accountEnabled: false, lastSignIn: "2026-07-14T16:02:00Z", heldSkus: ["SPE_E5", "Microsoft_365_Copilot"], assignmentPath: "Direct + Group", role: "orphaned" },
    { upn: `pradeep.gupta.contoso@${LAB_DOMAIN}`, displayName: "Pradeep Gupta", jobTitle: "Former FP&A Lead", accountEnabled: false, lastSignIn: "2026-06-30T11:47:00Z", heldSkus: ["SPE_E5", "Microsoft_365_Copilot"], assignmentPath: "Direct + Group", role: "orphaned" },
    { upn: `christie.cline.contoso@${LAB_DOMAIN}`, displayName: "Christie Cline", jobTitle: "Former Procurement Specialist", accountEnabled: false, lastSignIn: "2026-07-02T09:15:00Z", heldSkus: ["SPE_E5"], assignmentPath: "Group", role: "orphaned" },
    { upn: `adele.vance.contoso@${LAB_DOMAIN}`, displayName: "Adele Vance", jobTitle: "Financial Analyst (joined 2026-10-19)", accountEnabled: true, lastSignIn: "2026-10-26T07:31:00Z", heldSkus: [], assignmentPath: "Group", role: "new-hire" },
    { upn: `joni.sherman.contoso@${LAB_DOMAIN}`, displayName: "Joni Sherman", jobTitle: "Treasury Analyst (joined 2026-10-20)", accountEnabled: true, lastSignIn: "2026-10-26T07:44:00Z", heldSkus: [], assignmentPath: "Group", role: "new-hire" },
  ] satisfies LicenseAnomalyUser[],
};

/* -------------------------------------------------------------------------- */
/* ANOM-CA-204 · CA drift: missing break-glass exclusion, report-only drift     */
/* -------------------------------------------------------------------------- */

export interface CaGoldenPolicy {
  key: "CA-001" | "CA-004";
  displayName: string;
  includeGroups: string[];
  targetApps: string[];
  clientAppTypes: string[];
  grantControls: string[];
  golden: { state: CaPolicyInspector["state"]; excludeGroups: string[] };
  drifted: { state: CaPolicyInspector["state"]; excludeGroups: string[] };
}

export const CA_POSTURE = {
  breakGlassGroup: "SG-BreakGlass-Accounts",
  breakGlassAccount: `bg-admin-01@${LAB_DOMAIN}`,
  adminGroup: "SG-ContextPane-Demo-Admins",
  legacyAuthScopeGroup: "SG-Contoso-Finance-AVD",
  goldenSource: "golden-tenant/entra/conditional-access/*.json @ main",
  policies: [
    {
      key: "CA-001",
      displayName: demoName("CA-001-Require-PhishingResistant-MFA-Admins"),
      includeGroups: ["SG-ContextPane-Demo-Admins"],
      targetApps: ["All cloud apps"],
      clientAppTypes: ["all"],
      grantControls: ["Authentication strength: Phishing-resistant MFA"],
      golden: { state: "enabled", excludeGroups: ["SG-BreakGlass-Accounts"] },
      drifted: { state: "enabled", excludeGroups: [] },
    },
    {
      key: "CA-004",
      displayName: demoName("CA-004-Block-Legacy-Auth"),
      includeGroups: ["SG-Contoso-Finance-AVD"],
      targetApps: ["All cloud apps"],
      clientAppTypes: ["exchangeActiveSync", "other"],
      grantControls: ["Block"],
      golden: { state: "enabled", excludeGroups: ["SG-BreakGlass-Accounts"] },
      drifted: { state: "enabledForReportingButNotEnforced", excludeGroups: ["SG-BreakGlass-Accounts"] },
    },
  ] satisfies CaGoldenPolicy[],
};

export interface DirectoryAuditEvent {
  at: string;
  actor: string;
  activity: string;
  target: string;
  detail: string;
}

/** Directory audit entries that show the out-of-band changes (relative to now, so "last 24 h" stays true). */
export function caAuditEvents(now = Date.now()): DirectoryAuditEvent[] {
  return [
    {
      at: hoursAgo(52, now),
      actor: `ext-maint-02@${LAB_DOMAIN}`,
      activity: "Update conditional access policy",
      target: CA_POSTURE.policies[0]!.displayName,
      detail: "conditions.users.excludeGroups: [SG-BreakGlass-Accounts] → [] (portal, no change ticket)",
    },
    {
      at: hoursAgo(31, now),
      actor: `ext-maint-02@${LAB_DOMAIN}`,
      activity: "Update conditional access policy",
      target: CA_POSTURE.policies[1]!.displayName,
      detail: "state: enabled → enabledForReportingButNotEnforced (maintenance window MW-2026-43, never reverted)",
    },
  ];
}

export interface LegacySignInFixture {
  upn: string;
  displayName: string;
  clientApp: "IMAP4" | "Authenticated SMTP";
  location: string;
  ipAddress: string;
  hoursAgo: number;
}

const LEGACY_PEOPLE = [
  ["lynne.robins.contoso", "Lynne Robins"],
  ["diego.siciliani.contoso", "Diego Siciliani"],
  ["patti.fernandez.contoso", "Patti Fernandez"],
  ["alex.wilber.contoso", "Alex Wilber"],
] as const;

/** 19 legacy-auth sign-ins in the last 24 h that CA-004 only reported (13 IMAP4, 6 SMTP AUTH, 3 from an unfamiliar ASN). */
export function legacySignIns(): LegacySignInFixture[] {
  return Array.from({ length: 19 }, (_, i) => {
    const [mail, displayName] = LEGACY_PEOPLE[i % LEGACY_PEOPLE.length]!;
    const foreign = i === 4 || i === 11 || i === 17;
    return {
      upn: `${mail}@${LAB_DOMAIN}`,
      displayName,
      clientApp: i % 3 === 2 ? "Authenticated SMTP" : "IMAP4",
      location: foreign ? "Amsterdam, NL" : "Zurich, CH",
      ipAddress: foreign ? `185.220.101.${40 + i}` : `198.51.100.${70 + i}`,
      hoursAgo: 23 - i * 1.2,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Intune: ANOM-INT-309 (ASR + firewall drift) and INC-4099 (BitLocker)         */
/* -------------------------------------------------------------------------- */

export type IntuneScenarioKey = "ANOM-INT-309" | "INC-4099";

export interface IntuneLiveProbe {
  /** Settings Catalog policy holding the ASR rule (name without the demo prefix). */
  asrPolicy?: string;
  /** ASR rule id inside that policy, as the Settings Catalog setting definition names it. */
  asrRuleSetting?: string;
  /** Legacy Device Configuration profile whose assignment causes the conflict. */
  conflictingProfile: string;
  /** Group that profile is (re)assigned to. */
  assignmentGroup: string;
}

export interface IntuneScenarioFixture {
  issueKind: "policy-conflict" | "baseline-drift";
  errorCode?: string;
  errorMeaning?: string;
  goldenSource: string;
  policies: Array<Omit<IntunePolicyRef, "source">>;
  settings: IntuneSettingDrift[];
  devices: IntuneDevice[];
  live: IntuneLiveProbe;
}

const ASR_LSASS_RULE = "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2";

function workstationDevices(): IntuneDevice[] {
  const owners = ["lynne.robins", "alex.wilber", "miriam.graham", "diego.siciliani", "patti.fernandez", "adele.vance", "joni.sherman", "megan.bowen", "lee.gu", "nestor.wilke", "isaiah.langer"];
  return owners.map((o, i) => ({
    deviceName: `CONTOSO-WS-${(2201 + i * 7).toString()}`,
    upn: `${o}.contoso@${LAB_DOMAIN}`,
    os: "Windows 11 Enterprise 24H2",
    complianceState: "Conflict" as const,
    lastCheckIn: `2026-10-26T0${(6 + (i % 3)).toString()}:${(10 + i * 4).toString().padStart(2, "0")}:00Z`,
    detail: "EnableFirewall: True (EndpointSecurity-Firewall-Prod) vs False (Win11-Firewall-MDM)",
  }));
}

export const INTUNE_SCENARIOS: Record<IntuneScenarioKey, IntuneScenarioFixture> = {
  "ANOM-INT-309": {
    issueKind: "baseline-drift",
    goldenSource: "golden-tenant/intune/win11/*.json @ main",
    policies: [
      { id: "cfg-asr-baseline", name: "Intune-Win11-ASR-Baseline", kind: "Endpoint Security", assignedTo: ["SG-All-Workstations"], role: "drifted" },
      { id: "cfg-fw-prod", name: "EndpointSecurity-Firewall-Prod", kind: "Endpoint Security", assignedTo: ["SG-All-Workstations"], role: "golden" },
      { id: "cfg-fw-mdm", name: "Win11-Firewall-MDM", kind: "Device Configuration", assignedTo: ["SG-All-Workstations"], role: "duplicate" },
    ],
    settings: [
      {
        policyName: "Intune-Win11-ASR-Baseline",
        settingName: "ASR: Block credential stealing from the Windows local security authority subsystem (lsass.exe)",
        settingId: ASR_LSASS_RULE,
        golden: "Block",
        live: "Audit",
        status: "drifted",
        severity: "high",
        cspUri: "./Vendor/MSFT/Policy/Config/Defender/AttackSurfaceReductionRules",
        registryPath: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Windows Defender Exploit Guard\\ASR\\Rules",
        tattooedOnUnassign: false,
      },
      {
        policyName: "EndpointSecurity-Firewall-Prod ⟷ Win11-Firewall-MDM",
        settingName: "Firewall · Domain profile · EnableFirewall",
        settingId: "vendor_msft_firewall_mdmstore_domainprofile_enablefirewall",
        golden: "True",
        live: "True / False (conflict)",
        status: "conflict",
        severity: "high",
        cspUri: "./Vendor/MSFT/Firewall/MdmStore/DomainProfile/EnableFirewall",
        registryPath: "HKLM\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Firewall\\DomainProfile_EnableFirewall (tattooed under PolicyManager\\current\\device)",
        tattooedOnUnassign: true,
      },
      {
        policyName: "EndpointSecurity-Firewall-Prod ⟷ Win11-Firewall-MDM",
        settingName: "Firewall · Private profile · EnableFirewall",
        settingId: "vendor_msft_firewall_mdmstore_privateprofile_enablefirewall",
        golden: "True",
        live: "True / False (conflict)",
        status: "conflict",
        severity: "medium",
        cspUri: "./Vendor/MSFT/Firewall/MdmStore/PrivateProfile/EnableFirewall",
        registryPath: "HKLM\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Firewall\\PrivateProfile_EnableFirewall (tattooed under PolicyManager\\current\\device)",
        tattooedOnUnassign: true,
      },
    ],
    devices: workstationDevices(),
    live: {
      asrPolicy: "Intune-Win11-ASR-Baseline",
      asrRuleSetting: "blockcredentialstealingfromwindowslocalsecurityauthoritysubsystem",
      conflictingProfile: "Win11-Firewall-MDM",
      assignmentGroup: "SG-All-Workstations",
    },
  },
  "INC-4099": {
    issueKind: "policy-conflict",
    errorCode: "0x87D1FDE8",
    errorMeaning: "Remediation failed: silent BitLocker encryption could not apply because two assigned profiles configure it differently.",
    goldenSource: "golden-tenant/intune/fabrikam/disk-encryption.json @ main",
    policies: [
      { id: "cfg-fab-diskenc", name: "Fabrikam-EndpointSecurity-DiskEncryption", kind: "Endpoint Security", assignedTo: ["SG-Fabrikam-Win11-Devices"], role: "golden" },
      { id: "cfg-fab-legacy-bl", name: "Fabrikam-Legacy-BitLocker-DeviceConfig", kind: "Device Configuration", assignedTo: ["SG-Fabrikam-Win11-Devices"], role: "conflicting" },
      { id: "cmp-fab-win11", name: "Fabrikam-Win11-Compliance", kind: "Compliance Policy", assignedTo: ["SG-Fabrikam-Win11-Devices"], role: "compliance" },
    ],
    settings: [
      {
        policyName: "DiskEncryption ⟷ Legacy-BitLocker-DeviceConfig",
        settingName: "BitLocker · Encryption method for OS drives",
        settingId: "device_vendor_msft_bitlocker_encryptionmethodbydrivetype",
        golden: "XTS-AES 256-bit",
        live: "XTS-AES 256-bit / XTS-AES 128-bit (conflict)",
        status: "conflict",
        severity: "high",
        cspUri: "./Device/Vendor/MSFT/BitLocker/EncryptionMethodByDriveType",
        registryPath: "HKLM\\SOFTWARE\\Policies\\Microsoft\\FVE\\EncryptionMethodWithXtsOs (fixed data drives: EncryptionMethodWithXtsFdv, removable: EncryptionMethodWithXtsRdv)",
        tattooedOnUnassign: true,
      },
      {
        policyName: "DiskEncryption ⟷ Legacy-BitLocker-DeviceConfig",
        settingName: "BitLocker · Allow warning for other disk encryption",
        settingId: "device_vendor_msft_bitlocker_allowwarningforotherdiskencryption",
        golden: "Block (silent encryption)",
        live: "Block / Allow (conflict)",
        status: "conflict",
        severity: "high",
        cspUri: "./Device/Vendor/MSFT/BitLocker/AllowWarningForOtherDiskEncryption",
        registryPath: "HKLM\\SOFTWARE\\Policies\\Microsoft\\FVE\\AllowWarningForOtherDiskEncryption",
        tattooedOnUnassign: true,
      },
      {
        policyName: "Fabrikam-Win11-Compliance",
        settingName: "Require BitLocker (7-day grace period)",
        golden: "Encrypted",
        live: "Not encrypted · grace period expired",
        status: "drifted",
        severity: "critical",
      },
    ],
    devices: [
      ["FABRIKAM-LT-1107", "grady.archie.legal"],
      ["FABRIKAM-LT-1112", "isaiah.langer.legal"],
      ["FABRIKAM-LT-1115", "lidia.holloway.legal"],
      ["FABRIKAM-LT-1121", "johanna.lorenz.legal"],
      ["FABRIKAM-SP-1131", "grady.archie.legal"],
      ["FABRIKAM-LT-1126", "debra.berger.legal"],
    ].map(([deviceName, owner], i) => ({
      deviceName: deviceName!,
      upn: `${owner}@fabrikamlegal.onmicrosoft.com`,
      os: "Windows 11 Enterprise 24H2",
      complianceState: "NonCompliant" as const,
      lastCheckIn: `2026-10-26T06:${(12 + i * 6).toString().padStart(2, "0")}:00Z`,
      detail: "BitLocker 0x87D1FDE8 · grace period expired 2026-10-25",
    })),
    live: {
      conflictingProfile: "Fabrikam-Legacy-BitLocker-DeviceConfig",
      assignmentGroup: "SG-Fabrikam-Win11-Devices",
    },
  },
};
