import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const LynneRobinsCannotAccessNewlyCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_LYNNEROBINSCANNOTACCESSNEWLYCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "LynneRobinsCannotAccessNewlyCard",
  "title": "Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to so",
  "headline": "kv-contoso-fin-02 recreation blocked by soft-deleted vault of same name — purge/recover first, then recreate with RBAC and grant Lynne data-plane access",
  "domain": "azure",
  "reason": "Ticket \"Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to so\" requires a bespoke diagnostic and remediation card.",
  "state": "critical",
  "requiredPrimitives": [
    "quota-gauges",
    "policy-chain",
    "data-table",
    "config-diff",
    "event-stream"
  ],
  "blocks": [
    {
      "kind": "quota-gauges",
      "title": "Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to so · Resource & State Metrics",
      "gauges": [
        {
          "id": "soft-deleted-vaults",
          "label": "Soft-deleted vaults named kv-contoso-fin-02",
          "used": 1,
          "limit": 1,
          "unit": "vaults",
          "status": "critical",
          "detail": "1 deleted vault in soft-delete state reserves the globally unique name until retention expiry or purge"
        },
        {
          "id": "retention-days-remaining",
          "label": "Soft-delete retention remaining",
          "used": 87,
          "limit": 90,
          "unit": "days",
          "status": "warning",
          "detail": "Deleted 3 days ago with 90-day retention; name cannot be reused without recover or purge"
        },
        {
          "id": "lynne-rbac-assignments",
          "label": "Lynne RBAC assignments on new vault",
          "used": 0,
          "limit": 2,
          "unit": "roles",
          "status": "critical",
          "detail": "0 of Key Vault Secrets Officer + Crypto Officer assigned to lynne.robins.contoso@c4a8shili.onmicrosoft.com"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to so · Control-Plane Evaluation Chain",
      "hops": [
        {
          "step": "1",
          "node": "Azure Resource Manager",
          "effect": "Deny",
          "code": "VaultAlreadyExists",
          "detail": "POST /subscriptions/.../Microsoft.KeyVault/vaults/kv-contoso-fin-02 rejected: name reserved by soft-deleted vault in same subscription/location"
        },
        {
          "step": "2",
          "node": "Key Vault Soft-Delete / Purge Protection",
          "effect": "Deny",
          "code": "SoftDeleteConflict",
          "detail": "enableSoftDelete=true, retention 90d; purge requires Microsoft.KeyVault/locations/deletedVaults/purge/action and is blocked if purge protection was enabled"
        },
        {
          "step": "3",
          "node": "Microsoft Entra ID Authentication",
          "effect": "Pass",
          "code": "AADSTS-TokenOK",
          "detail": "Lynne Robins (lynne.robins.contoso@c4a8shili.onmicrosoft.com) authenticates successfully; failure is authorization/naming, not sign-in"
        },
        {
          "step": "4",
          "node": "Key Vault RBAC Data Plane",
          "effect": "Deny",
          "code": "ForbiddenByRbac",
          "detail": "No role assignment on vault scope; with --enable-rbac-authorization, legacy access policies grant no secrets/keys access"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Key Vault kv-contoso-fin-02 — Control & Data Plane Inventory",
      "columns": [
        {
          "key": "resource",
          "label": "Resource",
          "mono": true
        },
        {
          "key": "state",
          "label": "State",
          "mono": false
        },
        {
          "key": "detail",
          "label": "Detail",
          "mono": false
        },
        {
          "key": "action",
          "label": "Required Action",
          "mono": false
        }
      ],
      "rows": [
        {
          "resource": "kv-contoso-fin-02 (deleted)",
          "state": "SoftDeleted",
          "detail": "scheduledPurgeDate +87d, purgeProtection=false, location eastus",
          "action": "Purge (irreversible) or recover — decide before recreate"
        },
        {
          "resource": "kv-contoso-fin-02 (new attempt)",
          "state": "CreateFailed",
          "detail": "VaultAlreadyExists on az keyvault create in rg-contoso-fin",
          "action": "Recreate only after purge completes, with RBAC enabled"
        },
        {
          "resource": "lynne.robins.contoso@c4a8shili.onmicrosoft.com",
          "state": "NoAccess",
          "detail": "Entra user, 0 Key Vault RBAC roles, 0 access policies",
          "action": "Assign Secrets Officer + Crypto Officer at vault scope"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "PowerShell 7 / Azure CLI — Purge soft-deleted vault, recreate, grant RBAC",
      "filePath": "remediation/kv-contoso-fin-02-recreate.ps1",
      "language": "powershell",
      "diff": "- az keyvault create --name kv-contoso-fin-02 --resource-group rg-contoso-fin --enable-rbac-authorization false\n+ # 1. Confirm conflict: az keyvault list-deleted --query \"[?name=='kv-contoso-fin-02']\" -o table\n+ # 2. Purge soft-deleted vault (irreversible; use recover instead if old secrets must be kept)\n+ az keyvault purge --name kv-contoso-fin-02 --location eastus\n+ az keyvault create --name kv-contoso-fin-02 --resource-group rg-contoso-fin --location eastus --enable-rbac-authorization true --enable-purge-protection true --retention-days 90\n+ $kv = az keyvault show --name kv-contoso-fin-02 --query id -o tsv\n+ $oid = az ad user show --id 'lynne.robins.contoso@c4a8shili.onmicrosoft.com' --query id -o tsv\n+ az role assignment create --assignee-object-id $oid --assignee-principal-type User --role 'Key Vault Secrets Officer' --scope $kv\n+ az role assignment create --assignee-object-id $oid --assignee-principal-type User --role 'Key Vault Crypto Officer' --scope $kv\n+ Start-Sleep -Seconds 60 # allow RBAC propagation\n+ az keyvault secret list --vault-name kv-contoso-fin-02 -o table # verify as operator; have Lynne retry"
    },
    {
      "kind": "event-stream",
      "title": "Lynne Robins cannot access a newly created Key Vault kv-contoso-fin-02 due to so · Audit & Activity Log",
      "events": [
        {
          "id": "evt-001",
          "timestamp": "2026-05-11T09:14:22Z",
          "operation": "Microsoft.KeyVault/vaults/write",
          "status": "Failed",
          "code": "VaultAlreadyExists",
          "caller": "lynne.robins.contoso@c4a8shili.onmicrosoft.com",
          "detail": "Create kv-contoso-fin-02 in rg-contoso-fin failed: a soft-deleted vault with the same name already exists"
        },
        {
          "id": "evt-002",
          "timestamp": "2026-05-11T09:15:03Z",
          "operation": "Microsoft.KeyVault/vaults/secrets/read",
          "status": "Failed",
          "code": "ForbiddenByRbac",
          "caller": "lynne.robins.contoso@c4a8shili.onmicrosoft.com",
          "detail": "Data-plane request denied: caller has no Key Vault RBAC role assignment on the vault scope"
        },
        {
          "id": "evt-003",
          "timestamp": "2026-05-08T16:40:51Z",
          "operation": "Microsoft.KeyVault/vaults/delete",
          "status": "Succeeded",
          "code": "Accepted",
          "caller": "admin@contoso.com",
          "detail": "Original kv-contoso-fin-02 deleted; entered 90-day soft-delete retention, reserving the vault name"
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "inspect-softdeleted",
      "label": "Inspect Soft-Deleted Vault",
      "description": "List the deleted vault, check purgeProtection and scheduledPurgeDate, and confirm recover vs purge before any irreversible action",
      "command": "az keyvault list-deleted --query \"[?name=='kv-contoso-fin-02']\" -o jsonc; az keyvault show-deleted --name kv-contoso-fin-02 -o jsonc",
      "kind": "inspect"
    },
    {
      "id": "stage-purge-recreate",
      "label": "Stage Purge, Recreate & Grant RBAC",
      "description": "Purge the soft-deleted vault, recreate kv-contoso-fin-02 with RBAC + purge protection, and assign Lynne Secrets/Crypto Officer (use az keyvault recover if old data must be retained)",
      "command": "az keyvault purge --name kv-contoso-fin-02 --location eastus && az keyvault create --name kv-contoso-fin-02 --resource-group rg-contoso-fin --location eastus --enable-rbac-authorization true --enable-purge-protection true --retention-days 90",
      "kind": "stage-fix"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 100,
    "reusedFromCatalog": false,
    "reuseCount": 1,
    "tsxStubPath": "data/synthesized-elements/LynneRobinsCannotAccessNewlyCard.tsx",
    "synthesizedAt": "2026-10-28T10:50:29.045Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/LynneRobinsCannotAccessNewlyCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
