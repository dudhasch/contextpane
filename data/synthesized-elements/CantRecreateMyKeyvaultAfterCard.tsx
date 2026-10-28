import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const CantRecreateMyKeyvaultAfterCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_CANTRECREATEMYKEYVAULTAFTERCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "CantRecreateMyKeyvaultAfterCard",
  "title": "Can't Recreate Key Vault After Deletion",
  "headline": "kv-contoso-fin-prod-01 is soft-deleted with purge protection in rg-contoso-finance-prod — recover it to preserve data instead of purging and recreating.",
  "domain": "azure",
  "reason": "No existing element handles soft-deleted Key Vault name conflict for kv-contoso-fin-prod-01 blocking recreation",
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
      "title": "Can't Recreate Key Vault After Deletion · Resource & State Metrics",
      "gauges": [
        {
          "id": "soft-deleted-blocking",
          "label": "Soft-deleted vaults blocking name",
          "used": 1,
          "limit": 1,
          "unit": "vaults",
          "status": "critical",
          "detail": "kv-contoso-fin-prod-01 holds the globally unique name until recovered or purged"
        },
        {
          "id": "retention-remaining",
          "label": "Soft-delete retention remaining",
          "used": 87,
          "limit": 90,
          "unit": "days",
          "status": "warning",
          "detail": "Recoverable window before scheduled purge; purge protection blocks early purge"
        },
        {
          "id": "objects-to-preserve",
          "label": "Secrets / keys / certs to preserve",
          "used": 42,
          "limit": 42,
          "unit": "objects",
          "status": "healthy",
          "detail": "Recovery restores vault, access policies, and all objects in place"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Can't Recreate Key Vault After Deletion · Control-Plane Evaluation Chain",
      "hops": [
        {
          "step": "1",
          "node": "Get-AzKeyVault -InRemovedState",
          "effect": "Pass",
          "code": "SoftDeleted=True",
          "detail": "kv-contoso-fin-prod-01 found deleted in rg-contoso-finance-prod; name remains reserved"
        },
        {
          "step": "2",
          "node": "New-AzKeyVault (recreate attempt)",
          "effect": "Deny",
          "code": "VaultAlreadyExists",
          "detail": "Name is already in use in soft-deleted state — recreation cannot proceed"
        },
        {
          "step": "3",
          "node": "Purge protection check",
          "effect": "Deny",
          "code": "PurgeProtectionEnabled",
          "detail": "Remove-AzKeyVault -InRemovedState purge is blocked until retention expires; data must be preserved"
        },
        {
          "step": "4",
          "node": "Undo-AzKeyVaultRemoval (chosen)",
          "effect": "Allow",
          "code": "Recover",
          "detail": "Restores the original vault, URI, policies, secrets, keys and certificates"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Vaults in rg-contoso-finance-prod — soft-delete inventory",
      "columns": [
        {
          "key": "vault",
          "label": "Vault",
          "mono": true
        },
        {
          "key": "state",
          "label": "State",
          "mono": false
        },
        {
          "key": "purgeProtection",
          "label": "Purge Protection",
          "mono": false
        },
        {
          "key": "action",
          "label": "Action",
          "mono": false
        }
      ],
      "rows": [
        {
          "vault": "kv-contoso-fin-prod-01",
          "state": "Soft-deleted (87d left)",
          "purgeProtection": "Enabled",
          "action": "Recover — Undo-AzKeyVaultRemoval"
        },
        {
          "vault": "kv-contoso-fin-prod-02",
          "state": "Active",
          "purgeProtection": "Enabled",
          "action": "None — do not touch"
        },
        {
          "vault": "kv-contoso-fin-dev-01",
          "state": "Active",
          "purgeProtection": "Disabled",
          "action": "None — out of scope"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Recover soft-deleted vault instead of recreate",
      "filePath": "scripts/recover-kv-contoso-fin-prod-01.ps1",
      "language": "powershell",
      "diff": "- # Fails: VaultAlreadyExists — name held by soft-deleted vault\n- New-AzKeyVault -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod' -Location 'eastus'\n+ # Verify soft-deleted state across vaults in the subscription\n+ $deleted = Get-AzKeyVault -InRemovedState | Where-Object { $_.VaultName -eq 'kv-contoso-fin-prod-01' }\n+ $deleted | Select-Object VaultName, ResourceGroupName, Location, DeletionDate, ScheduledPurgeDate\n+ # Purge protection is enabled and data must be preserved — do NOT purge\n+ # Recover the original vault with its secrets, keys, certs and policies\n+ Undo-AzKeyVaultRemoval -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod' -Location $deleted.Location\n+ # Verify recovery\n+ Get-AzKeyVault -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod'\n+ Get-AzKeyVaultSecret -VaultName 'kv-contoso-fin-prod-01' | Select-Object Name, Enabled"
    },
    {
      "kind": "event-stream",
      "title": "Can't Recreate Key Vault After Deletion · Audit & Activity Log",
      "events": [
        {
          "id": "evt-001",
          "timestamp": "2026-10-28T09:14:00Z",
          "operation": "Microsoft.KeyVault/vaults/delete",
          "status": "Succeeded",
          "code": "SoftDelete",
          "caller": "operator@contoso.com",
          "detail": "kv-contoso-fin-prod-01 deleted from rg-contoso-finance-prod; entered 90-day soft-deleted state"
        },
        {
          "id": "evt-002",
          "timestamp": "2026-10-28T09:22:00Z",
          "operation": "Microsoft.KeyVault/vaults/write (New-AzKeyVault)",
          "status": "Failed",
          "code": "VaultAlreadyExists",
          "caller": "operator@contoso.com",
          "detail": "Recreation failed: vault name is already in use in soft-deleted state"
        },
        {
          "id": "evt-003",
          "timestamp": "2026-10-28T09:23:00Z",
          "operation": "Microsoft.KeyVault/vaults/purge check",
          "status": "Warning",
          "code": "PurgeProtectionEnabled",
          "caller": "Azure Resource Manager",
          "detail": "Early purge denied by purge protection; recovery via Undo-AzKeyVaultRemoval is the supported path"
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "recover-vault",
      "label": "Recover soft-deleted vault",
      "description": "Run Undo-AzKeyVaultRemoval to restore kv-contoso-fin-prod-01 with all secrets, keys, certs and access policies intact.",
      "command": "Undo-AzKeyVaultRemoval -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod' -Location (Get-AzKeyVault -InRemovedState | Where-Object VaultName -eq 'kv-contoso-fin-prod-01').Location; Get-AzKeyVault -VaultName 'kv-contoso-fin-prod-01' -ResourceGroupName 'rg-contoso-finance-prod'",
      "kind": "stage-fix"
    },
    {
      "id": "inspect-soft-deleted",
      "label": "Inspect soft-deleted vaults",
      "description": "List all soft-deleted vaults and confirm deletion/purge dates before recovery; also available via az keyvault list-deleted.",
      "command": "Get-AzKeyVault -InRemovedState | Format-Table VaultName, ResourceGroupName, Location, DeletionDate, ScheduledPurgeDate; az keyvault list-deleted --query \"[?name=='kv-contoso-fin-prod-01']\" -o table",
      "kind": "inspect"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 100,
    "reusedFromCatalog": false,
    "reuseCount": 1,
    "tsxStubPath": "data/synthesized-elements/CantRecreateMyKeyvaultAfterCard.tsx",
    "synthesizedAt": "2026-10-28T07:56:26.867Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/CantRecreateMyKeyvaultAfterCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
