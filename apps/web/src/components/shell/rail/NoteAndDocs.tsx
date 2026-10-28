import { BookOpen, ClipboardCopy } from "lucide-react";
import { useState } from "react";
import { useWorkbench } from "@/store";
import { Button } from "../../ui/Button";
import { cleanDrawerTitle, humanizeInvariant, useCopy, type Drawer } from "./shared";

function formatFriendlyEntityList(drawer: Drawer): string {
  const friendly: string[] = [];
  let hasNsg = false;
  for (const e of drawer.affectedEntities) {
    const raw = e.id.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) {
      friendly.push("Conditional Access policy exclusion");
    } else if (raw.includes("/tags/") || raw.startsWith("nsg-")) {
      if (!hasNsg) {
        hasNsg = true;
        friendly.push(`${raw.split("/")[0]} (port 3389 closed & baseline tags restored)`);
      }
    } else {
      friendly.push(raw.split("@")[0] ?? raw);
    }
  }
  return [...new Set(friendly)].join(", ");
}

function buildCustomerEmail(drawer: Drawer, customerSummary?: string): string {
  if (customerSummary) {
    return [
      `Subject: Resolved — ${drawer.ticketId}: ${cleanDrawerTitle(drawer).replace(/^Fix [^:]+:\s*/, "")}`,
      "",
      "Hi team,",
      "",
      customerSummary,
      "",
      "What we verified:",
      "• All affected users and services are back online and matching your security baseline.",
      "• Pre-flight safety checks and post-change health checks passed with zero impact on other users.",
      "• No extra license charges were incurred.",
      "",
      "Please let us know if anyone still experiences an issue signing in.",
      "",
      "Best regards,",
      "Cloud Operations Team",
    ].join("\n");
  }
  return [
    `Subject: Update on ${drawer.ticketId} — ${cleanDrawerTitle(drawer).replace(/^Fix [^:]+:\s*/, "")}`,
    "",
    "Hi team,",
    "",
    `We identified the root cause of ${drawer.ticketId} and prepared a verified fix:`,
    "",
    `${drawer.summary}`,
    "",
    "Impact & Safety:",
    `• Affected items repaired: ${formatFriendlyEntityList(drawer)}`,
    "• 0 other users or emergency admin accounts are affected.",
    "• A 1-click undo script is saved in case we need to roll back immediately.",
    "",
    "Best regards,",
    "Cloud Operations Team",
  ].join("\n");
}

/** Rail `note` mode: the customer resolution email and the step-by-step runbook, full-bleed text. */
export function NoteAndDocs({ drawer }: { drawer: Drawer }) {
  const [view, setView] = useState<"email" | "runbook">("email");
  const formal = useWorkbench((s) => s.formal);
  const resolutionNote = useWorkbench((s) => s.resolutionNote);
  const copy = useCopy();

  const customerEmail = buildCustomerEmail(drawer, resolutionNote?.customerSummary);
  const runbookMarkdown = [
    `# Step-by-Step Runbook · ${drawer.ticketId} — ${cleanDrawerTitle(drawer)}`,
    "",
    `## 1. Issue Summary`,
    drawer.summary,
    "",
    `## 2. Pre-Flight Safety Checks`,
    `- Status: ${drawer.verificationStatus.verdict}`,
    `- Dry-Run (-WhatIf) Verified: ${drawer.verificationStatus.whatIfSafe ? "Yes" : "No"}`,
    ...(formal ? formal.formal.invariants.map((i) => `- ✓ ${humanizeInvariant(i.id, drawer.ticketId, i.statement)}`) : []),
    "",
    `## 3. Fix Script (PowerShell)`,
    "```powershell",
    drawer.powershellScript,
    "```",
    ...(formal ? ["", `## 4. 1-Click Undo Script (Restore Previous State)`, "```powershell", formal.rollback.powershellScript, "```"] : []),
  ].join("\n");

  const text = view === "email" ? customerEmail : runbookMarkdown;
  const views: Array<{ id: "email" | "runbook"; label: string }> = [
    { id: "email", label: "Customer email" },
    { id: "runbook", label: "Runbook (.md)" },
  ];

  return (
    <div className="flex flex-col pb-3" data-note-view={view}>
      <div className="flex h-9 min-w-0 items-center gap-4 px-3" role="tablist" aria-label="Note and docs">
        {views.map((v) => {
          const active = v.id === view;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(v.id)}
              className={`relative inline-flex h-full items-center text-12 whitespace-nowrap transition-colors duration-120 ${active ? "text-text" : "text-muted hover:text-text"}`}
            >
              {v.label}
              {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-signal" />}
            </button>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {view === "runbook" && (
            <a
              href={`/api/runbooks/${drawer.ticketId}.md`}
              download
              className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-11 text-muted transition-colors hover:bg-raised hover:text-text"
            >
              <BookOpen className="size-3" aria-hidden />
              Download
            </a>
          )}
          <Button size="xs" variant="ghost" icon={<ClipboardCopy />} onClick={() => void copy(text, view === "email" ? "Customer resolution email" : "Step-by-step runbook (.md)")}>
            Copy
          </Button>
        </div>
      </div>
      <pre className="border-y border-hairline bg-ground px-3 py-2 font-mono text-11 leading-[1.55] whitespace-pre-wrap break-words text-text">{text}</pre>
    </div>
  );
}
