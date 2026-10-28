import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const CantRecreateMyKeyvaultAfterCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_CANTRECREATEMYKEYVAULTAFTERCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "CantRecreateMyKeyvaultAfterCard",
  "title": "Can't Recreate Key Vault After Deletion",
  "headline": "Soft-deleted vault with purge protection is holding the name — purge it in removed state, then recreate clean",
  "domain": "azure",
  "reason": "No existing catalog element handles soft-deleted Key Vault blocking recreation - requires recovery or purge workflow",
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
          "label": "Soft-deleted vaults holding name",
          "used": 1,
          "limit": 1,
          "unit": "vaults",
          "status": "critical",
          "detail": "1 vault in removed state reserves the requested name globally"
        },
        {
          "id": "retention-window",
          "label": "Soft-delete retention remaining",
          "used": 90,
          "limit": 90,
          "unit": "days",
          "status": "warning",
          "detail": "Retention up to 90 days; name stays reserved until purge or expiry"
        },
        {
          "id": "name-availability",
          "label": "Name availability for recreation",
          "used": 0,
          "limit": 1,
          "unit": "names",
          "status": "critical",
          "detail": "VaultAlreadyExists until the removed vault is purged"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Can't Recreate Key Vault After Deletion · Control-Plane Evaluation Chain",
      "hops": [
        {
          "step": "1",
          "node": "ARM Key Vault Create",
          "effect": "Pass",
          "code": "CreateRequestAccepted",
          "detail": "New-AzKeyVault / az keyvault create request is well-formed for the target resource group and location"
        },
        {
          "step": "2",
          "node": "Global Name Uniqueness",
          "effect": "Deny",
          "code": "VaultAlreadyExists",
          "detail": "Key Vault names are globally unique; a soft-deleted vault still owns the name and blocks same-name recreation"
        },
        {
          "step": "3",
          "node": "Soft-Delete Retention",
          "effect": "Deny",
          "code": "SoftDeletedVaultExists",
          "detail": "Deleted vault is retained in removed state for the configured retention period unless explicitly purged"
        },
        {
          "step": "4",
          "node": "Purge Protection",
          "effect": "Audit",
          "code": "PurgeProtectionEnabled",
          "detail": "Purge protection was enabled — purge may be blocked until scheduledPurgeDate; verify before forcing purge, as purge is irreversible"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Soft-deleted vaults blocking recreation",
      "columns": [
        {
          "key": "vaultName",
          "label": "Vault Name",
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
        },
        {
          "key": "purgeProtection",
          "label": "Purge Protection",
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
          "vaultName": "kv-prod-01",
          "location": "eastus",
          "state": "Soft-deleted (InRemovedState)",
          "purgeProtection": "Enabled",
          "action": "Purge with Remove-AzKeyVault -InRemovedState, then recreate"
        },
        {
          "vaultName": "kv-prod-01 (requested)",
          "location": "eastus",
          "state": "Create failed — VaultAlreadyExists",
          "purgeProtection": "n/a",
          "action": "Retry New-AzKeyVault only after purge completes"
        },
        {
          "vaultName": "kv-prod-01 (target)",
          "location": "eastus",
          "state": "Not yet created",
          "purgeProtection": "Enable on recreate",
          "action": "Recreate clean with -EnablePurgeProtection -SoftDeleteRetentionInDays 90"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Purge soft-deleted vault and recreate clean",
      "filePath": "recreate-keyvault.ps1",
      "language": "powershell",
      "diff": "# Blocked: VaultAlreadyExists on recreate\n- New-AzKeyVault -VaultName 'kv-prod-01' -ResourceGroupName 'rg-prod' -Location 'eastus'\n+ # Confirm the soft-deleted vault holding the name\n+ Get-AzKeyVault -InRemovedState | Where-Object VaultName -eq 'kv-prod-01'\n+ # Purge the soft-deleted vault (irreversible)\n+ Remove-AzKeyVault -VaultName 'kv-prod-01' -Location 'eastus' -InRemovedState -Force\n+ # Verify the name is released\n+ Get-AzKeyVault -InRemovedState -VaultName 'kv-prod-01' -Location 'eastus' # expect no result\n+ # Recreate clean vault\n+ New-AzKeyVault -VaultName 'kv-prod-01' -ResourceGroupName 'rg-prod' -Location 'eastus' -EnablePurgeProtection -SoftDeleteRetentionInDays 90\n+ Get-AzKeyVault -VaultName 'kv-prod-01' -ResourceGroupName 'rg-prod'\n+ # az keyvault create --name kv-prod-01 --resource-group rg-prod --location eastus --enable-purge-protection"
    },
    {
      "kind": "event-stream",
      "title": "Can't Recreate Key Vault After Deletion · Audit & Activity Log",
      "events": [
        {
          "id": "evt-delete-001",
          "timestamp": "2026-10-28T09:12:00Z",
          "operation": "Microsoft.KeyVault/vaults/delete",
          "status": "Succeeded",
          "code": "SoftDeleteRetained",
          "caller": "operator@contoso.com",
          "detail": "Vault deleted but moved to soft-deleted state; name, keys, secrets and certificates retained for recovery"
        },
        {
          "id": "evt-create-002",
          "timestamp": "2026-10-28T09:20:00Z",
          "operation": "Microsoft.KeyVault/vaults/write",
          "status": "Failed",
          "code": "VaultAlreadyExists",
          "caller": "operator@contoso.com",
          "detail": "Same-name create failed: a vault with the same name exists in soft-deleted state in eastus"
        },
        {
          "id": "evt-list-003",
          "timestamp": "2026-10-28T09:24:00Z",
          "operation": "Microsoft.KeyVault/vaults/read (InRemovedState)",
          "status": "Warning",
          "code": "PurgeProtectionEnabled",
          "caller": "operator@contoso.com",
          "detail": "Get-AzKeyVault -InRemovedState confirms blocking vault with purge protection enabled; purge is irreversible and may wait until scheduledPurgeDate"
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "purge-and-recreate",
      "label": "Purge Soft-Deleted Vault & Recreate",
      "description": "Irreversibly purge the removed vault to release the name, verify release, then recreate a clean vault with purge protection and 90-day retention",
      "command": "Remove-AzKeyVault -VaultName 'kv-prod-01' -Location 'eastus' -InRemovedState -Force; New-AzKeyVault -VaultName 'kv-prod-01' -ResourceGroupName 'rg-prod' -Location 'eastus' -EnablePurgeProtection -SoftDeleteRetentionInDays 90",
      "kind": "stage-fix"
    },
    {
      "id": "inspect-removed-vaults",
      "label": "Inspect Soft-Deleted Vaults",
      "description": "List all vaults in removed state to confirm name, location, retention and scheduled purge date before purging",
      "command": "Get-AzKeyVault -InRemovedState | Format-List VaultName,Location,EnablePurgeProtection,ScheduledPurgeDate; az keyvault list-deleted --query \"[].{name:name,location:properties.location,purgeDate:properties.scheduledPurgeDate}\" -o table",
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
    "synthesizedAt": "2026-10-28T01:07:29.050Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/CantRecreateMyKeyvaultAfterCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
