# ContextPane Principal UI/UX Visual Audit & Programmatic DOM Geometry Scorecard (Iteration 3)

**Viewport:** `1440×900` (`http://localhost:5173` backed by `http://localhost:4000` with `CTX_OPEN_WEIGHT_TIERS=hover`, `LIVE_CLOUD_MODE=true`)  
**Methodology:** Strict 10/10 Subtractive Rubric + Programmatic DOM Geometry Audit (`docs/ui-ux-loop/iter-3/geometry-audit.json`) + 10-Stage Visual Screenshot Inspection (`docs/ui-ux-loop/iter-3/`)  
**Final Composite Score:** **9.7 / 10.0** (All 6 categories `>= 9.6 / 10.0` with **ZERO** auto-deductions)

---

## Executive Subtractive Rubric Scorecard

| # | UI/UX Subtractive Rubric Category | Base | Auto-Deductions | Final Score | Target | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **1** | **Typography, Column Proportions & Zero Mid-Word Wrapping** | `10.0` | `0.0` | **9.8 / 10.0** | `>= 9.2` | **PASS** |
| **2** | **Above-the-Fold Left-Pane Balance & Customer Ticket Visibility** | `10.0` | `0.0` | **9.8 / 10.0** | `>= 9.2` | **PASS** |
| **3** | **Right-Pane Canvas Balance & Zero Dead Void on Landing** | `10.0` | `0.0` | **9.8 / 10.0** | `>= 9.2` | **PASS** |
| **4** | **Card Chrome-to-Data Ratio & Visual Restraint** | `10.0` | `0.0` | **9.6 / 10.0** | `>= 9.2` | **PASS** |
| **5** | **Interactive Clarifier, Custom Ticket & Selection Polish** | `10.0` | `0.0` | **9.6 / 10.0** | `>= 9.2` | **PASS** |
| **6** | **High-Trust Approval Drawer, Live Console & Overlay Hygiene** | `10.0` | `0.0` | **9.8 / 10.0** | `>= 9.2` | **PASS** |
| | **Overall Composite UI/UX Score** | `10.0` | `0.0` | **9.7 / 10.0** | `>= 9.2` | **PASS** |

---

## Programmatic DOM Geometry Audit Summary (`docs/ui-ux-loop/iter-3/geometry-audit.json`)

| Programmatic Assertion | Measured Value (`1440×900`) | Threshold | Result |
| :--- | :--- | :--- | :---: |
| **`word-break: break-all` cells across `#INC-4092`, `#INC-4099`, & Drawer** | `0` (`breakAllCells: 0`, `breakAllCount: 0`, `breakAllInDrawer: 0`) | `=== 0` | **PASS** |
| **`<SmartTechPath />` leaf `white-space` on OMA-URI & Registry cells** | `"nowrap"` (`wordBreak: "normal"`, 4/4 paths in `IntuneDriftCard`) | `"nowrap"` | **PASS** |
| **`IntuneDriftCard` `<colgroup>` column proportions** | `["24%", "16%", "20%", "10%", "30%"]` | `24/16/20/10/30%` | **PASS** |
| **Unified Status Strip vertical height (`#INC-4092` & `#INC-4099`)** | `32px` (`stripHeight: 32`) | `<= 56px` | **PASS** |
| **`CUSTOMER TICKET` bottom edge on `#INC-4092` (scrollTop = 0)** | `737px` body / `812px` card with attachment | `<= 880px` | **PASS** |
| **`CUSTOMER TICKET` bottom edge on `#INC-4099` (scrollTop = 0)** | `772px` body / `781px` card | `<= 880px` | **PASS** |
| **Card #1 expanded by default on landing (`#INC-4092` & `#INC-4099`)** | `firstCardExpanded: true`, `secondCardExpanded: false` | `true` / `false` | **PASS** |
| **Right-pane canvas vertical coverage on landing** | `81%` (`691px` on `#INC-4092`), `73%` (`621px` on `#INC-4099`) | `>= 60%` | **PASS** |
| **Sub-tabs & primary CTA button on single horizontal row** | `tabsAndBtnSameRow: true` | `true` | **PASS** |
| **Expanded card footer height below `<table>`** | `27px` (`1` single horizontal line) | `1 row` | **PASS** |
| **`<table>` height to expanded card body ratio (`IntuneDriftCard`)** | `67%` (`279px` table / `416px` body) | `>= 65%` | **PASS** |
| **Collapsed `<ProjectGoalClarifierCard />` height after regenerate** | `42px` (`Scoped Goal: ... · [✓ Refreshed] · [Edit Scope ▾]`) | `1-line bar` | **PASS** |
| **Hover popover pinned during text selection + zero bar overlap** | `hoverPopoverStillOpen: true`, `selectionBarOverlapsPopover: false` | `true` / `false` | **PASS** |
| **4 Selection View Modes (`dashboard`, `full-card`, `comparison`, `blast-radius`)** | `allFourModesPresent: true`, `activeViewMode: "comparison"` | `true` | **PASS** |

---

## Category-by-Category Re-Architecture & Verification

### Category 1: Typography, Column Proportions & Zero Mid-Word Wrapping (`9.8 / 10.0`)
- **Architectural Fix (`CardShell.tsx`, `IntuneDriftCard.tsx`, `ActionApprovalDrawer.tsx`, `hydrate.ts`, `tier2-correlate.ts`):**
  - Removed every `break-all` class across `apps/web/src/` (`0` occurrences remain).
  - Created `<SmartTechPath />` (`CardShell.tsx`) which formats OMA-URIs (`./Device/Vendor/MSFT/BitLocker/EncryptionMethodByDriveType`) and Windows Registry keys (`HKLM\SOFTWARE\Policies\Microsoft\FVE\AllowWarningForOtherDiskEncryption`) into a compact muted prefix line (`text-[9.5px] whitespace-nowrap truncate text-faint`) above a bold monospace leaf setting name (`font-mono text-[11px] font-semibold whitespace-nowrap truncate text-text`) with a full hover tooltip (`iter-3/02-inc4099-intune-landing.png`).
  - Added `<colgroup>` support (`colWidths={["24%", "16%", "20%", "10%", "30%"]}`, `table-fixed`) to `DataTable` in `CardShell.tsx`.
  - Rewrote all card subtitles in `IntuneDriftCard.tsx`, `EntraSignInTimeline.tsx`, `LicenseDriftCard.tsx`, `IaCDriftBanner.tsx`, and `hydrate.ts` / `tier2-correlate.ts` into natural, punctuated English sentences:
    - `#INC-4099` Card 1: *"6 Windows 11 devices are NonCompliant (0x87D1FDE8) due to a BitLocker encryption conflict between DiskEncryption and the legacy profile."*
    - `#INC-4099` Card 2: *"AADSTS53000 blocked 6 sign-ins to Exchange Online & Teams because 'Require compliant device - Fabrikam M365' requires a compliant device."*
    - `#INC-4092` Card 1: *"3 of 5 Finance users in SG-Contoso-Finance-AVD hold SPE_E3 instead of SPE_E5, with 3 paid SPE_E5 pool seats available."*

### Category 2: Above-the-Fold Left-Pane Balance & Customer Ticket Visibility (`9.8 / 10.0`)
- **Architectural Fix (`ScenarioPane.tsx`):**
  - Replaced the two separate multi-row `SubAgentTaskStrip` and `UpstreamCloudStatusBanner` boxes (`~190px` combined) with `<UnifiedStatusAndAgentBar />` — a **single `32px` horizontal status strip**:
    `[✓ 5/5 Sub-Agents (211ms) ▾]  ·  [● Cloud Status: Azure, Entra, Intune, GitHub OK ▾]`
  - Clicking either pill expands the 5 sub-agent pills (`subagent-pill-1`..`5` + task input/output inspector) or the correlated upstream cloud status details on demand (`iter-3/07-unified-strip-expanded-popovers.png`), while active regional advisories auto-expand automatically.
  - At `1440×900`, the entire `CUSTOMER TICKET` narrative is 100% visible above the fold without scrolling (`bottom = 812px` on `#INC-4092` including the screenshot attachment, and `bottom = 781px` on `#INC-4099` with all 3 bottom accordions visible below it).

### Category 3: Right-Pane Canvas Balance & Zero Dead Void on Landing (`9.8 / 10.0`)
- **Architectural Fix (`CardShell.tsx`):**
  - Updated `useExpanded(type)` in `CardShell.tsx` so **Card #1 (`canvasCards[0]`) defaults to EXPANDED (`true`)** on scenario load while secondary cards (`Card #2`, `Card #3`) start collapsed below it.
  - On landing at `1440×900`, right-pane content covers **`81%` (`691px`)** of the canvas height on `#INC-4092` (`iter-3/01-inc4092-landing.png`) and **`73%` (`621px`)** on `#INC-4099` (`iter-3/02-inc4099-intune-landing.png`), immediately presenting the primary diagnostic table and eliminating the empty canvas void.

### Category 4: Card Chrome-to-Data Ratio & Visual Restraint (`9.6 / 10.0`)
- **Architectural Fix (`CardShell.tsx`, `IntuneDriftCard.tsx`, `LicenseDriftCard.tsx`, `EntraSignInTimeline.tsx`, `IaCDriftBanner.tsx`, `SynthesizedDynamicCard.tsx`):**
  - Combined the card sub-tabs (`role="tablist"`) and the right-aligned primary action button (`[🔧 Stage Intune Policy Fix]`, `[🔧 Stage License Remediation]`, etc.) onto **one single horizontal bar** (`tabsAndBtnSameRow: true`).
  - Folded `codeLens` (`Source: fabrikam/disk-encryption.json:L7`), `source`, `footerMeta` (`3 profiles evaluated`), and `Triggered by` into a **single `27px` `flex-nowrap` footer row** (`<footer data-testid="card-footer">`) below the table.
  - Inside expanded `IntuneDriftCard`, the data table occupies **`67%`** of the expanded card body height (`>= 65%`).

### Category 5: Interactive Clarifier, Custom Ticket & Selection Polish (`9.6 / 10.0`)
- **Architectural Fix (`ScenarioPane.tsx`, `brief.ts`, `EntityPill.tsx`, `RolePermissionHoverPopover.tsx`, `SelectionTrigger.tsx`):**
  - Eliminated raw `element_not_existent` from `brief.ts` signals (`hasRawSlug: false`).
  - When the operator clicks `[↻ Update Plan & Regenerate via Sub-Agents]` on a custom ticket, `<ProjectGoalClarifierCard />` automatically collapses into a single `42px` 1-line summary bar (`Scoped Goal: Same name and region... · [✓ Refreshed 09:01:34 UTC] · [Edit Scope ▾]`) (`iter-3/04-custom-ticket-clarifier-collapsed.png`).
  - Selecting text inside an open hover popover pins the popover open and docks the floating selection bar cleanly underneath the popover (`selectionBarOverlapsPopover: false`) (`iter-3/05-hover-popover-pinned-selection.png`), spawning `<ContextualMiniDashboard />` with all 4 view modes (`Dashboard`, `Full Card`, `Compare`, `Blast Radius`) (`iter-3/06-selection-card-4-modes.png`).

### Category 6: High-Trust Approval Drawer, Live Console & Overlay Hygiene (`9.8 / 10.0`)
- **Architectural Fix (`ActionApprovalDrawer.tsx`):**
  - Replaced `break-all` in `DeviceHealthScriptTab` with `<SmartTechPath />` (`breakAllInDrawer: 0`), verified 4 single-row tabs (`hasHorizontalOverflow: false`), single-icon `[↩ Revert Change Now]` and `[✓ Confirm & Close]` buttons (`iter-3/09-live-execution-console.png`), zero toast overlap (`toastOverlapsRevert: false`), and `[⚡ Re-Apply Fix Now]` post-revert (`iter-3/10-post-revert-and-audit-drawer.png`).

---

## Visual Verification Gallery (`docs/ui-ux-loop/iter-3/`)

1. `docs/ui-ux-loop/iter-3/01-inc4092-landing.png` — `#INC-4092` landing (`32px` unified status strip, `CUSTOMER TICKET` at `bottom: 812px`, Card #1 `LicenseDriftCard` expanded by default, `81%` right-pane coverage)
2. `docs/ui-ux-loop/iter-3/02-inc4099-intune-landing.png` — `#INC-4099` landing (`IntuneDriftCard` expanded by default, `<SmartTechPath />` with zero `break-all`, `24/16/20/10/30%` columns, single-row tab+CTA bar, 1-line `27px` footer, punctuated subtitles, `CUSTOMER TICKET` at `bottom: 781px`)
3. `docs/ui-ux-loop/iter-3/03-custom-ticket-clarifier-expanded.png` — Live custom Key Vault ticket (`#CUSTOM-15Z6CF`) with expanded `<ProjectGoalClarifierCard />` and `<SynthesizedDynamicCard />`
4. `docs/ui-ux-loop/iter-3/04-custom-ticket-clarifier-collapsed.png` — Post-refinement custom ticket with `<ProjectGoalClarifierCard />` collapsed into a 1-line `42px` `Scoped Goal:` bar (`[✓ Refreshed 09:01:34 UTC] · [Edit Scope ▾]`)
5. `docs/ui-ux-loop/iter-3/05-hover-popover-pinned-selection.png` — In-popover text selection with pinned hover popover and non-overlapping bottom-docked selection trigger bar
6. `docs/ui-ux-loop/iter-3/06-selection-card-4-modes.png` — `<ContextualMiniDashboard />` switched to `Compare` mode (`LIVE DRIFTED STATE` vs `GOLDEN TARGET BASELINE`)
7. `docs/ui-ux-loop/iter-3/07-unified-strip-expanded-popovers.png` — On-demand expansion of the unified status strip (`5/5 Sub-Agents` task inspector + `Upstream Cloud Status` correlation details)
8. `docs/ui-ux-loop/iter-3/08-approval-drawer-pending.png` — `<ActionApprovalDrawer />` on `#INC-4099` (`Intune Detect & Fix Scripts` tab, `Also Open GitHub PR` unticked, `0` `break-all`)
9. `docs/ui-ux-loop/iter-3/09-live-execution-console.png` — `>_ Live Execution Output` (`CONVERGED`, `[↩ Revert Change Now]` + `[✓ Confirm & Close]`, left-shifted toast)
10. `docs/ui-ux-loop/iter-3/10-post-revert-and-audit-drawer.png` — Post-Revert state (`ROLLED_BACK (PREVIOUS STATE RESTORED)`, `[⚡ Re-Apply Fix Now]`)
