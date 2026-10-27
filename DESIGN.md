# ContextPane Design System — High-Density MSP Operational UI

ContextPane is an operational workbench, not a marketing site. Engineers read it for
hours during escalations, so every decision below optimises for **scan speed, density,
and unambiguous status**. The system is dark-first; light mode is intentionally out of
scope for the hackathon build.

All tokens live in `apps/web/src/styles/tokens.css` as CSS custom properties and are
mapped into Tailwind v4 via `@theme`. Components never hardcode hex values.

---

## 1. Palette

### Surfaces (dark-first)

| Token | Hex | Usage |
|---|---|---|
| `--cp-canvas` | `#090D16` | App background, the deepest layer |
| `--cp-surface` | `#111827` | Panes, HUD bar, drawers |
| `--cp-elevated` | `#1E293B` | Cards, popovers, floating toolbars |
| `--cp-border` | `#334155` | All 1px borders and dividers |
| `--cp-border-subtle` | `#1F2937` | Table row dividers, inset separators |

### Semantic accents

| Token | Hex | Meaning |
|---|---|---|
| `--cp-primary` | `#38BDF8` | Azure Blue — interactive, links, selected state, Tier 0 |
| `--cp-healthy` | `#10B981` | Emerald — synced, compliant, verified safe |
| `--cp-warning` | `#F59E0B` | Amber — drift, degraded, report-only |
| `--cp-critical` | `#F43F5E` | Rose — blocked, rogue rule, AADSTS failure |
| `--cp-meta` | `#A855F7` | Meta AI Purple — anything produced by a Muse model |

Each accent ships with a `-dim` (12% alpha fill) and `-ring` (40% alpha border) variant
so badges, pills and banners share one recipe: dim fill + ring border + solid text.

### Provenance categories

Entities and cards are coloured by where the data came from, not by health. The colour is set
once per element as the `--cat` custom property (`apps/web/src/lib/provenance.ts`, values from
`CATEGORY_META` in `packages/catalog`), and pills, accents, rings and tabs all read it.

| Category | Hex | Sources |
|---|---|---|
| Licensing | `#F59E0B` | SKU pools, license assignment state, group-based licensing |
| Identity / CA | `#F43F5E` | Users, groups, Conditional Access, sign-ins, AADSTS codes |
| Intune | `#A855F7` | Settings Catalog policies, device configurations, devices, MDM error codes |
| Azure | `#14B8A6` | AVD host pool, NSG, Azure Policy, Terraform |

Health still uses the semantic accents above (status pills, emerald once converged), so a
rose identity card can carry an amber *Drifted* pill.

### Text

| Token | Hex | Usage |
|---|---|---|
| `--cp-text` | `#E5E7EB` | Primary copy |
| `--cp-text-muted` | `#94A3B8` | Labels, secondary metadata |
| `--cp-text-faint` | `#64748B` | Timestamps, placeholders, disabled |

---

## 2. Typography

| Role | Font | Size / Weight |
|---|---|---|
| Dense UI labels, body | **Inter** (variable) | 12–13px / 400–500, 14px for pane titles |
| Section headers | Inter | 11px / 600, uppercase, tracking `0.08em` |
| Identifiers | **JetBrains Mono** (variable) | 12px / 400 |

**Rule:** anything an engineer would copy into a terminal is monospace. That means UPNs,
object IDs, tenant IDs, SKU part numbers (`SPE_E5`), `AADSTS` codes, resource names,
PowerShell snippets, HCL diffs, and latency values. Monospace identifiers get a subtle
`--cp-elevated` background chip when inline.

Fonts are bundled via `@fontsource-variable/*` so the demo renders identically offline.

---

## 3. Spacing & Density

- Base unit 4px. Pane padding 16px, card padding 12px, table cell padding 6px 10px.
- Row height 28px in tables, 32px for interactive list rows.
- Max line length is irrelevant: panes are fixed-width columns, content wraps at the pane.
- Split layout: left scenario pane `minmax(420px, 38%)`, right GenUI canvas fills the rest.
- Top bar is 48px tall, sticky, `--cp-surface` with a bottom `--cp-border`. It holds only the
  title, the Tickets / Tenant Anomalies switch, the scenario selector, Pin Recipe, Voice Steer,
  Reset Drift and the System & Audit drawer. No SLA timers, burn rates or tier badges on cards.

---

## 4. Component Recipes

### Status pill
`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px]`
with the semantic dim/ring/text triple. Icon 12px from Lucide.

### Entity pill (hoverable UPN / group / policy / setting / error code)
Same as status pill but in its provenance colour (`--cat` fill, ring and text). On hover
(150ms delay) it opens the **Hover Diagnostic Popover** anchored below-start via
floating-ui with 6px offset and flip/shift middleware, and rings the card it spawned while
dimming the others. Clicking it expands that card on the matching tab and scrolls to it.

### Hover Diagnostic Popover
320px wide, `--cp-elevated`, 1px `--cp-border`, 8px radius, shadow `0 12px 32px -8px #000`.
Header: entity id (mono) + status pill. Body: headline (13px/500), error translation
(12px muted), quick actions as ghost buttons. Must render within 350ms; skeleton state
shows immediately.

### Summary & Resolution Plan
The first block of the left pane: 2px `--cp-primary` ring (emerald once resolved), a two-line
summary, then numbered steps with a checkbox each. Clicking a step expands and scrolls to the
card and tab it names. The contract and the infrastructure spec sit below in collapsed
accordions, so the plan is always above the fold.

### Cards (GenUI canvas)
`--cp-elevated` background, 1px `--cp-border`, 10px radius, 12px padding, and a 4px left
border in the card's provenance colour (emerald once remediated). Header row: title (13px/600)
+ status pill + right-aligned *Triggered by* badge, CodeLens and data source. The CodeLens is a
subtle 10px JetBrains Mono badge (1px `--cp-border-subtle`, `--cp-text-faint`, file icon) naming the
lines that declare the drifted resource or baseline rule, last two path segments only
(`demo-iac/main.tf:L43-L84`, `conditional-access/CA-001.json:L9-L11`); it never shrinks, the
*Triggered by* badge truncates first, and a click opens the card's diff. Compact by default: a
two-line summary and one primary action; *Expand Details* reveals tabs (Sign-ins / Policies,
Settings / Devices, Host pool / NSG / Azure Policy). Above the cards a breadcrumb shows
tenant › domain › scenario.

### Drawer (HITL Action Approval)
Right-side sheet, 600px, `--cp-surface`, backdrop `rgba(9,13,22,0.7)`. Tabs for
PowerShell / Graph JSON / Terraform (only when the scenario has IaC) / Entities.
**Path A** at the top copies the script or the Terraform / Graph JSON, with a
`[Dry-Run (-WhatIf) Verified]` badge when every mutating cmdlet is `ShouldProcess`-guarded.
**Path B** at the bottom opens with a two-option segmented control (one 1px `--cp-border` track,
two equal cells): *Emergency Break-Glass* (Zap icon, `--cp-warning` tint when selected, hint
"Direct API + Auto-Reconcile PR") and *Pure GitOps* (GitMerge icon, `--cp-primary` tint, hint
"Stage PR & Modal Plan Only"). One 11px line under it says what the selected mode will do, then the
delegated identity, the PR checkbox and the CTA, whose label follows the mode. Tickets default to
Break-Glass, anomalies to GitOps; once approved the control locks on the mode used. No mode
controls anywhere on the cards. Verification badge uses `--cp-healthy` when all checks pass,
`--cp-warning` if any check was skipped, `--cp-critical` on failure. The Path B CTA is full width
and disabled until verification passes.

### System & Audit drawer
Right-side sheet like the approval drawer, with four tabs: router savings, audit log,
provider status, and Skills & PII Vault. Tier colours: Tier 0 `--cp-primary`, Tier 1
`--cp-healthy`, Tier 2 `--cp-meta`, Tier 3 `--cp-warning`. Latency and tokens are plain
mono with muted labels.

### Day-2 upgrades (no canvas clutter)

All deep proof lives off-canvas. Cards never gain verification, vault or compiler controls.

- **Formal proof (Tier 3C):** `Formal proof` and `Inverse Rollback (f⁻¹)` are tabs inside
  the Action Approval drawer only. The formal tab shows the 3 proved invariants, the
  30-day Blast-Radius Matrix (one mono line per cohort, `0 collateral user lockouts`) and
  the `[Compile to Tier 0 Fleet Skill]` button. Approve stays disabled while a formal
  invariant fails. The rollback tab shows the pre-verified `f⁻¹` PowerShell/HCL bundle.
- **Time-Travel Scrubber:** one 28px pill bar above the cards (`T-18m · T-14m · T-06m ·
  NOW · T+Fix`, Tier 0, 0 tokens). Selecting a slice rings only the card that changed
  (`Δ <card>` in the same line). Converged scenarios add one
  `[1-Click Undo / Rollback (f⁻¹)]` button at the right end of that bar — nowhere else.
- **MSP domain depth (final pass):** Intune CSP-IR (`cspUri`, `registryPath`,
  `tattooedOnUnassign`) appears only inside the expanded Intune settings tab and the
  drawer's `Detect.ps1 / Remediate.ps1` tab (Intune scenarios only). Workload Identity
  findings (`ANOM-APP-401`) render through the existing Entra Sign-In / Identity card —
  no new macro-card type, and the 4-card layout is unchanged. The ASR exclusion preview
  is one mono line in the drawer's Blast-Radius Matrix.
- **Canary convergence (Places 5–8):** the *Simulate Canary Probe Failure* checkbox, the
  mono 4-stage canary trace (`APPLIED → CANARY_RING_0 → SYNTHETIC_PROBED → CONVERGED /
  AUTO_ROLLED_BACK`), the `3-Way Commercial` and `Fleet & Reverse-IaC` drawer tabs, and
  *Export Runbook (.md)* all live inside the Action Approval drawer. The expanded License
  card gains one `3-Way Reconciler` tab (expanded state only; collapsed card unchanged).
  The left-pane Resolution Plan may carry one subtle fleet pill
  (`Stage Fleet GitOps Campaign (N Tenants)`). System & Audit's Providers tab shows the
  Glimmer inference pills (`grammarConstrained`, `kvCacheQuant: q8_0`,
  `speculativeDraftMax: 8`, `maxContainers: 1`) and a runbook export link.
- **Skills & PII Vault tab (System & Audit):** compiled-skill badges
  (`Tier 0 Compiled Skill (100/100 fuzz verified)`), the compile button, vaulted-field
  count, `zeroRawPiiInLlmPrompt: true`, and token ↔ raw sample mappings in mono.
  No raw UPN/IP ever appears on a card for this.

---

## 5. Motion

- Popovers / toolbars: 120ms opacity + 4px translate, ease-out.
- Drawer: 200ms translate-x, ease-out.
- Pill hover link: 150ms ring on the linked card, the others fade to 55% opacity.
- No bounce, no spring, nothing slower than 250ms. This UI should feel like a terminal.

---

## 6. Iconography

Lucide only, 14px inline, 16px in card headers, 12px inside pills. Stroke 1.75.
Semantic icon mapping:

| Meaning | Icon |
|---|---|
| Tenant / org | `Building2` |
| User / UPN | `UserRound` |
| Group | `Users` |
| License | `BadgeCheck` / `BadgeAlert` |
| Conditional Access | `ShieldBan` / `ShieldCheck` |
| Sign-in event | `LogIn` |
| Azure resource | `Cloud` |
| Intune / device | `MonitorCog` |
| Drift | `GitCompareArrows` |
| Terraform / IaC | `FileCode2` |
| PowerShell | `Terminal` |
| Meta model | `Sparkles` |
| Voice | `Mic` |
| Recipe / pin | `Pin` |
| Verified | `ShieldCheck` |
| Approve & execute | `Rocket` |

---

## 7. Accessibility

- Minimum contrast 4.5:1 for text on every surface (all tokens above pass against
  `--cp-elevated` and `--cp-surface`).
- Every hover popover is also reachable by keyboard focus.
- Status is never color-only: pills always carry an icon or text label.
- Demo hotkeys (`?` overlay) are additive; everything remains mouse-operable.
