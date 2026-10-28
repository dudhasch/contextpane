import {
  SCENARIO_REGISTRY,
  getCustomScenario,
  isScenarioId,
  type CanvasComponentType,
  type HealthState,
  type ScenarioId,
  type ScenarioRegistryEntry,
} from "@contextpane/catalog";

/**
 * Bi-temporal time-travel scrubber (Tier 0, deterministic, no LLM).
 *
 * Each scenario has 4-5 discrete slices. A slice is valid over
 * [validFrom, validTo) — the next slice's validFrom, or null (open-ended)
 * for the counterfactual post-remediation slice. Scrubbing to a slice is a
 * pure local re-hydration: the snapshot carries every card/entity status the
 * canvas needs, so it costs 0 tokens and well under 2 ms.
 */

export type TimelineSliceKind = "baseline" | "drift" | "first-failure" | "now" | "counterfactual";

export interface TimelineEntityState {
  id: string;
  status: string;
  health: HealthState;
  note?: string;
}

export interface TimelineCardState {
  cardId: CanvasComponentType;
  status: HealthState;
  summary: string;
}

/** Compact snapshot sufficient to re-hydrate the canvas at a slice. */
export interface TimelineStateSnapshot {
  health: HealthState;
  summary: string;
  /** Entity-pill ids affected at this slice (empty when healthy). */
  affectedEntities: string[];
  entities: TimelineEntityState[];
  cards: TimelineCardState[];
  /** Flat entity-id -> status map for O(1) pill lookup during scrubbing. */
  statuses: Record<string, string>;
}

export interface TimelineSlice {
  id: string;
  scenarioId: ScenarioId | string;
  index: number;
  kind: TimelineSliceKind;
  /** Display label, e.g. "Healthy Baseline". */
  label: string;
  /** Relative scrubber label, e.g. "T-18m", "NOW", "T+Fix". */
  relativeLabel: string;
  /** Slice instant, UTC ISO-8601. Equals validFrom. */
  timestamp: string;
  validFrom: string;
  /** Exclusive end of validity; null = open-ended (counterfactual). */
  validTo: string | null;
  /** [valid_from, valid_to] bi-temporal validity interval. */
  valid: readonly [string, string | null];
  counterfactual: boolean;
  /** Card that changed at this slice — the one the scrubber highlights. */
  changedCardId: CanvasComponentType | null;
  state: TimelineStateSnapshot;
  /** Tier 0 re-hydration marker: deterministic, no model call. */
  tier: 0;
  tokens: 0;
  rehydration: { tier: 0; tokens: 0; mode: "Tier0" };
}

export interface ScenarioTimeline {
  scenarioId: ScenarioId | string;
  title: string;
  kind: ScenarioRegistryEntry["kind"];
  tenantId: ScenarioRegistryEntry["tenantId"];
  slices: TimelineSlice[];
  tier: 0;
  tokens: 0;
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

const ent = (id: string, status: string, health: HealthState, note?: string): TimelineEntityState => ({
  id,
  status,
  health,
  ...(note ? { note } : {}),
});

interface PhaseSpec {
  kind: TimelineSliceKind;
  label: string;
  relativeLabel: string;
  offsetMinutes: number;
  health: HealthState;
  summary: string;
  changedCardId: CanvasComponentType | null;
  entities: TimelineEntityState[];
  /** Per-card summary override; cards not listed keep the phase summary. */
  cardSummaries?: Partial<Record<CanvasComponentType, string>>;
  cardHealth?: Partial<Record<CanvasComponentType, HealthState>>;
}

function buildTimeline(entry: ScenarioRegistryEntry, nowIso: string, phases: PhaseSpec[]): ScenarioTimeline {
  const nowMs = Date.parse(nowIso);
  const stamps = phases.map((p) => new Date(nowMs + p.offsetMinutes * 60_000).toISOString());
  const slices: TimelineSlice[] = phases.map((phase, index) => {
    const validFrom = stamps[index]!;
    const validTo = index + 1 < stamps.length ? stamps[index + 1]! : null;
    const affected = phase.entities.filter((e) => e.health !== "healthy");
    const cards: TimelineCardState[] = entry.components.map((cardId) => ({
      cardId,
      status: phase.cardHealth?.[cardId] ?? (cardId === phase.changedCardId ? phase.health : phase.health === "healthy" ? "healthy" : "warning"),
      summary: phase.cardSummaries?.[cardId] ?? phase.summary,
    }));
    // A healthy (baseline / post-fix) slice affects nothing and marks every card healthy.
    if (phase.health === "healthy") for (const c of cards) c.status = "healthy";
    return {
      id: `${entry.scenarioId.toLowerCase()}-${phase.kind}`,
      scenarioId: entry.scenarioId,
      index,
      kind: phase.kind,
      label: phase.label,
      relativeLabel: phase.relativeLabel,
      timestamp: validFrom,
      validFrom,
      validTo,
      valid: [validFrom, validTo] as const,
      counterfactual: phase.kind === "counterfactual",
      changedCardId: phase.changedCardId,
      state: {
        health: phase.health,
        summary: phase.summary,
        affectedEntities: affected.map((e) => e.id),
        entities: phase.entities,
        cards,
        statuses: Object.fromEntries(phase.entities.map((e) => [e.id, e.status])),
      },
      tier: 0,
      tokens: 0,
      rehydration: { tier: 0, tokens: 0, mode: "Tier0" },
    };
  });
  return { scenarioId: entry.scenarioId, title: entry.title, kind: entry.kind, tenantId: entry.tenantId, slices, tier: 0, tokens: 0 };
}

/* -------------------------------------------------------------------------- */
/* INC-4092 — exact slices (2026-10-26, UTC)                                   */
/* -------------------------------------------------------------------------- */

function inc4092(entry: ScenarioRegistryEntry): ScenarioTimeline {
  const [license, entra, iac] = entry.components as [CanvasComponentType, CanvasComponentType, CanvasComponentType];
  const baselineEntities = [
    ent("SPE_E5", "15 compliant", "healthy", "15 SPE_E5 compliant"),
    ent("SPE_E3", "0 users", "healthy", "0 users on legacy SPE_E3"),
    ent("SG-Contoso-Finance-AVD", "5/5 SPE_E5", "healthy", "5 of 5 compliant"),
    ent("lynne.robins.contoso@c4a8shili.onmicrosoft.com", "compliant", "healthy"),
    ent("diego.siciliani.contoso@c4a8shili.onmicrosoft.com", "compliant", "healthy"),
    ent("patti.fernandez.contoso@c4a8shili.onmicrosoft.com", "compliant", "healthy"),
    ent("[ContextPane-Demo] Block AVD - Contoso Finance Legacy", "in sync", "healthy"),
    ent("vdpool-contoso-fin-01", "healthy", "healthy"),
    ent("nsg-contoso-avd-hostpool-01", "in sync", "healthy"),
    ent("nsg-contoso-avd", "clean", "healthy", "NSG clean"),
    ent("AADSTS53003", "0", "healthy", "0 AADSTS53003"),
  ];
  const driftEntities = [
    ent("Allow-Temp-RDP-Diagnostic-Drift", "3389 open", "critical", "Allow-Temp-RDP-Diagnostic-Drift · TCP/3389 open"),
    ent("nsg-contoso-avd-hostpool-01", "1 rogue rule", "critical", "TCP/3389 open from *"),
    ent("SPE_E3", "3 users", "warning", "3 users legacy CA group on SPE_E3"),
    ent("SPE_E5", "12 compliant, 3 drifted", "warning"),
    ent("SG-Contoso-Finance-AVD", "3 drifted", "warning"),
    ent("lynne.robins.contoso@c4a8shili.onmicrosoft.com", "SPE_E3 drift", "warning"),
    ent("diego.siciliani.contoso@c4a8shili.onmicrosoft.com", "SPE_E3 drift", "warning"),
    ent("patti.fernandez.contoso@c4a8shili.onmicrosoft.com", "SPE_E3 drift", "warning"),
    ent("[ContextPane-Demo] Block AVD - Contoso Finance Legacy", "legacy block active", "warning"),
    ent("vdpool-contoso-fin-01", "port 3389 exposed", "warning"),
    ent("AADSTS53003", "0", "healthy", "0 AADSTS53003"),
  ];
  const failureEntities = [
    ent("lynne.robins.contoso@c4a8shili.onmicrosoft.com", "AADSTS53003", "critical", "lynne.robins · AADSTS53003 · AVD"),
    ent("diego.siciliani.contoso@c4a8shili.onmicrosoft.com", "AADSTS53003", "critical", "diego.siciliani · AADSTS53003 · AVD"),
    ent("patti.fernandez.contoso@c4a8shili.onmicrosoft.com", "AADSTS53003", "critical", "patti.fernandez · AADSTS53003 · AVD"),
    ent("AADSTS53003", "1 failure", "critical", "First AADSTS53003 on Azure Virtual Desktop"),
    ent("[ContextPane-Demo] Block AVD - Contoso Finance Legacy", "blocking AVD", "critical"),
    ent("Allow-Temp-RDP-Diagnostic-Drift", "3389 open", "critical"),
    ent("nsg-contoso-avd-hostpool-01", "1 rogue rule", "critical"),
    ent("vdpool-contoso-fin-01", "blocked / 3389 open", "critical"),
    ent("SPE_E3", "3 users", "warning", "3 users legacy CA group on SPE_E3"),
    ent("SPE_E5", "12 compliant, 3 drifted", "warning"),
    ent("SG-Contoso-Finance-AVD", "3 blocked", "critical"),
  ];
  return buildTimeline(entry, "2026-10-26T08:04:00.000Z", [
    {
      kind: "baseline", label: "Healthy Baseline", relativeLabel: "T-18m", offsetMinutes: -18,
      health: "healthy", summary: "Healthy baseline: 15 SPE_E5 compliant, NSG clean, 0 AADSTS53003.",
      changedCardId: null, entities: baselineEntities,
      cardSummaries: {
        [license]: "5 of 5 users in SG-Contoso-Finance-AVD compliant on SPE_E5 · 0 group errors",
        [entra]: "Conditional Access matches golden baseline · 0 AADSTS53003 blocks",
        [iac]: "NSG in sync with Terraform · 0 rogue rules · TCP/3389 closed",
      },
    },
    {
      kind: "drift", label: "Out-of-Band NSG & Group Drift", relativeLabel: "T-14m", offsetMinutes: -14,
      health: "warning", summary: "Out-of-band drift: Allow-Temp-RDP-Diagnostic-Drift leaves 3389 open; 3 users in the legacy CA group are on SPE_E3.",
      changedCardId: iac, entities: driftEntities,
      cardHealth: { [iac]: "critical", [license]: "warning", [entra]: "healthy" },
      cardSummaries: {
        [license]: "3 of 5 users in SG-Contoso-Finance-AVD drifted on SPE_E3",
        [entra]: "0 sign-in failures yet · legacy CA block policy active on SG-Contoso-Finance-Legacy",
        [iac]: "Out-of-band drift: Allow-Temp-RDP-Diagnostic-Drift opens TCP/3389 from * on nsg-contoso-avd-hostpool-01",
      },
    },
    {
      kind: "first-failure", label: "First Sign-In Failure", relativeLabel: "T-06m", offsetMinutes: -6,
      health: "critical", summary: "First sign-in failure: lynne.robins is blocked on AVD with AADSTS53003.",
      changedCardId: entra, entities: failureEntities,
      cardHealth: { [entra]: "critical", [iac]: "critical", [license]: "warning" },
      cardSummaries: {
        [license]: "3 of 5 users in SG-Contoso-Finance-AVD on SPE_E3 instead of SPE_E5",
        [entra]: "First sign-in failure: lynne.robins blocked on Azure Virtual Desktop with AADSTS53003",
        [iac]: "Allow-Temp-RDP-Diagnostic-Drift leaves TCP/3389 open on nsg-contoso-avd-hostpool-01",
      },
    },
    {
      kind: "now", label: "Active Incident", relativeLabel: "NOW", offsetMinutes: 0,
      health: "critical", summary: "Active incident: AADSTS53003 blocks AVD for the legacy CA group on SPE_E3 while 3389 stays open out-of-band.",
      changedCardId: entra, entities: failureEntities,
      cardHealth: { [entra]: "critical", [iac]: "critical", [license]: "warning" },
      cardSummaries: {
        [license]: "3 of 5 users in SG-Contoso-Finance-AVD hold SPE_E3 instead of SPE_E5",
        [entra]: "Active incident: 3 Finance users blocked on AVD with AADSTS53003 by Block AVD - Contoso Finance Legacy",
        [iac]: "Active drift: Allow-Temp-RDP-Diagnostic-Drift (TCP/3389 from *) + 3 tag drifts on nsg-contoso-avd-hostpool-01",
      },
    },
    {
      kind: "counterfactual", label: "Counterfactual Post-Remediation", relativeLabel: "T+Fix", offsetMinutes: 8,
      health: "healthy", summary: "Post-remediation (counterfactual): rogue NSG rule removed, 3 users moved to SPE_E5 and out of the legacy CA group, 0 AADSTS53003.",
      changedCardId: license,
      cardSummaries: {
        [license]: "5 of 5 users in SG-Contoso-Finance-AVD compliant on SPE_E5 · 3 upgraded from SPE_E3",
        [entra]: "Conditional Access matches golden baseline · SG-Contoso-Finance-AVD excluded · 0 AADSTS53003",
        [iac]: "NSG in sync with Terraform · 0 rogue rules · Allow-Temp-RDP-Diagnostic-Drift removed",
      },
      entities: [
        ent("SPE_E5", "15 compliant", "healthy", "15 SPE_E5 compliant"),
        ent("SPE_E3", "released", "healthy", "3 users upgraded to SPE_E5"),
        ent("SG-Contoso-Finance-AVD", "5/5 SPE_E5", "healthy"),
        ent("lynne.robins.contoso@c4a8shili.onmicrosoft.com", "remediated", "healthy"),
        ent("diego.siciliani.contoso@c4a8shili.onmicrosoft.com", "remediated", "healthy"),
        ent("patti.fernandez.contoso@c4a8shili.onmicrosoft.com", "remediated", "healthy"),
        ent("[ContextPane-Demo] Block AVD - Contoso Finance Legacy", "report-only", "healthy"),
        ent("vdpool-contoso-fin-01", "compliant", "healthy"),
        ent("nsg-contoso-avd-hostpool-01", "in sync", "healthy"),
        ent("Allow-Temp-RDP-Diagnostic-Drift", "removed", "healthy"),
        ent("nsg-contoso-avd", "clean", "healthy", "NSG clean"),
        ent("AADSTS53003", "0", "healthy", "0 AADSTS53003"),
      ],
    },
  ]);
}

/* -------------------------------------------------------------------------- */
/* Other scenarios — generic phases derived from the registry entry            */
/* -------------------------------------------------------------------------- */

interface ScenarioDetail {
  /** "NOW" anchor (UTC) for the scrubber; other slices are offsets from it. */
  nowIso: string;
  /** Primary entity pills tracked across slices. */
  entities: { drifted: TimelineEntityState[]; healthyStatus: string };
  failure: string;
}

const DETAILS: Record<Exclude<ScenarioId, "INC-4092">, ScenarioDetail> = {
  "INC-4099": {
    nowIso: "2026-10-26T07:38:00.000Z",
    entities: {
      drifted: [
        ent("0x87D1FDE8", "BitLocker conflict", "critical"),
        ent("Fabrikam-Legacy-BitLocker-DeviceConfig", "conflicting", "warning"),
        ent("SG-Fabrikam-Win11-Devices", "NonCompliant", "critical"),
        ent("AADSTS53000", "blocked", "critical"),
      ],
      healthyStatus: "compliant",
    },
    failure: "First failure: devices report 0x87D1FDE8 and AADSTS53000 blocks Office 365 for NonCompliant devices.",
  },
  "ANOM-LIC-101": {
    nowIso: "2026-10-26T06:23:00.000Z",
    entities: {
      drifted: [
        ent("SPE_E5", "CountViolation", "critical", "SPE_E5 pool exhausted"),
        ent("CountViolation", "2 users", "critical"),
        ent("SPE_E5-orphaned-seats", "orphaned", "warning", "Seats held by disabled accounts"),
      ],
      healthyStatus: "available",
    },
    failure: "First failure: group-based licensing reports CountViolation for SPE_E5.",
  },
  "ANOM-CA-204": {
    nowIso: "2026-10-26T06:18:00.000Z",
    entities: {
      drifted: [
        ent("CA-001-Require-PhishingResistant-MFA-Admins", "exclusion missing", "critical"),
        ent("CA-004-Block-Legacy-Auth", "Report-Only", "warning"),
        ent("SG-BreakGlass", "not excluded", "critical"),
      ],
      healthyStatus: "in sync",
    },
    failure: "First failure: legacy IMAP/SMTP sign-ins pass while CA-004-Block-Legacy-Auth is Report-Only.",
  },
  "ANOM-APP-401": {
    nowIso: "2026-10-26T06:10:00.000Z",
    entities: {
      drifted: [
        ent("AADSTS7000222", "nightly failures", "critical", "Expired client secret"),
        ent("spn-contoso-erp-sync", "overprivileged", "critical", "Shadow-admin owner, excess Graph scopes"),
        ent("Directory.ReadWrite.All", "granted ≠ required", "warning"),
      ],
      healthyStatus: "in sync",
    },
    failure: "First failure: nightly GitHub Actions token requests fail with AADSTS7000222 (expired secret).",
  },
  "ANOM-INT-309": {
    nowIso: "2026-10-26T05:58:00.000Z",
    entities: {
      drifted: [
        ent("9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2", "Audit ≠ Block", "critical", "ASR LSASS rule weakened"),
        ent("Win11-Firewall-MDM", "duplicate", "warning"),
        ent("SG-All-Workstations", "Conflict", "critical"),
      ],
      healthyStatus: "in sync",
    },
    failure: "First failure: devices in SG-All-Workstations report Conflict on EnableFirewall.",
  },
};

function genericTimeline(entry: ScenarioRegistryEntry, detail: ScenarioDetail): ScenarioTimeline {
  const primary = entry.components[0]!;
  const failureCard = entry.components.includes("EntraSignInTimeline") ? "EntraSignInTimeline" : primary;
  const scope = entry.remediationScope;
  const healthyEntities = detail.entities.drifted.map((e) => ent(e.id, detail.entities.healthyStatus, "healthy"));
  return buildTimeline(entry, detail.nowIso, [
    {
      kind: "baseline", label: "Healthy Baseline", relativeLabel: "T-18m", offsetMinutes: -18,
      health: "healthy", summary: `Healthy baseline: ${entry.title} — no drift against ${scope}.`,
      changedCardId: null, entities: healthyEntities,
    },
    {
      kind: "drift", label: "Drift Detected", relativeLabel: "T-14m", offsetMinutes: -14,
      health: "warning", summary: `Drift detected: ${scope} no longer matches the expected state.`,
      changedCardId: primary, entities: detail.entities.drifted,
    },
    {
      kind: "first-failure", label: "First Failure", relativeLabel: "T-06m", offsetMinutes: -6,
      health: "critical", summary: detail.failure,
      changedCardId: failureCard, entities: detail.entities.drifted,
    },
    {
      kind: "now", label: "Active Incident", relativeLabel: "NOW", offsetMinutes: 0,
      health: "critical", summary: `Active: ${entry.title} — remediation scope: ${scope}.`,
      changedCardId: primary, entities: detail.entities.drifted,
    },
    {
      kind: "counterfactual", label: "Counterfactual Post-Remediation", relativeLabel: "T+Fix", offsetMinutes: 8,
      health: "healthy", summary: `Post-remediation (counterfactual): ${scope} reconciled; all tracked entities healthy.`,
      changedCardId: primary, entities: healthyEntities,
    },
  ]);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

const TIMELINES = new Map<ScenarioId, ScenarioTimeline>(
  (Object.values(SCENARIO_REGISTRY) as ScenarioRegistryEntry[]).map((entry) => [
    entry.scenarioId,
    entry.scenarioId === "INC-4092" ? inc4092(entry) : genericTimeline(entry, DETAILS[entry.scenarioId as Exclude<ScenarioId, "INC-4092">]),
  ]),
);

/**
 * Timeline for a scenario, or null for an unknown scenario id.
 * Returns a fresh copy on every call so callers may mutate their copy.
 */
export function getTimeline(scenarioId: ScenarioId): ScenarioTimeline;
export function getTimeline(scenarioId: string | null | undefined): ScenarioTimeline | null;
export function getTimeline(scenarioId: string | null | undefined): ScenarioTimeline | null {
  if (!scenarioId) return null;
  if (isScenarioId(scenarioId)) {
    const timeline = TIMELINES.get(scenarioId);
    return timeline ? structuredClone(timeline) : null;
  }
  const custom = getCustomScenario(scenarioId);
  if (!custom) return null;
  if (custom.baseScenarioId && isScenarioId(custom.baseScenarioId)) {
    const base = TIMELINES.get(custom.baseScenarioId);
    if (base) {
      const cloned = structuredClone(base);
      return {
        ...cloned,
        scenarioId: custom.scenarioId,
        title: custom.title,
        slices: cloned.slices.map((s) => ({
          ...s,
          scenarioId: custom.scenarioId,
          id: s.id.replace(custom.baseScenarioId!.toLowerCase(), custom.scenarioId.toLowerCase()),
        })),
      };
    }
  }
  const entryLike: ScenarioRegistryEntry = {
    scenarioId: custom.scenarioId as ScenarioId,
    kind: "ticket",
    tenantId: custom.tenantId,
    title: custom.title,
    components: custom.components,
    remediationScope: custom.remediationScope,
  };
  const driftedEntities: TimelineEntityState[] = custom.extraction.entities.slice(0, 4).map((e) =>
    ent(e.resolvedTo ?? e.id, "drifted", e.type === "errorCode" ? "critical" : "warning", e.label),
  );
  if (driftedEntities.length === 0) {
    driftedEntities.push(ent(custom.scenarioId, "active", "critical", custom.title));
  }
  return genericTimeline(entryLike, {
    nowIso: custom.createdAt || "2026-10-26T08:00:00.000Z",
    entities: { drifted: driftedEntities, healthyStatus: "compliant" },
    failure: `Active incident: ${custom.title}.`,
  });
}

/** Just the slices of a scenario (empty for an unknown scenario id). */
export function getTimelineSlices(scenarioId: string | null | undefined): TimelineSlice[] {
  return getTimeline(scenarioId)?.slices ?? [];
}
