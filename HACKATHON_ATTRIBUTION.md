# Hackathon Attribution — Meta Global AI Developer Hackathon 2026

| | |
|---|---|
| **Project** | ContextPane — Catalog-Constrained Generative UI Workbench for MSP Azure & Microsoft 365 engineers |
| **Track** | Build for Your World |
| **Bonus prize alignment** | Best Build on Meta Open Weight Models · Best Agentic Use-Case |
| **Hackathon window** | October 26 – November 4, 2026 |
| **Team** | Solo entry — Timur Dudhasch (GitHub: `dudhasch`) |
| **License** | MIT (see `LICENSE`) |
| **Repository** | _to be published on GitHub before submission_ |
| **Devpost** | _to be added_ |

## Provenance statement

Every line of code, script, schema, document and demo asset in this repository was
created **inside the hackathon window**, starting on **October 26, 2026**. The repository
was initialised empty on that date and built up in phase-by-phase commits so the
history itself is the audit trail:

1. Root configuration, design system, demo IaC baseline and lab manifest
2. `packages/catalog` — Zod schemas, View Recipes, forced tool-calling schema
3. `packages/mcp-erp`, `packages/mcp-msgraph`, `packages/mcp-azure-iac` — MCP servers
4. `apps/orchestrator` — 4-Tier Meta Model Router
5. `apps/web` — ContextPane Operational Workbench
6. `scripts/` — PowerShell 7 lab seeding, teardown, router config, smoke test; `modal-sandbox/`
7. Verification run (typecheck + smoke test)

Verify with:

```bash
git log --reverse --format='%ad  %h  %s' --date=iso
```

No code was carried over from a prior project. Third-party dependencies are declared in
the workspace `package.json` files and are all OSI-licensed.

## Meta models used

ContextPane routes every request through a 4-tier compute router that prefers
**zero tokens**, then the **smallest Meta model that can do the job**, and escalates only
when the task demands it:

| Tier | Purpose | Meta model | Provider(s) |
|---|---|---|---|
| 0 | Persistent View Recipe hydration | _none — 0 tokens_ | in-process MCP binding |
| 1A | Inline hover diagnostics (`AADSTS` translation) | `muse-glimmer-30b` | Fireworks AI → Baseten → Meta Model API |
| 1B / 2 | Ticket ↔ Graph ↔ IaC correlation, layout hydration | `meta-models/muse-spark-open-1026` (open weights), `muse-spark-1.3` | Baseten → Meta Model API |
| 3A | Agentic remediation planning | `muse-wonder-1.0` | Meta Model API |
| 3B | PowerShell + Terraform synthesis | `muse-code` | Meta Model API |
| Voice | Hands-free layout steering | `muse-voice-transcribe` + `muse-spark-open-1026` | Meta Model API / Baseten |

**Best Build on Meta Open Weight Models:** the hot path of the product (Tier 1B/2,
every ticket correlation and layout hydration) runs on the open-weight
`muse-spark-open-1026` served via Baseten, using OpenAI-compatible forced
function-calling (`tools` + `tool_choice`) because that model does not support
`response_format: json_schema`. The same tool definition works unchanged on Fireworks
and the Meta Model API.

**Best Agentic Use-Case:** Tier 3 is a Human-in-the-Loop agent loop. The model
synthesises an exact `Set-MgUserLicense` / `Update-MgIdentityConditionalAccessPolicy`
script and a Terraform NSG patch, the orchestrator verifies both in a pre-flight sandbox
(PowerShell AST parse + `terraform fmt`/`validate`, or a Modal sandbox), stages the patch
on a real git branch, and only then presents an approval drawer. Nothing executes
against a tenant without an explicit human click.

## Non-Meta components

- Model Context Protocol (`@modelcontextprotocol/sdk`) for the three tool servers.
- Microsoft Graph PowerShell SDK and Az PowerShell for live cloud mode.
- Terraform CLI for IaC validation. Modal for the optional remote sandbox.
- Bun, Hono, Vite, React 19, Tailwind v4, Zod.

## Contact

Timur Dudhasch — GitHub `dudhasch`
