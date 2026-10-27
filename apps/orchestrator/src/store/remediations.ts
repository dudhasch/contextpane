import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ActionApprovalDrawerSchema, type ActionApprovalDrawer } from "@contextpane/catalog";
import { config } from "../config.ts";

/**
 * Remediation bundles are kept in memory and mirrored to data/remediations/
 * so an approval survives an orchestrator restart during the demo.
 */
class RemediationStore {
  private dir = join(config.dataDir, "remediations");
  private items = new Map<string, ActionApprovalDrawer>();
  private loaded = false;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.dir)) return;
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith(".json"))) {
      try {
        const rawText = readFileSync(join(this.dir, file), "utf8");
        // Ignore stale cached remediations that contain legacy <... id> placeholders
        if (/<[^>\n]+ (?:id|skuId)>/.test(rawText)) continue;
        const parsed = ActionApprovalDrawerSchema.safeParse(JSON.parse(rawText));
        if (parsed.success) this.items.set(parsed.data.remediationId, parsed.data);
      } catch {
        /* ignore corrupt file */
      }
    }
  }

  save(drawer: ActionApprovalDrawer): ActionApprovalDrawer {
    this.load();
    this.items.set(drawer.remediationId, drawer);
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, `${drawer.remediationId}.json`), JSON.stringify(drawer, null, 2) + "\n", "utf8");
    } catch (error) {
      console.warn(`[remediations] persist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return drawer;
  }

  get(remediationId: string): ActionApprovalDrawer | null {
    this.load();
    return this.items.get(remediationId) ?? null;
  }

  list(tenantId?: string): ActionApprovalDrawer[] {
    this.load();
    return [...this.items.values()].filter((r) => !tenantId || r.tenantId === tenantId);
  }

  clear(scenarioId?: string) {
    this.load();
    for (const [id, item] of this.items.entries()) {
      if (!scenarioId || item.ticketId === scenarioId) {
        this.items.delete(id);
        try {
          const p = join(this.dir, `${id}.json`);
          if (existsSync(p)) unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export const remediationStore = new RemediationStore();
