import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const CanRecreateMyKeyVaultCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_CANRECREATEMYKEYVAULTCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "CanRecreateMyKeyVaultCard",
  "title": "Can't recreate my Key Vault after deleting the old one",
  "headline": "kv-contoso-fin-prod-01 is soft-deleted with purge protection — its name is reserved, so recover it to rg-contoso-finance-prod instead of recreating or purging.",
  "domain": "azure",
  "reason": "No existing catalog element covers Key Vault soft-delete name reservation and recover vs purge workflow for kv-contoso-fin-prod-01",
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
      "title": "Can't recreate my Key Vault after deleting the old one · Resource & State Metrics",
      "gauges": [
        {
          "id": "name-reservation",
          "label": "Name reservation (kv-contoso-fin-prod-01)",
          "used": 1,
          "limit": 1,
          "unit": "vaults",
          "status": "critical",
          "detail": "1 soft-deleted vault holds the globally unique name; recreation in same region returns name conflict"
        },
        {
          "id": "retention-window",
          "label": "Soft-delete retention remaining",
          "used": 88,
          "limit": 90,
          "unit": "days",
          "status": "warning",
          "detail": "Deleted vault retained for 90 days until scheduled purge unless recovered"
        },
        {
          "id": "purge-protection",
          "label": "Purge protection block",
          "used": 1,
          "limit": 1,
          "unit": "policies",
          "status": "critical",
          "detail": "enablePurgeProtection=true — permanent purge is denied during retention; recovery is the supported path"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Can't recreate my Key Vault after deleting the old one · Control-Plane Evaluation Chain",
      "hops": [
        {
          "step": "1",
          "node": "Delete kv-contoso-fin-prod-01",
          "effect": "Audit",
          "code": "SoftDeleteEnabled",
          "detail": "Vault moved to soft-deleted state; keys, secrets and certificates remain recoverable and name stays reserved"
        },
        {
          "step": "2",
          "node": "Recreate same name / eastus",
          "effect": "Deny",
          "code": "VaultAlreadyExists",
          "detail": "New-AzKeyVault / az keyvault create fails because soft-deleted vault with same name already exists"
        },
        {
          "step": "3",
          "node": "Purge soft-deleted vault",
          "effect": "Deny",
          "code": "PurgeProtectionEnabled",
          "detail": "az keyvault purge is blocked while purge protection is enabled and retention has not expired"
        },
        {
          "step": "4",
          "node": "Recover to rg-contoso-finance-prod",
          "effect": "Allow",
          "code": "UndoAzKeyVaultRemoval",
          "detail": "Undo-AzKeyVaultRemoval / az keyvault recover restores vault, access policies and objects to original resource group"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Soft-deleted vault inventory — kv-contoso-fin-prod-01",
      "columns": [
        {
          "key": "vault",
          "label": "Vault",
          "mono": true
        },
        {
          "key": "resourceGroup",
          "label": "Resource Group",
          "mono": true
        },
        {
          "key": "location",
          "label": "Location",
          "mono": true
        },
        {
          "key": "state",
          "label": "State",
          "mono": false
        }
      ],
      "rows": [
        {
          "vault": "kv-contoso-fin-prod-01",
          "resourceGroup": "rg-contoso-finance-prod",
          "location": "eastus",
          "state": "Soft-deleted — purge protection enabled, recoverable"
        },
        {
          "vault": "kv-contoso-fin-prod-01 (recreate attempt)",
          "resourceGroup": "rg-contoso-finance-prod",
          "location": "eastus",
          "state": "Failed — VaultAlreadyExists name conflict"
        },
        {
          "vault": "kv-contoso-fin-prod-01 (recovery target)",
          "resourceGroup": "rg-contoso-finance-prod",
          "location": "eastus",
          "state": "Pending recovery via Undo-AzKeyVaultRemoval"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Recover (not purge/recreate) the soft-deleted vault",
      "filePath": "recover-kv-contoso-fin-prod-01.ps1",
      "language": "powershell",
      "diff": "- # Recreate fails: name already exists / reserved\n- New-AzKeyVault -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod' -Location 'eastus'\n+ # Verify soft-deleted state (purge protection blocks purge)\n+ Get-AzKeyVault -InRemovedState | Where-Object { $_.Name -eq 'kv-contoso-fin-prod-01' }\n+ az keyvault list-deleted --query \"[?name=='kv-contoso-fin-prod-01']\"\n+ # Recover the old vault to its original resource group (chosen strategy)\n+ Undo-AzKeyVaultRemoval -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod' -Location 'eastus'\n+ # Azure CLI equivalent:\n+ # az keyvault recover --name kv-contoso-fin-prod-01 --resource-group rg-contoso-finance-prod\n+ # Verify recovery\n+ Get-AzKeyVault -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod'\n+ az keyvault show --name kv-contoso-fin-prod-01 --resource-group rg-contoso-finance-prod --query properties.provisioningState"
    },
    {
      "kind": "event-stream",
      "title": "Can't recreate my Key Vault after deleting the old one · Audit & Activity Log",
      "events": [
        {
          "id": "evt-delete-001",
          "timestamp": "2026-10-28T09:12:00Z",
          "operation": "Microsoft.KeyVault/vaults/delete",
          "status": "Succeeded",
          "code": "SoftDeleteEnabled",
          "caller": "operator@contoso.com",
          "detail": "kv-contoso-fin-prod-01 deleted from rg-contoso-finance-prod (eastus) and moved to soft-deleted state with purge protection"
        },
        {
          "id": "evt-recreate-002",
          "timestamp": "2026-10-28T09:24:00Z",
          "operation": "Microsoft.KeyVault/vaults/write",
          "status": "Failed",
          "code": "VaultAlreadyExists",
          "caller": "operator@contoso.com",
          "detail": "Recreate with same name and region failed: a soft-deleted vault with name kv-contoso-fin-prod-01 already exists"
        },
        {
          "id": "evt-listdeleted-003",
          "timestamp": "2026-10-28T09:31:00Z",
          "operation": "Microsoft.KeyVault/deletedVaults/read",
          "status": "Warning",
          "code": "PurgeProtectionEnabled",
          "caller": "operator@contoso.com",
          "detail": "az keyvault list-deleted confirms vault is recoverable; purge denied until retention expires, recovery recommended"
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "recover-vault",
      "label": "Recover soft-deleted vault",
      "description": "Restore kv-contoso-fin-prod-01 with its keys, secrets, certificates and policies to rg-contoso-finance-prod in eastus",
      "command": "Undo-AzKeyVaultRemoval -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod' -Location 'eastus'; az keyvault recover --name kv-contoso-fin-prod-01 --resource-group rg-contoso-finance-prod",
      "kind": "stage-fix"
    },
    {
      "id": "inspect-deleted",
      "label": "Inspect soft-deleted state",
      "description": "Confirm deletion date, scheduled purge date and purge-protection status before recovery",
      "command": "Get-AzKeyVault -InRemovedState | Where-Object { $_.Name -eq 'kv-contoso-fin-prod-01' }; az keyvault list-deleted --query \"[?name=='kv-contoso-fin-prod-01']\" -o table",
      "kind": "inspect"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 100,
    "reusedFromCatalog": false,
    "reuseCount": 1,
    "tsxStubPath": "data/synthesized-elements/CanRecreateMyKeyVaultCard.tsx",
    "synthesizedAt": "2026-10-28T09:01:30.135Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/CanRecreateMyKeyVaultCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
