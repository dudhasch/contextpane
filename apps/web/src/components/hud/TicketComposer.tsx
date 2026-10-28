import { Check, FilePlus2, MessageSquare, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClarifyingQuestion } from "@contextpane/catalog";
import { api, type SampleTicket } from "@/lib/api";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";

const FEATURED_GOAL_PRESETS: Array<{ id: string; badge: string; title: string; body: string; customerName: string }> = [
  {
    id: "preset-oidc-spn",
    badge: "OIDC Subject Mismatch",
    title: "Federated Credentials on my spn stopped working (AADSTS70021)",
    body: "Federated Credentials on my spn stopped working. Our GitHub Actions deployment workflow in contoso/erp-sync fails with AADSTS70021: No matching federated identity record found for presented assertion subject 'repo:contoso/erp-sync:environment:production'. The app registration spn-contoso-erp-sync currently only has 'repo:contoso/erp-sync:ref:refs/heads/main' configured.",
    customerName: "Contoso Finance",
  },
  {
    id: "preset-vm-quota",
    badge: "Azure VM Quota & Policy",
    title: "Deploy compliant AVD host pool / VM in westeurope",
    body: "Trying to deploy session host vm-contoso-avd-2 (Standard_D4s_v5) in westeurope for rg-contoso-avd-prod around 2pm UTC, but ARM fails with QuotaExceeded (20/20 Standard DSv5 vCPUs in westeurope) and RequestDisallowedByPolicy (Allowed-Locations-EU). Need to retarget to germanywestcentral or northeurope or stage a policy waiver.",
    customerName: "Contoso Finance",
  },
  {
    id: "preset-project-oidc",
    badge: "Project Goal",
    title: "Outline project: Migrate Contoso ERP sync to GitHub OIDC across dev/prod environments",
    body: "Project goal: Migrate spn-contoso-erp-sync away from expiring client secrets (AADSTS7000222) to passwordless GitHub Actions OIDC federated credentials across staging and production environments, remove shadow-admin contractor owner Alex Wilber, and right-size Microsoft Graph application permissions to least privilege.",
    customerName: "Contoso Finance",
  },
];

/**
 * `[+ New Ticket / Outline Project Goal]`: paste any MSP support ticket OR cloud engineering
 * project/goal, optionally click `[💬 Ask Clarifying Questions to Scope Goal]` to scope it with
 * Sub-Agent 1 (`muse-spark-1.3`), and watch the 5-task Sub-Agent pipeline synthesize the UI & IaC live.
 */
export function TicketComposer() {
  const open = useWorkbench((s) => s.composerOpen);
  const setOpen = useWorkbench((s) => s.setComposerOpen);
  const triage = useWorkbench((s) => s.triageCustom);
  const status = useWorkbench((s) => s.triageStatus);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [customer, setCustomer] = useState("");
  const [samples, setSamples] = useState<SampleTicket[]>([]);
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [clarifying, setClarifying] = useState(false);
  const [clarifierModel, setClarifierModel] = useState<string | null>(null);

  useEffect(() => {
    if (!open || samples.length) return;
    api.ticketSamples().then((r) => setSamples(r.samples)).catch(() => undefined);
  }, [open, samples.length]);

  if (!open) return null;
  const ready = title.trim().length >= 3 && body.trim().length >= 10 && status !== "loading";

  const askClarifyingQuestions = async () => {
    if (title.trim().length < 3 || body.trim().length < 5 || clarifying) return;
    setClarifying(true);
    try {
      const res = await api.clarifyQuestions({
        title: title.trim(),
        body: body.trim(),
        ...(Object.keys(answers).length > 0 ? { clarifiedAnswers: answers } : {}),
      });
      setQuestions(res.questions);
      setClarifierModel(res.modelUsed);
      const nextAnswers: Record<string, string> = { ...answers };
      for (const q of res.questions) {
        if (!nextAnswers[q.id] && (q.selectedValue || q.options[0]?.label || q.options[0]?.value)) {
          const raw = q.selectedValue ?? q.options[0]?.label ?? q.options[0]!.value;
          const matched = q.options.find(
            (o) => o.value.toLowerCase() === raw.toLowerCase() || o.id.toLowerCase() === raw.toLowerCase() || o.label.toLowerCase() === raw.toLowerCase(),
          );
          nextAnswers[q.id] = matched ? matched.label : raw;
        }
      }
      setAnswers(nextAnswers);
    } catch {
      /* ignore */
    } finally {
      setClarifying(false);
    }
  };

  const submit = async () => {
    if (!ready) return;
    await triage({
      title: title.trim(),
      body: body.trim(),
      ...(customer.trim() ? { customerName: customer.trim() } : {}),
      ...(Object.keys(answers).length > 0 ? { clarifiedAnswers: answers } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 backdrop-blur-md" onClick={() => setOpen(false)}>
      <div
        className="max-h-[92vh] w-[780px] max-w-[95vw] overflow-y-auto animate-fade-in card shadow-popover"
        onClick={(e) => e.stopPropagation()}
        data-testid="ticket-composer"
      >
        <div className="flex items-center gap-2">
          <FilePlus2 className="size-4 text-primary" />
          <span className="text-[13px] font-semibold">New Ticket / Outline Cloud Project Goal</span>
          <span className="text-[11px] text-faint">Live Tenant Triage · c4a8shili.onmicrosoft.com</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-faint hover:text-text" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 space-y-1.5">
          <span className="block text-[11px] font-medium text-muted">Featured Incident &amp; Project Goal Presets (1-click populate):</span>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {FEATURED_GOAL_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-sample={p.id}
                onClick={() => {
                  setTitle(p.title);
                  setBody(p.body);
                  setCustomer(p.customerName);
                  setQuestions([]);
                  setAnswers({});
                }}
                className="flex flex-col items-start gap-0.5 rounded-md border border-primary/35 bg-primary/8 px-2.5 py-1.5 text-left text-[11px] leading-snug transition-colors hover:border-primary hover:bg-primary/14"
                title={p.body}
              >
                <span className="font-mono text-[9.5px] font-semibold tracking-wider text-primary uppercase">{p.badge}</span>
                <span className="font-medium text-text">{p.title}</span>
              </button>
            ))}
          </div>
        </div>

        {samples.length > 0 && (
          <div className="mt-2.5 space-y-1">
            <span className="block text-[10.5px] font-medium text-faint">Additional lab incident samples:</span>
            <div className="grid max-h-28 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
              {samples.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-sample={s.id}
                  onClick={() => {
                    setTitle(s.title);
                    setBody(s.body);
                    setCustomer(s.customerName);
                    setQuestions([]);
                    setAnswers({});
                  }}
                  className="flex min-h-7 items-start rounded-md border border-border bg-surface/70 px-2.5 py-1 text-left text-[10.5px] leading-snug whitespace-normal text-muted transition-colors hover:border-primary/50 hover:bg-elevated hover:text-text"
                  title={s.body}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="mt-3 block text-[11px] text-muted">
          Subject / Project Goal Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Federated Credentials on my spn stopped working… or Outline project: Migrate ERP sync to OIDC"
            className="mt-1 h-8 w-full rounded-md border border-border bg-canvas px-2.5 text-[12.5px] text-text focus:outline-2 focus:outline-primary"
            data-testid="composer-title"
          />
        </label>
        <label className="mt-2 block text-[11px] text-muted">
          Ticket Description / Project Requirements
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Paste the customer's incident description or outline your cloud engineering project goal. You can also scope parameters with clarifying questions before or after triage."
            className="mt-1 w-full resize-y rounded-md border border-border bg-canvas px-2.5 py-2 text-[12.5px] leading-relaxed text-text focus:outline-2 focus:outline-primary"
            data-testid="composer-body"
          />
        </label>

        {questions.length > 0 && (
          <div className="mt-3 rounded-lg border border-primary/40 bg-primary/6 p-2.5 space-y-2" data-testid="composer-clarifier-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-primary">
                <MessageSquare className="size-3.5" />
                Goal &amp; Scope Clarifier ({questions.length} targeted questions)
              </span>
              {clarifierModel && (
                <span className="rounded border border-primary/30 bg-canvas/80 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  Scope Analysis
                </span>
              )}
            </div>
            <div className="space-y-2">
              {questions.map((q, idx) => {
                const currentVal = answers[q.id] ?? q.options[0]?.label ?? q.selectedValue ?? "";
                const isPresetOption = q.options.some(
                  (opt) =>
                    currentVal.toLowerCase() === opt.label.toLowerCase() ||
                    currentVal.toLowerCase() === opt.value.toLowerCase() ||
                    currentVal.toLowerCase() === opt.id.toLowerCase(),
                );
                return (
                  <div key={q.id} className="rounded border border-border-subtle bg-canvas/85 p-2 text-[11.5px]">
                    <div className="font-medium text-text">
                      {idx + 1}. {q.question}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {q.options.map((opt) => {
                        const active =
                          currentVal.toLowerCase() === opt.label.toLowerCase() ||
                          currentVal.toLowerCase() === opt.value.toLowerCase();
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.label }))}
                            title={opt.description}
                            className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] transition-colors ${
                              active
                                ? "border-primary bg-primary/20 font-semibold text-primary"
                                : "border-border bg-surface text-muted hover:border-primary/40 hover:text-text"
                            }`}
                          >
                            {active && <Check className="size-3 shrink-0" />}
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      value={isPresetOption ? "" : currentVal}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={q.customHint ?? "Or type custom parameter…"}
                      className="mt-1.5 h-6 w-full rounded border border-border-subtle bg-surface px-2 font-sans text-[10.5px] text-text focus:outline-1 focus:outline-primary"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-w-[180px] flex-1 items-center gap-2 text-[11px] text-muted">
            Customer
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Contoso Finance"
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 text-[12px] text-text focus:outline-2 focus:outline-primary"
            />
          </label>
          <Button
            variant="outline"
            size="md"
            icon={<MessageSquare />}
            loading={clarifying}
            disabled={title.trim().length < 3 || body.trim().length < 5}
            onClick={() => void askClarifyingQuestions()}
            data-testid="composer-ask-questions"
          >
            💬 Ask Clarifying Questions to Scope Goal
          </Button>
          <Pill tone="muted">Live Graph &amp; Azure</Pill>
          <Button
            variant="primary"
            size="md"
            icon={<Sparkles />}
            loading={status === "loading"}
            disabled={!ready}
            onClick={() => void submit()}
            data-testid="composer-submit"
          >
            Triage Live
          </Button>
        </div>
      </div>
    </div>
  );
}
