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
- Split layout: left ticket pane `minmax(420px, 38%)`, right GenUI canvas fills the rest.
- HUD bar is 48px tall, sticky, `--cp-surface` with a bottom `--cp-border`.

---

## 4. Component Recipes

### Status pill
`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px]`
with the semantic dim/ring/text triple. Icon 12px from Lucide.

### Entity pill (hoverable UPN / group / error code)
Same as status pill but `--cp-primary` ring, dotted underline, cursor help. On hover
(150ms delay) it opens the **Hover Diagnostic Popover** anchored below-start via
floating-ui with 6px offset and flip/shift middleware.

### Hover Diagnostic Popover
320px wide, `--cp-elevated`, 1px `--cp-border`, 8px radius, shadow `0 12px 32px -8px #000`.
Header: entity id (mono) + status pill. Body: headline (13px/500), error translation
(12px muted), quick actions as ghost buttons. Must render within 350ms; skeleton state
shows immediately.

### Floating Toolbar (semantic selection)
Appears above a highlighted contract line. Pill group on `--cp-elevated` with drift
summary (`12/15 Assigned • 3 Missing E5`), burn-rate delta, and one primary action.

### CodeLens
A single 11px mono line rendered *above* a code/spec block, `--cp-text-muted` with
semantic-colored state and `|`-separated actions styled as links. Mirrors VS Code.

### Cards (GenUI canvas)
`--cp-elevated` background, 1px `--cp-border`, 10px radius, 12px padding.
Header row: title (13px/600) + right-aligned status pill + provenance tag
(`Tier 0 · 0 tokens` or `Tier 2 · muse-spark-open-1026`).

### Drawer (HITL Action Approval)
Right-side sheet, 560px, `--cp-surface`, backdrop `rgba(9,13,22,0.7)`. Tabs for
PowerShell / Terraform. Verification badge uses `--cp-healthy` when all checks pass,
`--cp-warning` if any check was skipped, `--cp-critical` on failure. Primary CTA is full
width at the bottom and disabled until verification passes.

### Telemetry HUD pills
Mono 11px. Tier pill color: Tier 0 `--cp-primary`, Tier 1 `--cp-healthy`,
Tier 2 `--cp-meta`, Tier 3 `--cp-warning`. Provider pill shows provider + model id.
Latency and tokens are plain mono with muted labels.

---

## 5. Motion

- Popovers / toolbars: 120ms opacity + 4px translate, ease-out.
- Drawer: 200ms translate-x, ease-out.
- Telemetry pill value change: 300ms color flash to the tier color then back.
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
