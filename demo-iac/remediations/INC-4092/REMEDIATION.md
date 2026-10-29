# Fix INC-4092: E5 license upgrade, AVD block and NSG drift for Contoso Finance

**Ticket:** INC-4092 · **Tenant:** Contoso Finance · **Remediation:** rem-mvpup9b1-pyxr

Assigns SPE_E5 to 3 drifted member(s) of SG-Contoso-Finance-AVD and removes SPE_E3. Excludes SG-Contoso-Finance-AVD from 'Block AVD - Contoso Finance Legacy' and switches it to report-only. Removes rogue NSG rule(s) Allow-Temp-RDP-Diagnostic-Drift from nsg-contoso-avd-hostpool-01 and restores tag(s) Environment = "Production".

## Pre-flight

Verified Safe · AST pass · terraform fmt pass · terraform validate pass · modal-cloud-sandbox · 781 ms

## Apply

```powershell
pwsh -NoProfile -File ./demo-iac/remediations/INC-4092/Invoke-Remediate-INC-4092.ps1 -WhatIf   # dry run
pwsh -NoProfile -File ./demo-iac/remediations/INC-4092/Invoke-Remediate-INC-4092.ps1           # execute (delegated identity)
```

```bash
terraform -chdir=demo-iac plan   # reconciles demo-iac/main.tf against Azure (removes rogue rules, restores tags)
```

_Staged by ContextPane Tier 3. Human approval required before execution._
