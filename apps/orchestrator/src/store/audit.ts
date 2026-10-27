import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuditEntrySchema, type AuditEntry } from "@contextpane/catalog";
import { config } from "../config.ts";
import { workbenchEvents } from "../events.ts";

/**
 * Tier 3 verifiable audit ledger: every pre-flight verification, HITL decision
 * and demo reset, appended to data/audit-log.json (newest last) and broadcast to
 * the workbench. Entries never hold a secret or a token.
 */
class AuditLedger {
  private file = join(config.dataDir, "audit-log.json");
  private entries: AuditEntry[] | null = null;
  private seq = 0;

  private isTestEnv(): boolean {
    return process.env.NODE_ENV === "test" || Boolean(process.env.BUN_TEST);
  }

  private load(): AuditEntry[] {
    if (this.entries) return this.entries;
    this.entries = [];
    if (this.isTestEnv() || !existsSync(this.file)) return this.entries;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { entries?: unknown[] };
      for (const e of raw.entries ?? []) {
        const parsed = AuditEntrySchema.safeParse(e);
        if (parsed.success) this.entries.push(parsed.data);
      }
    } catch (error) {
      console.warn(`[audit] ignoring unreadable ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return this.entries;
  }

  append(input: Omit<AuditEntry, "id" | "timestamp" | "detail" | "execution" | "executionMode"> & Partial<Pick<AuditEntry, "detail" | "execution" | "executionMode">>): AuditEntry {
    const entries = this.load();
    this.seq += 1;
    const entry = AuditEntrySchema.parse({
      ...input,
      id: `aud-${Date.now().toString(36)}-${this.seq.toString(36)}`,
      timestamp: new Date().toISOString(),
    });
    entries.push(entry);
    if (entries.length > 500) entries.splice(0, entries.length - 500);
    if (!this.isTestEnv()) {
      try {
        mkdirSync(config.dataDir, { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2) + "\n", "utf8");
        renameSync(tmp, this.file);
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

  path(): string {
    return this.file;
  }
}

export const auditLedger = new AuditLedger();
