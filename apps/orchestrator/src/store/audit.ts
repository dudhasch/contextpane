import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AuditEntrySchema, type AuditChainStatus, type AuditEntry } from "@contextpane/catalog";
import { cachedTokenClaims } from "@contextpane/mcp-msgraph";
import { config, isLiveCloudMode } from "../config.ts";
import { workbenchEvents } from "../events.ts";

/**
 * Tier 3 audit ledger: every pre-flight verification, HITL decision and demo reset, appended as one
 * JSON line to data/audit-log.jsonl (newest last) and broadcast to the workbench. Entries never hold
 * a secret or a token.
 *
 * Append-only with a hash chain: each entry carries `prevHash` (the previous entry's `hash`, 64 zeros
 * for the first) and `hash`, the sha256 of its canonical JSON without `hash`. `verify()` re-hashes the
 * file end to end, so an edited, deleted or re-ordered line is reported with the id where the chain
 * breaks. This detects tampering after the fact; it does not stop someone with write access to the
 * file from rewriting the whole chain. Nothing is capped or rotated: the file only grows.
 *
 * A pre-chain data/audit-log.json (version 1, a JSON array) is migrated once on first load: its entries
 * are chained in their recorded order into the JSONL file and the old file is renamed to
 * audit-log.json.migrated.
 */
export const GENESIS_HASH = "0".repeat(64);

/** Stable JSON: object keys sorted at every level, so the hash does not depend on key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashAuditEntry(entry: Omit<AuditEntry, "hash"> | AuditEntry): string {
  const { hash: _hash, ...rest } = entry as AuditEntry;
  return createHash("sha256").update(canonical(rest)).digest("hex");
}

/** Re-hashes a chain in order; the first entry must link to GENESIS_HASH. */
export function verifyAuditChain(entries: AuditEntry[]): AuditChainStatus {
  let prev = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== prev) return { ok: false, entries: entries.length, brokenAt: entry.id, reason: "prevHash does not link to the previous entry" };
    if (entry.hash !== hashAuditEntry(entry)) return { ok: false, entries: entries.length, brokenAt: entry.id, reason: "hash does not match the entry's content" };
    prev = entry.hash;
  }
  return { ok: true, entries: entries.length };
}

/**
 * Where a recorded identity came from. Approvals and closures record the orchestrator host's signed-in
 * Graph account in live mode, else the configured lab default; neither is the person who clicked.
 */
export function identitySourceOf(identity: string): NonNullable<AuditEntry["identitySource"]> {
  if (isLiveCloudMode()) {
    const claims = cachedTokenClaims("https://graph.microsoft.com");
    const upn = claims?.upn ?? claims?.unique_name;
    if (typeof upn === "string" && upn.toLowerCase() === identity.toLowerCase()) return "host-graph-signin";
  }
  if (identity.toLowerCase() === config.lab.delegatedIdentity.toLowerCase()) return "configured-default";
  return "system";
}

type AppendInput = Omit<AuditEntry, "id" | "timestamp" | "detail" | "execution" | "executionMode" | "prevHash" | "hash" | "identitySource"> &
  Partial<Pick<AuditEntry, "detail" | "execution" | "executionMode" | "identitySource">>;

export class AuditLedger {
  private entries: AuditEntry[] | null = null;
  private seq = 0;
  private readonly file: string;
  private readonly legacyFile: string;
  private readonly persistOverride: boolean | undefined;

  constructor(options: { file?: string; persist?: boolean } = {}) {
    this.file = options.file ?? join(config.dataDir, "audit-log.jsonl");
    this.legacyFile = join(dirname(this.file), "audit-log.json");
    this.persistOverride = options.persist;
  }

  private persists(): boolean {
    if (this.persistOverride !== undefined) return this.persistOverride;
    return !(process.env.NODE_ENV === "test" || Boolean(process.env.BUN_TEST));
  }

  private parseLine(line: string): AuditEntry | null {
    try {
      const parsed = AuditEntrySchema.safeParse(JSON.parse(line));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Every line of the JSONL file, parsed; unreadable lines are kept as gaps so verify() reports them. */
  private readFile(): { entries: AuditEntry[]; badLine: number | null } {
    const entries: AuditEntry[] = [];
    let badLine: number | null = null;
    if (!existsSync(this.file)) return { entries, badLine };
    const lines = readFileSync(this.file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const entry = this.parseLine(line);
      if (entry) entries.push(entry);
      else if (badLine === null) badLine = i + 1;
    });
    return { entries, badLine };
  }

  /** Chains the entries of a pre-chain audit-log.json into the JSONL file, once. */
  private migrateLegacy(): void {
    if (existsSync(this.file) || !existsSync(this.legacyFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.legacyFile, "utf8")) as { entries?: unknown[] };
      let prev = GENESIS_HASH;
      const lines: string[] = [];
      for (const e of raw.entries ?? []) {
        const parsed = AuditEntrySchema.safeParse(e);
        if (!parsed.success) continue;
        const { hash: _h, prevHash: _p, ...rest } = parsed.data;
        const linked = { ...rest, prevHash: prev };
        const entry = { ...linked, hash: hashAuditEntry(linked) } as AuditEntry;
        lines.push(JSON.stringify(entry));
        prev = entry.hash!;
      }
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
      renameSync(this.legacyFile, `${this.legacyFile}.migrated`);
      console.log(`[audit] migrated ${lines.length} entries from ${this.legacyFile} into the hash-chained ${this.file}`);
    } catch (error) {
      console.warn(`[audit] could not migrate ${this.legacyFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private load(): AuditEntry[] {
    if (this.entries) return this.entries;
    this.entries = [];
    if (!this.persists()) return this.entries;
    this.migrateLegacy();
    this.entries = this.readFile().entries;
    return this.entries;
  }

  append(input: AppendInput): AuditEntry {
    const entries = this.load();
    this.seq += 1;
    const prevHash = entries.at(-1)?.hash ?? GENESIS_HASH;
    const draft = AuditEntrySchema.parse({
      ...input,
      identitySource: input.identitySource ?? identitySourceOf(input.delegatedIdentity),
      id: `aud-${Date.now().toString(36)}-${this.seq.toString(36)}`,
      timestamp: new Date().toISOString(),
      prevHash,
    });
    const entry: AuditEntry = { ...draft, hash: hashAuditEntry(draft) };
    entries.push(entry);
    if (this.persists()) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
      } catch (error) {
        console.warn(`[audit] persist failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    workbenchEvents.publish({ type: "audit", entry });
    return entry;
  }

  /** Newest first. */
  list(limit = 50, tenantId?: string): AuditEntry[] {
    return this.load()
      .filter((e) => !tenantId || e.tenantId === tenantId)
      .slice(-limit)
      .reverse();
  }

  /** Re-hashes the persisted chain (the in-memory one when nothing is persisted). */
  verify(): AuditChainStatus {
    this.load();
    if (!this.persists()) return verifyAuditChain(this.entries ?? []);
    const { entries, badLine } = this.readFile();
    if (badLine !== null) return { ok: false, entries: entries.length, reason: `line ${badLine} is not a valid audit entry` };
    return verifyAuditChain(entries);
  }

  path(): string {
    return this.file;
  }
}

export const auditLedger = new AuditLedger();
