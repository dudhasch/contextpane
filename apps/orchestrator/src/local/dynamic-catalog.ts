import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ElementRoutingDecisionSchema, SynthesizedDynamicCardSchema, parseToolArguments, zodToToolParameters, type ElementRoutingDecision, type MissingElementSpec, type OpenAIFunctionTool, type SynthesizedDynamicCard } from "@contextpane/catalog";
import { config, models, providers } from "../config.ts";
import { chatWithForcedTool } from "../router/openai.ts";

export interface DynamicCatalogEntry {
  elementId: string; title: string; domain: SynthesizedDynamicCard["domain"]; reason: string;
  requiredPrimitives: SynthesizedDynamicCard["requiredPrimitives"]; createdAt: string; lastUsedAt: string;
  reuseCount: number; gatekeeperModel: string; synthesizerModel: string; tsxStubPath: string; cardTemplate: SynthesizedDynamicCard;
}
export interface DynamicCatalogStore { version: "1.0"; builtInElements: string[]; dynamicElements: DynamicCatalogEntry[]; elements?: DynamicCatalogEntry[] }
export interface SynthesizedElementAuditRecord {
  id: string; timestamp: string; triggerTicketId: string; ticketPrompt: string; elementId: string; title: string; domain: string;
  gatekeeperModel: string; modelUsed: string; latencyMs: number; tokens: { prompt: number; completion: number; total: number };
  reusedFromCatalog: boolean; reuseCount: number; tsxStubPath: string; schemaSpec: { requiredPrimitives: string[]; blockKinds: string[] };
}

const DYNAMIC_CATALOG_PATH = join(config.dataDir, "dynamic-catalog.json");
const SYNTHESIZED_LOG_PATH = join(config.dataDir, "synthesized-elements-log.json");
const SYNTHESIZED_TSX_DIR = join(config.dataDir, "synthesized-elements");
const STATIC_BUILT_IN_CARDS = ["LicenseDriftCard", "EntraSignInTimeline", "IntuneDriftCard", "IaCDriftBanner"] as const;

function ensureDataDirs(): void {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(SYNTHESIZED_TSX_DIR, { recursive: true });
}

export function loadDynamicCatalog(): DynamicCatalogStore {
  ensureDataDirs();
  if (existsSync(DYNAMIC_CATALOG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(DYNAMIC_CATALOG_PATH, "utf8")) as Partial<DynamicCatalogStore>;
      const list = Array.isArray(raw.dynamicElements) ? raw.dynamicElements : Array.isArray(raw.elements) ? raw.elements : [];
      return { version: "1.0", builtInElements: [...STATIC_BUILT_IN_CARDS], dynamicElements: list };
    } catch { /* recreate below */ }
  }
  const initial: DynamicCatalogStore = { version: "1.0", builtInElements: [...STATIC_BUILT_IN_CARDS], dynamicElements: [] };
  writeFileSync(DYNAMIC_CATALOG_PATH, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  return initial;
}

export function saveDynamicCatalog(store: DynamicCatalogStore): void {
  ensureDataDirs();
  writeFileSync(DYNAMIC_CATALOG_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function loadSynthesizedElementsLog(): SynthesizedElementAuditRecord[] {
  ensureDataDirs();
  if (existsSync(SYNTHESIZED_LOG_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(SYNTHESIZED_LOG_PATH, "utf8"));
      if (Array.isArray(parsed)) return parsed as SynthesizedElementAuditRecord[];
    } catch { /* ignore */ }
  }
  return [];
}

export function appendSynthesizedElementLog(record: SynthesizedElementAuditRecord): void {
  const current = loadSynthesizedElementsLog();
  current.unshift(record);
  writeFileSync(SYNTHESIZED_LOG_PATH, `${JSON.stringify(current.slice(0, 100), null, 2)}\n`, "utf8");
}

export function clearSynthesizedElements(): { clearedElements: number; clearedLogs: number } {
  ensureDataDirs();
  const catalog = loadDynamicCatalog();
  const logs = loadSynthesizedElementsLog();
  saveDynamicCatalog({ version: "1.0", builtInElements: [...STATIC_BUILT_IN_CARDS], dynamicElements: [] });
  writeFileSync(SYNTHESIZED_LOG_PATH, "[]\n", "utf8");
  try { rmSync(SYNTHESIZED_TSX_DIR, { recursive: true, force: true }); mkdirSync(SYNTHESIZED_TSX_DIR, { recursive: true }); } catch { /* ignore */ }
  return { clearedElements: catalog.dynamicElements.length, clearedLogs: logs.length };
}

export function generateTsxStubSource(card: SynthesizedDynamicCard): string {
  const safeName = card.elementId.replace(/[^A-Za-z0-9_]/g, "") || "SynthesizedCard";
  return `import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";\nexport const ${safeName}PropsSchema = SynthesizedDynamicCardSchema;\nexport const DEFAULT_${safeName.toUpperCase()}_SPEC: SynthesizedDynamicCard = ${JSON.stringify(card, null, 2)};\n`;
}

function writeTsxStub(card: SynthesizedDynamicCard): string {
  ensureDataDirs();
  const fileName = `${card.elementId.replace(/[^A-Za-z0-9_-]/g, "") || "SynthesizedCard"}.tsx`;
  const relPath = `data/synthesized-elements/${fileName}`;
  writeFileSync(join(SYNTHESIZED_TSX_DIR, fileName), generateTsxStubSource(card), "utf8");
  return relPath;
}

const ASSESS_ELEMENT_NEEDS_TOOL: OpenAIFunctionTool = {
  type: "function",
  function: {
    name: "emit_element_routing_decision",
    description: "Assess whether a net-new UI element (status='element_not_existent') must be synthesized by muse-wonder-1.0.",
    parameters: zodToToolParameters(ElementRoutingDecisionSchema),
  },
};

const SYNTHESIZE_DYNAMIC_CARD_TOOL: OpenAIFunctionTool = {
  type: "function",
  function: {
    name: "emit_synthesized_dynamic_card",
    description: "Synthesize a bespoke SynthesizedDynamicCard tailored to the ticket and clarified answers.",
    parameters: {
      type: "object",
      required: ["elementId", "title", "headline", "domain", "state", "gauges", "policyHops", "tableTitle", "columns", "rows", "diffTitle", "diffFilePath", "diffLanguage", "diff", "events", "recommendedActions"],
      properties: {
        elementId: { type: "string" },
        title: { type: "string" },
        headline: { type: "string" },
        domain: { type: "string", enum: ["azure", "identity", "intune", "licensing", "network", "cloud-status"] },
        state: { type: "string", enum: ["critical", "warning", "healthy"] },
        gauges: { type: "array", items: { type: "object", required: ["id", "label", "used", "limit", "unit", "status"], properties: { id: { type: "string" }, label: { type: "string" }, used: { type: "number" }, limit: { type: "number" }, unit: { type: "string" }, status: { type: "string", enum: ["critical", "warning", "healthy"] }, detail: { type: "string" } } } },
        policyHops: { type: "array", items: { type: "object", required: ["step", "node", "effect", "code", "detail"], properties: { step: { type: "string" }, node: { type: "string" }, effect: { type: "string", enum: ["Allow", "Audit", "Deny", "Pass"] }, code: { type: "string" }, detail: { type: "string" } } } },
        tableTitle: { type: "string" },
        columns: { type: "array", items: { type: "object", required: ["key", "label", "mono"], properties: { key: { type: "string" }, label: { type: "string" }, mono: { type: "boolean" } } } },
        rows: { type: "array", description: "3-5 rows matching column keys", items: { type: "object" } },
        diffTitle: { type: "string" },
        diffFilePath: { type: "string" },
        diffLanguage: { type: "string", enum: ["bicep", "terraform", "arm-json", "powershell", "json"] },
        diff: { type: "string", description: "Unified diff (- old / + new) showing the exact PowerShell/CLI/IaC fix" },
        events: { type: "array", items: { type: "object", required: ["id", "timestamp", "operation", "status", "code", "caller", "detail"], properties: { id: { type: "string" }, timestamp: { type: "string" }, operation: { type: "string" }, status: { type: "string", enum: ["Failed", "Succeeded", "Warning"] }, code: { type: "string" }, caller: { type: "string" }, detail: { type: "string" } } } },
        recommendedActions: { type: "array", items: { type: "object", required: ["id", "label", "description", "command", "kind"], properties: { id: { type: "string" }, label: { type: "string" }, description: { type: "string" }, command: { type: "string" }, kind: { type: "string", enum: ["stage-fix", "view-diff", "inspect"] } } } },
      },
    },
  },
};

/** Cut at the last word boundary before `max` and mark the cut, so fallback titles never end mid-word. */
export function truncateAtWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:·-]+$/, "")}…`;
}

function pascalIdFromTitle(title: string): string {
  const words = title.replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
  return `${words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("") || "CustomDiagnostic"}Card`;
}

export function buildDeterministicRoutingDecision(input: { title: string; body: string; matchedSeededComponents: string[] }): ElementRoutingDecision {
  const cleanTitle = input.title.trim() || "Custom Cloud Diagnostic";
  return {
    matchedExistingElements: [],
    missingElements: [
      {
        status: "element_not_existent",
        elementId: pascalIdFromTitle(cleanTitle),
        title: truncateAtWord(cleanTitle, 80),
        domain: "azure",
        reason: `Ticket "${truncateAtWord(cleanTitle, 80)}" requires a bespoke diagnostic and remediation card.`,
        requiredPrimitives: ["policy-chain", "data-table", "config-diff", "event-stream"],
      },
    ],
    extractedEntities: [],
    customBrief: {
      summary: `Analyzing "${cleanTitle}" (${input.body.slice(0, 140)}) and synthesizing a targeted diagnostic and remediation plan.`,
      steps: [
        { title: "Inspect Control-Plane State", detail: `Query live resource and policy state for "${cleanTitle}".`, category: "azure", actionLabel: "Inspect State" },
        { title: "Review Synthesized Remediation Diff", detail: "Inspect the generated PowerShell 7 and IaC changes.", category: "azure", actionLabel: "Open Diff" },
        { title: "Verify & Stage Fix", detail: "Run pre-flight checks and stage the remediation bundle.", category: "azure", actionLabel: "Stage Fix" },
      ],
    },
  };
}

export async function assessTicketElementNeeds(input: {
  title: string;
  body: string;
  matchedSeededComponents: string[];
  clarifiedAnswers?: Record<string, string>;
}): Promise<{ decision: ElementRoutingDecision; modelUsed: string; latencyMs: number; tokensUsed?: number; source?: "llm" | "fallback-on-error" }> {
  const started = performance.now();
  const fallback = buildDeterministicRoutingDecision(input);
  const gatekeeperModel = models.metaCatalog;
  if (providers.meta.hasKey && !config.forceLocal && process.env.NODE_ENV !== "test") {
    try {
      const res = await chatWithForcedTool(
        providers.meta,
        gatekeeperModel,
        [
          {
            role: "system",
            content:
              "You are ContextPane's Stage-1 Catalog Gatekeeper (muse-spark-1.3). " +
              "For any custom or unscripted ticket, set matchedExistingElements to [] and emit 1 missingElements entry with status='element_not_existent', a descriptive PascalCase elementId, extractedEntities from the ticket text, and a specific customBrief (summary + 3 actionable resolution steps with exact PowerShell/CLI cmdlets matching the user's ticket and clarifiedAnswers).",
          },
          { role: "user", content: JSON.stringify({ ticketTitle: input.title, ticketBody: input.body, clarifiedAnswers: input.clarifiedAnswers ?? {} }) },
        ],
        ASSESS_ELEMENT_NEEDS_TOOL,
        { timeoutMs: 10000, temperature: 0.1, maxTokens: 2000, reasoningEffort: "low" },
      );
      const parsed = ElementRoutingDecisionSchema.safeParse(parseToolArguments(res.argumentsRaw));
      if (parsed.success && parsed.data.missingElements.length > 0) {
        return {
          decision: { ...parsed.data, matchedExistingElements: [] },
          modelUsed: gatekeeperModel,
          latencyMs: Math.max(1, Math.round(performance.now() - started)),
          tokensUsed: res.usage.total,
          source: "llm",
        };
      }
    } catch {
      /* fallback below */
    }
  }
  return {
    decision: fallback,
    modelUsed: gatekeeperModel,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    tokensUsed: 0,
    source: "fallback-on-error",
  };
}

function buildMinimalFallbackCard(missing: MissingElementSpec, gatekeeperModel: string, synthesizerModel: string, latencyMs: number): SynthesizedDynamicCard {
  const nowIso = new Date().toISOString();
  const tsxStubPath = `data/synthesized-elements/${missing.elementId.replace(/[^A-Za-z0-9_-]/g, "")}.tsx`;
  return {
    elementId: missing.elementId,
    title: missing.title,
    headline: missing.reason.slice(0, 220),
    domain: missing.domain,
    reason: missing.reason.slice(0, 300),
    state: "warning",
    requiredPrimitives: ["policy-chain", "data-table", "config-diff", "event-stream"],
    blocks: [
      { kind: "quota-gauges", title: "Resource Utilization", gauges: [{ id: "g1", label: "Ticket state", used: 1, limit: 1, unit: "state", status: "warning" }] },
      { kind: "policy-chain", title: "Evaluation Chain", hops: [{ step: "Step 1 · Control-Plane Check", node: truncateAtWord(missing.title, 60), effect: "Audit", code: "DiagnosticCheck", detail: missing.reason }] },
      { kind: "data-table", title: "Posture", columns: [{ key: "item", label: "Target", mono: false }, { key: "state", label: "Observed State", mono: false }], rows: [{ item: "Control-plane check", state: truncateAtWord(missing.reason, 120) }] },
      { kind: "config-diff", title: "Remediation Diff", filePath: "remediation.ps1", language: "powershell", diff: "- # Current state\n+ Get-AzResource -WhatIf" },
      { kind: "event-stream", title: "Activity & Audit Log", events: [{ id: "ev1", timestamp: nowIso, operation: "Control-plane check", status: "Warning", code: "DiagnosticEvent", caller: "ControlPlane", detail: truncateAtWord(missing.reason, 160) }] },
    ],
    recommendedActions: [{ id: "stage-fix", label: "Stage Remediation Fix", description: missing.reason.slice(0, 140), command: "Get-AzResource -WhatIf", kind: "stage-fix" }],
    synthesisMeta: { gatekeeperModel, synthesizerModel, latencyMs, reusedFromCatalog: false, reuseCount: 1, tsxStubPath, synthesizedAt: nowIso },
    sourceRef: { file: tsxStubPath, startLine: 1, endLine: 12, ref: "dynamic-catalog" },
  };
}

export function synthesizeAndPersistMissingElementsSync(input: { ticketId: string; ticketPrompt: string; decision: ElementRoutingDecision; gatekeeperModel?: string }): SynthesizedDynamicCard[] {
  const started = performance.now();
  const store = loadDynamicCatalog();
  const nowIso = new Date().toISOString();
  const cards = input.decision.missingElements.map((m) => {
    const tCard = performance.now();
    const card = buildMinimalFallbackCard(m, input.gatekeeperModel ?? models.metaCatalog, models.metaWonder, Math.max(1, Math.round(performance.now() - tCard)));
    const tsxPath = writeTsxStub(card);
    card.synthesisMeta.tsxStubPath = tsxPath;
    card.synthesisMeta.latencyMs = Math.max(1, Math.round(performance.now() - started));
    store.dynamicElements.push({ elementId: card.elementId, title: card.title, domain: card.domain, reason: card.reason, requiredPrimitives: card.requiredPrimitives, createdAt: nowIso, lastUsedAt: nowIso, reuseCount: 1, gatekeeperModel: input.gatekeeperModel ?? models.metaCatalog, synthesizerModel: models.metaWonder, tsxStubPath: tsxPath, cardTemplate: card });
    return card;
  });
  saveDynamicCatalog(store);
  return cards;
}

export async function synthesizeAndPersistMissingElements(input: {
  ticketId: string;
  ticketPrompt: string;
  decision: ElementRoutingDecision;
  gatekeeperModel: string;
  clarifiedAnswers?: Record<string, string>;
}): Promise<SynthesizedDynamicCard[]> {
  if (input.decision.missingElements.length === 0) return [];
  const store = loadDynamicCatalog();
  const results: SynthesizedDynamicCard[] = [];
  const synthesizerModel = models.metaWonder;

  for (const missing of input.decision.missingElements) {
    const started = performance.now();
    let card: SynthesizedDynamicCard | null = null;
    let tokens = { prompt: 0, completion: 0, total: 0 };
    if (providers.meta.hasKey && !config.forceLocal && process.env.NODE_ENV !== "test") {
      try {
        const res = await chatWithForcedTool(
          providers.meta,
          synthesizerModel,
          [
            {
              role: "system",
              content:
                "You are Sub-Agent 3 (UI Architect · muse-wonder-1.0) in ContextPane. " +
                "Synthesize a schema-valid SynthesizedDynamicCard JSON specification from scratch for the operator's ticket and clarifiedAnswers. " +
                "Include domain-accurate blocks (3 gauges, 3-4 policyHops, 3 table rows, a concise 12-line PowerShell/CLI/IaC diff, 3 events, and 2 recommendedActions) with real PowerShell 7 / Azure CLI / Graph commands matching the chosen resolution strategy.",
            },
            { role: "user", content: JSON.stringify({ ticketPrompt: input.ticketPrompt, clarifiedAnswers: input.clarifiedAnswers ?? {}, missingElement: missing, customBrief: input.decision.customBrief }) },
          ],
          SYNTHESIZE_DYNAMIC_CARD_TOOL,
          { timeoutMs: 35000, temperature: 0.1, maxTokens: 4096, reasoningEffort: "low" },
        );
        tokens = res.usage;
        const raw = parseToolArguments(res.argumentsRaw) as Record<string, any>;
        const nowIso = new Date().toISOString();
        const stub = `data/synthesized-elements/${missing.elementId.replace(/[^A-Za-z0-9_-]/g, "")}.tsx`;
        const cleanRows = Array.isArray(raw.rows) ? raw.rows.slice(0, 12).map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, typeof v === "number" || typeof v === "boolean" ? v : String(v ?? "")]))) : [];
        const candidate = {
          elementId: String(raw.elementId || missing.elementId),
          title: String(raw.title || missing.title),
          headline: String(raw.headline || missing.reason).slice(0, 240),
          domain: ["azure", "identity", "intune", "licensing", "network", "cloud-status"].includes(raw.domain) ? raw.domain : missing.domain,
          reason: missing.reason.slice(0, 320),
          state: ["critical", "warning", "healthy"].includes(raw.state) ? raw.state : "warning",
          requiredPrimitives: ["quota-gauges", "policy-chain", "data-table", "config-diff", "event-stream"],
          blocks: [
            ...(Array.isArray(raw.gauges) && raw.gauges.length > 0 ? [{ kind: "quota-gauges", title: `${raw.title || missing.title} · Resource & State Metrics`, gauges: raw.gauges.slice(0, 6).map((g: any, i: number) => ({ id: String(g.id || `g-${i}`), label: String(g.label || "Metric"), used: Math.max(0, Number(g.used) || 0), limit: Math.max(1, Number(g.limit) || 1), unit: String(g.unit || "items"), status: ["critical", "warning", "healthy"].includes(g.status) ? g.status : "warning", ...(g.detail ? { detail: String(g.detail) } : {}) })) }] : []),
            ...(Array.isArray(raw.policyHops) && raw.policyHops.length > 0 ? [{ kind: "policy-chain", title: `${raw.title || missing.title} · Control-Plane Evaluation Chain`, hops: raw.policyHops.slice(0, 6).map((h: any, i: number) => ({ step: String(h.step || `Step ${i + 1}`), node: String(h.node || missing.title), effect: ["Allow", "Audit", "Deny", "Pass"].includes(h.effect) ? h.effect : "Deny", code: String(h.code || "Evaluation"), detail: String(h.detail || missing.reason) })) }] : []),
            ...(Array.isArray(raw.columns) && raw.columns.length > 0 ? [{ kind: "data-table", title: String(raw.tableTitle || `${raw.title || missing.title} · Affected Objects`), columns: raw.columns.slice(0, 6).map((c: any) => ({ key: String(c.key || "item"), label: String(c.label || "Item"), mono: Boolean(c.mono) })), rows: cleanRows }] : []),
            ...(raw.diff ? [{ kind: "config-diff", title: String(raw.diffTitle || `${raw.title || missing.title} · Remediation Script & Diff`), filePath: String(raw.diffFilePath || "remediation.ps1"), language: ["bicep", "terraform", "arm-json", "powershell", "json"].includes(raw.diffLanguage) ? raw.diffLanguage : "powershell", diff: String(raw.diff) }] : []),
            ...(Array.isArray(raw.events) && raw.events.length > 0 ? [{ kind: "event-stream", title: `${raw.title || missing.title} · Audit & Activity Log`, events: raw.events.slice(0, 8).map((ev: any, i: number) => ({ id: String(ev.id || `ev-${i}`), timestamp: String(ev.timestamp || nowIso), operation: String(ev.operation || "Operation"), status: ["Failed", "Succeeded", "Warning"].includes(ev.status) ? ev.status : "Failed", code: String(ev.code || "Error"), caller: String(ev.caller || "operator"), detail: String(ev.detail || missing.reason) })) }] : []),
          ],
          recommendedActions: Array.isArray(raw.recommendedActions) && raw.recommendedActions.length > 0 ? raw.recommendedActions.slice(0, 4).map((a: any, i: number) => ({ id: String(a.id || `act-${i}`), label: String(a.label || "Stage Remediation Fix"), description: String(a.description || ""), command: String(a.command || ""), kind: ["stage-fix", "view-diff", "inspect"].includes(a.kind) ? a.kind : "stage-fix" })) : [],
          synthesisMeta: { gatekeeperModel: input.gatekeeperModel, synthesizerModel, latencyMs: 100, reusedFromCatalog: false, reuseCount: 1, tsxStubPath: stub, synthesizedAt: nowIso },
          sourceRef: { file: stub, startLine: 1, endLine: 12, ref: "dynamic-catalog" },
        };
        const parsed = SynthesizedDynamicCardSchema.safeParse(candidate);
        if (parsed.success && parsed.data.blocks.length >= 2) card = parsed.data;
      } catch {
        /* fallback below */
      }
    }
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    if (!card) card = buildMinimalFallbackCard(missing, input.gatekeeperModel, synthesizerModel, latencyMs);
    const tsxPath = writeTsxStub(card);
    const nowIso = new Date().toISOString();
    card.synthesisMeta = { gatekeeperModel: input.gatekeeperModel, synthesizerModel, latencyMs, reusedFromCatalog: false, reuseCount: 1, tsxStubPath: tsxPath, synthesizedAt: nowIso };
    const existingIdx = store.dynamicElements.findIndex((e) => e.elementId === card!.elementId);
    const entry: DynamicCatalogEntry = { elementId: card.elementId, title: card.title, domain: card.domain, reason: card.reason, requiredPrimitives: card.requiredPrimitives, createdAt: existingIdx >= 0 ? store.dynamicElements[existingIdx]!.createdAt : nowIso, lastUsedAt: nowIso, reuseCount: existingIdx >= 0 ? store.dynamicElements[existingIdx]!.reuseCount + 1 : 1, gatekeeperModel: input.gatekeeperModel, synthesizerModel, tsxStubPath: tsxPath, cardTemplate: card };
    if (existingIdx >= 0) store.dynamicElements[existingIdx] = entry;
    else store.dynamicElements.push(entry);
    saveDynamicCatalog(store);
    appendSynthesizedElementLog({ id: `syn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, timestamp: nowIso, triggerTicketId: input.ticketId, ticketPrompt: input.ticketPrompt.slice(0, 300), elementId: card.elementId, title: card.title, domain: card.domain, gatekeeperModel: input.gatekeeperModel, modelUsed: synthesizerModel, latencyMs, tokens, reusedFromCatalog: false, reuseCount: entry.reuseCount, tsxStubPath: tsxPath, schemaSpec: { requiredPrimitives: card.requiredPrimitives, blockKinds: card.blocks.map((b) => b.kind) } });
    results.push(card);
  }
  return results;
}
