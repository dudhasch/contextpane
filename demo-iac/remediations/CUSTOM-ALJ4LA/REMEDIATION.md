# Fix CUSTOM-ALJ4LA: de-privilege spn-contoso-erp-sync and federate GitHub Actions OIDC

**Ticket:** CUSTOM-ALJ4LA · **Tenant:** Contoso Finance · **Remediation:** rem-mvqlovd6-in3y

Removes shadow-admin owner alex.wilber@c4a8shili.onmicrosoft.com (0 directory roles) from spn-contoso-erp-sync, revokes the unverified delegated grant (Mail.ReadWrite offline_access), replaces overprivileged application permissions (Directory.ReadWrite.All, Sites.FullControl.All, Mail.ReadWrite, RoleManagement.ReadWrite.Directory) with User.Read.All, Sites.Selected per 90-day activity, and federates GitHub Actions via OIDC (repo:contoso/erp-sync:ref:refs/heads/main) so the expired secret behind AADSTS7000222 can be retired.

## Pre-flight

Verified Safe · AST pass · terraform fmt pass · terraform validate pass · modal-cloud-sandbox · 603 ms

## Apply

```powershell
pwsh -NoProfile -File ./demo-iac/remediations/CUSTOM-ALJ4LA/Invoke-Remediate-CUSTOM-ALJ4LA.ps1 -WhatIf   # dry run
pwsh -NoProfile -File ./demo-iac/remediations/CUSTOM-ALJ4LA/Invoke-Remediate-CUSTOM-ALJ4LA.ps1           # execute (delegated identity)
```

```bash
terraform -chdir=demo-iac plan   # reconciles  against Azure (removes rogue rules, restores tags)
```

_Staged by ContextPane Tier 3. Human approval required before execution._
