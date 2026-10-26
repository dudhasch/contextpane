import { SCENARIO_IDS, TENANT_REGISTRY, type SteerLayoutArgs } from "@contextpane/catalog";

/**
 * Deterministic intent parser for voice / typed steering commands. Instant,
 * offline, and good enough for the demo phrases; ambiguous commands can be
 * escalated to muse-spark when a key exists.
 */

type ComponentKey = SteerLayoutArgs["componentTypes"][number];

const COMPONENT_ALIASES: Array<[RegExp, ComponentKey]> = [
  [/licen[cs]e|sku|e5|e3|seat|drift(ed)? user|countviolation/i, "LicenseDriftCard"],
  [/sign[- ]?in|timeline|aadsts|conditional access|ca polic|block|break[- ]?glass/i, "EntraSignInTimeline"],
  [/intune|bitlocker|asr|compliance|device|firewall|baseline/i, "IntuneDriftCard"],
  [/nsg|terraform|iac|host ?pool|azure polic|infrastructure|rogue|rdp|ssh|tag/i, "IaCDriftBanner"],
];

/** Spoken names of the scenarios ("open the license anomaly", "go to INC 4099"). */
const SCENARIO_ALIASES: Array<[RegExp, (typeof SCENARIO_IDS)[number]]> = [
  [/\b(inc[- ]?)?4092\b/i, "INC-4092"],
  [/\b(inc[- ]?)?4099\b/i, "INC-4099"],
  [/licen[cs]e anomal|count ?violation|orphaned|lic[- ]?101/i, "ANOM-LIC-101"],
  [/(conditional access|ca|break[- ]?glass) anomal|ca[- ]?204|break[- ]?glass/i, "ANOM-CA-204"],
  [/intune anomal|asr|baseline drift|int[- ]?309/i, "ANOM-INT-309"],
];

export function parseSteerIntent(transcript: string): SteerLayoutArgs {
  const text = transcript.trim().toLowerCase().replace(/[.,!?]+$/g, "");
  const components = COMPONENT_ALIASES.filter(([re]) => re.test(text)).map(([, c]) => c);
  const uniqueComponents = [...new Set(components)];
  const base = { transcript: transcript.trim(), componentTypes: uniqueComponents };

  if (/\b(reset|show (me )?everything|clear filter|all components|full view)\b/.test(text)) {
    return { ...base, intent: "reset", componentTypes: [], confidence: 0.95 };
  }
  if (/\b(generate|create|build|stage)\b.*\b(fix|remediation|pr|pull request)\b|\bremediate\b/.test(text)) {
    return { ...base, intent: "generate-fix", confidence: 0.9 };
  }
  if (/\b(switch|go|jump|change|open|show)\b/.test(text)) {
    const scenario = SCENARIO_ALIASES.find(([re]) => re.test(text))?.[1];
    if (scenario) return { ...base, intent: "switch-scenario", scenarioId: scenario, confidence: 0.9 };
  }
  if (/\b(switch|go|jump|change|open)\b.*\b(to|tenant)\b|\btenant\b/.test(text) || /\b(contoso|fabrikam)\b/.test(text)) {
    const tenant = Object.values(TENANT_REGISTRY).find((t) => text.includes(t.displayName.split(" ")[0]!.toLowerCase()));
    if (tenant) return { ...base, intent: "switch-tenant", tenantId: tenant.tenantId, confidence: 0.92 };
  }
  if (/\b(unpin|remove recipe|forget (this )?view)\b/.test(text)) {
    return { ...base, intent: "unpin", confidence: 0.85 };
  }
  if (/\b(pin|save|remember|bookmark)\b/.test(text)) {
    const name = text.match(/\b(?:as|called|named)\s+(.+)$/)?.[1]?.trim();
    return { ...base, intent: "pin", ...(name ? { recipeName: titleCase(name) } : {}), confidence: 0.88 };
  }
  if (/\b(focus|zoom|expand|only|just)\b/.test(text) && uniqueComponents.length === 1) {
    return { ...base, intent: "focus", confidence: 0.85 };
  }
  if (/\b(show|filter|display|hide|only|just|focus)\b/.test(text) && uniqueComponents.length > 0) {
    return { ...base, intent: "filter", confidence: 0.8 };
  }
  if (uniqueComponents.length > 0) {
    return { ...base, intent: "filter", confidence: 0.6 };
  }
  return { ...base, intent: "unknown", confidence: 0.2 };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}
