import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import { locateJsonPath, type SourceRef } from "@contextpane/catalog";
import type { IntuneScenarioKey } from "./fixtures.ts";
import { findRepoRoot } from "./manifest.ts";

/**
 * The golden-tenant/ baseline in this repository: where each Conditional Access and
 * Intune setting the drift cards compare against is declared, down to the line, and
 * the unified diff between the live Graph object and that file.
 */

type JsonPath = Array<string | number>;
interface Binding {
  file: string;
  path: JsonPath;
}

const CA_FILES = {
  "CA-001": "golden-tenant/entra/conditional-access/CA-001.json",
  "CA-004": "golden-tenant/entra/conditional-access/CA-004.json",
} as const;

/** Drift field (as PolicyDrift names it) → JSON path in the policy file. */
const CA_FIELD_PATHS: Record<string, JsonPath> = {
  state: ["state"],
  "conditions.users.excludeGroups": ["conditions", "users", "excludeGroups"],
};

const ASR_FILE = "golden-tenant/intune/win11/asr-baseline.json";
const FIREWALL_FILE = "golden-tenant/intune/win11/firewall.json";
const WIN11_ASSIGNMENTS: Binding = { file: "golden-tenant/intune/win11/assignments.json", path: [] };
const FABRIKAM_FILE = "golden-tenant/intune/fabrikam/disk-encryption.json";

/** Intune setting (by settingId, else settingName) → where its golden value is declared. */
const INTUNE_SETTINGS: Record<string, Binding> = {
  "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2": { file: ASR_FILE, path: ["settings", "blockcredentialstealingfromwindowslocalsecurityauthoritysubsystem"] },
  vendor_msft_firewall_mdmstore_domainprofile_enablefirewall: { file: FIREWALL_FILE, path: ["settings", "vendor_msft_firewall_mdmstore_domainprofile_enablefirewall"] },
  vendor_msft_firewall_mdmstore_privateprofile_enablefirewall: { file: FIREWALL_FILE, path: ["settings", "vendor_msft_firewall_mdmstore_privateprofile_enablefirewall"] },
  device_vendor_msft_bitlocker_encryptionmethodbydrivetype: { file: FABRIKAM_FILE, path: ["settings", "device_vendor_msft_bitlocker_encryptionmethodbydrivetype"] },
  device_vendor_msft_bitlocker_allowwarningforotherdiskencryption: { file: FABRIKAM_FILE, path: ["settings", "device_vendor_msft_bitlocker_allowwarningforotherdiskencryption"] },
  "Require BitLocker (7-day grace period)": { file: FABRIKAM_FILE, path: ["compliance", "Fabrikam-Win11-Compliance", "requireBitLocker"] },
};

/** The assignment map each Intune scenario's golden baseline declares. */
const INTUNE_ASSIGNMENTS: Record<IntuneScenarioKey, Binding> = {
  "ANOM-INT-309": WIN11_ASSIGNMENTS,
  "INC-4099": { file: FABRIKAM_FILE, path: ["assignments"] },
};

const cache = new Map<string, { mtimeMs: number; text: string; json: unknown }>();

function readGolden(file: string): { text: string; json: unknown } | null {
  const root = findRepoRoot();
  const abs = root ? join(root, file) : null;
  if (!abs || !existsSync(abs)) return null;
  const mtimeMs = statSync(abs).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  // Normalised to LF so line numbers match the committed file on every platform.
  const text = readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  const entry = { mtimeMs, text, json: JSON.parse(text) as unknown };
  cache.set(file, entry);
  return entry;
}

function sourceRef(binding: Binding): SourceRef | undefined {
  const golden = readGolden(binding.file);
  const range = golden ? locateJsonPath(golden.text, binding.path) : null;
  return range ? { file: binding.file, ...range, ref: "main" } : undefined;
}

function getAt(value: unknown, path: JsonPath): unknown {
  return path.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string | number, unknown>)[k] : undefined), value);
}

function setAt(value: unknown, path: JsonPath, next: unknown): unknown {
  if (!path.length) return next;
  const [head, ...rest] = path;
  const copy = (Array.isArray(value) ? [...value] : { ...(value as object) }) as Record<string | number, unknown>;
  copy[head!] = setAt(copy[head!], rest, next);
  return copy;
}

/**
 * Unified diff of one golden file: the live object (the file with `overrides` applied,
 * rendered the same way) against the file itself. Empty when nothing differs.
 */
function fileDiff(file: string, overrides: Array<{ path: JsonPath; value: unknown }>): string {
  const golden = readGolden(file);
  if (!golden) return "";
  const live = overrides.reduce((doc, o) => setAt(doc, o.path, o.value), golden.json);
  const liveText = `${JSON.stringify(live, null, 2)}\n`;
  if (liveText === golden.text) return "";
  return createTwoFilesPatch(`tenant-live/${file}`, file, liveText, golden.text, "live state (Graph)", "golden baseline (Git)", { context: 3 });
}

/* ----------------------------- Conditional Access ---------------------------- */

export function caPolicySourceRef(key: keyof typeof CA_FILES): SourceRef | undefined {
  return sourceRef({ file: CA_FILES[key], path: [] });
}

export function caDriftSourceRef(key: keyof typeof CA_FILES, field: string): SourceRef | undefined {
  const path = CA_FIELD_PATHS[field];
  return path ? sourceRef({ file: CA_FILES[key], path }) : undefined;
}

/** Live policy vs its golden file, for every policy whose state or exclusions drifted. */
export function caBaselineDiff(policies: Array<{ key: keyof typeof CA_FILES; state: string; excludeGroups: string[] }>): string {
  return policies
    .map((p) =>
      fileDiff(CA_FILES[p.key], [
        { path: CA_FIELD_PATHS.state!, value: p.state },
        { path: CA_FIELD_PATHS["conditions.users.excludeGroups"]!, value: p.excludeGroups },
      ]),
    )
    .join("");
}

/* ----------------------------------- Intune ---------------------------------- */

export function intuneSettingSourceRef(setting: { settingId?: string; settingName: string }): SourceRef | undefined {
  const binding = INTUNE_SETTINGS[setting.settingId ?? ""] ?? INTUNE_SETTINGS[setting.settingName];
  return binding ? sourceRef(binding) : undefined;
}

/**
 * Live Intune configuration vs the golden files: drifted setting values (in the file's
 * own vocabulary, e.g. "audit") and the live assignment of every profile the baseline
 * pins, so an unwanted duplicate assignment shows as a diff line too.
 */
export function intuneBaselineDiff(
  key: IntuneScenarioKey,
  settings: Array<{ settingId?: string; settingName: string; status: string; live: string }>,
  policies: Array<{ name: string; assignedTo: string[] }>,
): string {
  const overrides = new Map<string, Array<{ path: JsonPath; value: unknown }>>();
  const add = (file: string, path: JsonPath, value: unknown) => overrides.set(file, [...(overrides.get(file) ?? []), { path, value }]);
  for (const s of settings) {
    const binding = INTUNE_SETTINGS[s.settingId ?? ""] ?? INTUNE_SETTINGS[s.settingName];
    // Conflicts come from a second profile's assignment, which the assignment map below carries.
    if (!binding || s.status !== "drifted") continue;
    const golden = getAt(readGolden(binding.file)?.json, binding.path);
    if (typeof golden === "string") add(binding.file, binding.path, s.live.toLowerCase());
  }
  const assignments = INTUNE_ASSIGNMENTS[key];
  const declared = getAt(readGolden(assignments.file)?.json, assignments.path);
  if (declared && typeof declared === "object") {
    for (const name of Object.keys(declared)) {
      const live = policies.find((p) => p.name === name);
      if (live) add(assignments.file, [...assignments.path, name], live.assignedTo);
    }
  }
  return [...overrides].map(([file, o]) => fileDiff(file, o)).join("");
}
