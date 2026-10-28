# ContextPane Design System — High-Density MSP Operational UI

ContextPane is an operational workbench, not a marketing site. Engineers read it for
hours during escalations, so every decision below optimises for **scan speed, density,
and unambiguous status**. The theme is **Graphite & Signal**: dark by default, with a
full light mode.

All tokens live in `apps/web/src/styles/tokens.css` as CSS custom properties and are
mapped into Tailwind v4 via `@theme inline`, so utilities such as `bg-surface`,
`text-muted`, `border-hairline`, `text-signal` or `bg-signal/12` follow the active theme at
runtime. Components never hardcode hex values.

---

## 1. Palette

Neutral graphite greys, **one** interactive accent (`--signal`), three status hues used as
text or a dot, and four desaturated domain hues used on title words and entity underlines.
Purple is no longer an "AI colour": agent output is marked by `✦` and a dashed hairline.

### Theme switching

| Mechanism | Effect |
|---|---|
| `<html data-theme="dark">` / `"light"` | Explicit theme, set by `src/lib/theme.ts` |
| no `data-theme` | `prefers-color-scheme` decides (CSS fallback before JS runs) |
| `localStorage["cp-theme"]` | `"dark"` (default) / `"light"` / `"system"`; `system` follows OS changes live |
| TopBar toggle (`topbar-theme-toggle`) | Cycles dark → light → system |

`color-scheme` is set to match on `:root`, so native scrollbars and form controls follow.

### Surfaces

| Token | Utility | Dark | Light | Usage |
|---|---|---|---|---|
| `--ground` | `bg-ground` | `#0E1013` | `#F6F7F9` | App background, code blocks, table heads |
| `--surface` | `bg-surface` | `#15181D` | `#FFFFFF` | Zones, TopBar, drawers |
| `--raised` | `bg-raised` | `#1B2027` | `#EEF0F3` | Popovers, inline chips, hover fills |
| `--hairline` | `border-hairline` | `#2A303A` | `#E3E6EB` | 1px zone and section separators |
| `--hairline-2` | `border-hairline-2` | `#1F242B` | `#EEF0F3` | Table row dividers, inset separators |

### Text

| Token | Utility | Dark | Light | Usage |
|---|---|---|---|---|
| `--text` | `text-text` | `#E8EAEE` | `#16181D` | Primary copy |
| `--muted` | `text-muted` | `#9AA3B1` | `#5B6472` | Labels, secondary metadata |
| `--faint` | `text-faint` | `#808A9A` | `#626B79` | Timestamps, provenance lines, placeholders |

`--faint` was specified as `#7B8494` (dark) / `#6B7482` (light); both measured below 4.5:1
on `--raised` (4.34 and 4.14) and were adjusted to the values above.

### Signal and status

| Token | Utility | Dark | Light | Meaning |
|---|---|---|---|---|
| `--signal` | `text-signal`, `bg-signal` | `#6CB4FF` | `#0B63C9` | The only interactive accent: links, focus, selected state, primary buttons, selection slices |
| `--signal-ink` | `text-signal-ink` | `#0E1013` | `#FFFFFF` | Text on a solid `--signal` fill |
| `--critical` | `text-critical` | `#FF6E7E` | `#C8283F` | Blocked, rogue rule, AADSTS failure |
| `--warning` | `text-warning` | `#F2B15A` | `#9A5B00` | Drift, degraded, report-only |
| `--healthy` | `text-healthy` | `#58D39A` | `#0F7A4F` | Synced, compliant, verified safe |

Status is shown as **dot + word** in the status hue (`<Pill variant="status">`), not as a
filled pill. Where a tinted fill of a tone is unavoidable (legacy fill pills, danger/meta
buttons, toggles), the label uses the `-strong` token (`text-critical-strong`,
`text-healthy-strong`, `text-signal-strong`, `text-warning-strong`, `text-meta-strong`):
the tone mixed 25% toward `--text`, which keeps 4.5:1 on a tint of up to 25% in both themes.

### Domain (provenance) hues

Entities and cards are coloured by where the data came from, not by health. The colour is set
once per element as the `--cat` custom property (`catStyle()` in `apps/web/src/lib/provenance.ts`),
which resolves to `var(--dom-<category>)` so it follows the theme; the `CATEGORY_META` hex in
`packages/catalog` is only the fallback.

| Token | Utility | Dark | Light | Sources |
|---|---|---|---|---|
| `--dom-licensing` | `text-dom-licensing` | `#D9A24A` | `#8A5A00` | SKU pools, license assignment state, group-based licensing |
| `--dom-identity` | `text-dom-identity` | `#E27088` | `#B0334F` | Users, groups, Conditional Access, sign-ins, AADSTS codes |
| `--dom-intune` | `text-dom-intune` | `#B08CF5` | `#6B3FD1` | Settings Catalog policies, device configurations, devices, MDM error codes |
| `--dom-azure` | `text-dom-azure` | `#4EC3B6` | `#0D776C` | AVD host pool, NSG, Azure Policy, Terraform |
| `--dom-selection` | `text-dom-selection` | = `--signal` | = `--signal` | An ad-hoc slice of tenant data the engineer asked for by highlighting text |

Light `--dom-azure` was specified as `#0F7D72` (4.38:1 on `--raised`) and adjusted to `#0D776C`.
Domain hues go on the **title word** and on **entity underlines** (`<Pill variant="entity">`),
never as a card fill. Health still uses the status hues, so an identity section can carry a
warning *Drifted* status.

### Deprecated aliases (one work-package cycle)

Kept so existing components render while they are migrated; do not use in new code.

| Legacy utility / var | Resolves to |
|---|---|
| `canvas`, `--cp-canvas` | `--ground` |
| `surface`, `--cp-surface` | `--surface` |
| `elevated`, `--cp-elevated` | `--raised` |
| `border`, `--cp-border` | `--hairline` |
| `border-subtle`, `--cp-border-subtle` | `--hairline-2` |
| `primary`, `selection`, `--cp-primary`, `--cp-selection` | `--signal` |
| `meta`, `--cp-meta` | `--dom-intune` |
| `--cp-text`, `--cp-text-muted`, `--cp-text-faint` | `--text`, `--muted`, `--faint` |
| `card` utility | Boxed card; superseded by `section-hairline` (no fill, no radius, top hairline, `12px 0` padding) |

---

## 2. Typography

Four steps, nothing in between. Each utility carries its line-height.

| Utility | Size / line-height | Use |
|---|---|---|
| `text-11` | 11px / 1.4 | Section labels (600, uppercase, tracking `0.08em`), provenance lines, mono metadata |
| `text-12` | 12px / 1.45 | Secondary copy, table cells, mono identifiers |
| `text-13` | 13px / 1.45 | Body (the `body` default) and dense UI labels |
| `text-15` | 15px / 1.3 | Zone and ticket titles |

| Role | Font | Size / Weight |
|---|---|---|
| Body, dense UI labels | **Inter** (variable) | 13px / 400–500 |
| Titles | Inter | 15px / 600 |
| Section headers | Inter | 11px / 600, uppercase, tracking `0.08em` |
| Identifiers, code | **JetBrains Mono** (variable) | 11px or 12px / 400 |

Numerals are tabular everywhere (`font-variant-numeric: tabular-nums` on `body`), so counts,
latencies and timestamps line up in columns. Legacy `text-[..px]` sizes still present in
components are collapsed onto this scale in WP8.

**Rule:** anything an engineer would copy into a terminal is monospace. That means UPNs,
object IDs, tenant IDs, SKU part numbers (`SPE_E5`), `AADSTS` codes, resource names,
PowerShell snippets, HCL diffs, and latency values. Monospace identifiers get a subtle
`--raised` background chip when inline.

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

### Unified work queue & ERP inbox

One control in the top bar replaces the Tickets / Tenant Anomalies toggle, the native select and
the composer button; nothing else is added to the default view.

- **Queue button:** 28px, `--cp-elevated`, origin icon in the origin tone, mono display id
  (`#INC-4092`, `#2026323`), the title in `--cp-muted` (truncated, max 560px), the status pill
  (mono 10px) and a chevron. A violet count badge (16px, top-right) shows unopened ERP drops.
  Hover: 50% primary border. `Ctrl+K` / `q` toggle the popover.
- **Queue popover:** 640px, `--cp-surface`, 1px `--cp-border`, `shadow-popover`, 120ms fade,
  anchored bottom-start. Rows top to bottom: search line (Search icon, 12px input, `Ctrl K` kbd);
  filter pills (`All · Ticket · Anomaly · ERP Drop · Unscripted · Resolved`, 20px, mono 10.5px, count in
  `--cp-faint`, primary when selected); the list (max 360px, newest first, resolved last); a footer
  with `[+ Triage Unscripted Ticket]` (outline) and `[🎲 Drop Random ERP Ticket]` (meta) plus the
  `1–9 · j k · Esc` hint. Enter opens the first match, arrows step, Esc closes.
- **Queue row:** `position · origin icon · #id · title / meta line · attachments + age · status`.
  Position in mono 10px `--cp-faint`; the meta line (10.5px, faint) reads
  `ERP File Drop · Contoso Finance · Patti Fernandez · base INC-4092`; an unopened drop carries a
  1.5px violet dot after its id; the active row has an 8% primary fill.
- **Origin badges** (icon + short text, same recipe as the status pill, `mono=false`):
  `PSA Ticket` (Ticket, primary), `Live Graph Anomaly` (Radar, warning), `ERP File Drop` (Inbox, meta),
  `Ad-Hoc Triage` (Sparkles, healthy). The left-pane header opens with the badge, then the display id,
  then the status pill: `NEW` (meta, Inbox icon) for a fresh drop, `OPEN` (critical) for tickets,
  `ACTIVE DRIFT` (warning) for anomalies, then the convergence states.
- **New-drop toast:** meta tone, `📥 New ERP Drop: #2026323 (attachment1.png)`, one line of detail
  (title · entities matched live · base pattern) and one `[Open #2026323]` button (primary 12% fill).
  It never switches the workbench by itself.
- **Attachment card of a drop:** the existing screenshot recipe; the caption adds
  `· read from input/tickets/#2026323/` so it is clear the file came from disk, and the vision
  result line names the model (`muse-spark-1.3`) or the deterministic fallback.

### Live agency (highlight, unscripted tickets, closure)

Nothing in this layer renders until the engineer acts; the default view is unchanged.

- **Selection trigger:** highlighting 3–120 characters inside the ticket / anomaly text shows one
  floating pill above the selection (`--cp-elevated` glass, 1px `--cp-selection` at 60%, Sparkles icon,
  `Generate Context UI for "<phrase>"`, 120ms fade). It disappears on click, Escape or any click elsewhere.
- **Selection badge:** once generated, the phrase in the text becomes a cyan inline badge
  (`Selection #n`, Sparkles, mono 11px, same recipe as entity pills but in `--cp-selection`). Hovering it
  rings the spawned mini-dashboard (`ring-2` cyan + the pulse); clicking scrolls to it, or regenerates it
  after a dismiss (dimmed badge).
- **ContextualMiniDashboard:** mounted above the macro cards, same card chrome, `border-l-4` cyan.
  Header: title · `Spawned from selection: "<phrase>" · <ms>` cyan chip · `[Copy Graph/PowerShell Query]` ·
  `[× Dismiss]`. Then one mono subtitle line (the live query), 2–4 KPI tiles (label 10px uppercase, value
  13px mono in the metric tone), 2–5 proportional bars (1.5px track, tone-coloured fill, `count · pct%`),
  the dynamic table (filter chips, sticky head, max-height 256px, badge columns as status pills, mono
  columns in JetBrains Mono) and one action row (meta button with the targeted command, `Copy command`).
  At most six mini-dashboards are kept; a new one for the same phrase replaces the old one.
- **Ticket composer:** `[+ Triage Unscripted Ticket]` in the top bar opens a 720px centred modal
  (`card` recipe, backdrop `rgba(9,13,22,0.7)`): three quick-sample chips, subject input, 6-row body
  textarea, customer input, a `Tier 0 extraction · 0 tokens` pill and one primary `Triage Live` button.
  Hotkey `n`. The new `CUSTOM-<hash>` ticket joins the Tickets selector; its header carries a primary
  `unscripted · base <scenario>` pill and the signals block shows the extraction and the base rationale.
- **Filter chips & cross-card highlight:** expanded tables (License assignments, Intune devices, sign-ins,
  mini-dashboards) open with `All (N) | Drifted / Error (M) | Compliant / Active (K)` chips (20px, mono
  10.5px; primary / critical / healthy when selected). Clicking a UPN or device cell sets one identity
  filter: matching rows get a cyan 12% fill with an inset cyan ring, every other row drops to 45% opacity
  on every open card, and the canvas breadcrumb shows `Filtered by: lynne.robins [×]` in cyan.
- **Status & closure:** the left-pane status pill reads `OPEN` (rose) for tickets and `ACTIVE DRIFT`
  (amber) for anomalies, flips to `RESOLVED & VERIFIED ✓` (emerald) on convergence and `CLOSED IN PSA ✓`
  after closing. Every plan step is checked at convergence, and the *Customer & PSA Resolution Note*
  box (emerald 40% border, collapsible, inside the Resolution Plan) holds the customer paragraph, the
  mono audit-trail list with check icons, `[Copy PSA Resolution Note]` (outline) and
  `[Mark Ticket Closed in PSA]` (healthy). Nothing of this appears on the canvas cards.

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
| Generate Context UI / selection | `Wand2` (hint), `Sparkles` (badge, card) |
| Unscripted ticket | `FilePlus2` (composer), `Sparkles` (origin badge) |
| Work queue / ERP inbox | `Inbox` (ERP drop), `Ticket` (PSA), `Radar` (anomaly), `Dices` (random drop), `FolderInput` (triaged from drop) |
| Row filter | `Filter` |
| Resolution note / close | `FileCheck2` / `CheckCheck` |
| Voice | `Mic` |
| Recipe / pin | `Pin` |
| Verified | `ShieldCheck` |
| Approve & execute | `Rocket` |

---

## 7. Accessibility

- Minimum contrast 4.5:1 for text on every surface: every text, status and domain token
  passes on `--ground`, `--surface` and `--raised` in both themes, and every `-strong` label
  passes on a tint of its own tone up to 25%.
- Every hover popover is also reachable by keyboard focus.
- Status is never color-only: pills always carry an icon or text label.
- Demo hotkeys (`?` overlay) are additive; everything remains mouse-operable.
