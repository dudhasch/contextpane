# Fix CUSTOM-1VNWWY: E5 license upgrade, AVD block and NSG drift for Contoso Finance

**Ticket:** CUSTOM-1VNWWY · **Tenant:** Contoso Finance · **Remediation:** rem-mvqlvxjt-rw5o

Assigns SPE_E5 to 0 drifted member(s) of SG-Contoso-Finance-AVD and removes SPE_E3. Excludes SG-Contoso-Finance-AVD from 'Block AVD - Contoso Finance Legacy' and switches it to report-only.

## Pre-flight

Verified Safe · AST pass · terraform fmt pass · terraform validate pass · modal-cloud-sandbox · 804 ms

## Apply

```powershell
pwsh -NoProfile -File ./demo-iac/remediations/CUSTOM-1VNWWY/Invoke-Remediate-CUSTOM-1VNWWY.ps1 -WhatIf   # dry run
pwsh -NoProfile -File ./demo-iac/remediations/CUSTOM-1VNWWY/Invoke-Remediate-CUSTOM-1VNWWY.ps1           # execute (delegated identity)
```

```bash
terraform -chdir=demo-iac plan   # reconciles demo-iac/main.tf against Azure (removes rogue rules, restores tags)
```

_Staged by ContextPane Tier 3. Human approval required before execution._
