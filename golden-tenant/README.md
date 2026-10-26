# Golden tenant baseline

The declarative Microsoft 365 configuration ContextPane compares the live tenant against.
Every drifted Conditional Access or Intune setting on the canvas cites the exact lines here
(for example `golden-tenant/entra/conditional-access/CA-001.json:L9-L11`), and the card's
CodeLens opens the diff between the live Graph object and this file.

| Path | Declares |
|---|---|
| `entra/conditional-access/CA-001.json` | Phishing-resistant MFA for the demo admins, break-glass group excluded |
| `entra/conditional-access/CA-004.json` | Legacy authentication blocked (enforced, not report-only) |
| `intune/win11/asr-baseline.json` | Attack Surface Reduction rules, all in Block |
| `intune/win11/firewall.json` | Windows Firewall enabled on every profile |
| `intune/win11/assignments.json` | Which group each Win11 profile is assigned to; `Win11-Firewall-MDM` to none |
| `intune/fabrikam/disk-encryption.json` | Fabrikam BitLocker settings, compliance and assignments |

Files are `JSON.stringify(value, null, 2)` with a trailing newline, so a live object rendered
the same way diffs line by line against them.
