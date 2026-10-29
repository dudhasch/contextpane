import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const FinanceBlobAbacConditionFixPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_FINANCEBLOBABACCONDITIONFIX_SPEC: SynthesizedDynamicCard = {
  "elementId": "FinanceBlobAbacConditionFix",
  "title": "Finance Blob ABAC Condition and Policy Fix",
  "headline": "app-contoso-fin-reports gets 403 AuthorizationPermissionMismatch on ledger-exports in stcontosofinprod01 — ABAC limits reads to project=audit tags and mg-contoso-landingzones policy blocks re-creating the assignment.",
  "domain": "azure",
  "reason": "Custom ABAC RBAC condition on Storage Blob Data Reader plus inherited CAF management group policy blocking reassignment requires synthesized trace and least-privilege fix",
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
      "title": "Finance Blob ABAC Condition and Policy Fix · Resource & State Metrics",
      "gauges": [
        {
          "id": "tagged-blobs",
          "label": "Ledger blobs tagged project=audit",
          "used": 68,
          "limit": 100,
          "unit": "%",
          "status": "warning",
          "detail": "Untagged/mistagged blobs in ledger-exports fail the existing tag condition"
        },
        {
          "id": "allowed-containers",
          "label": "Containers allowed by condition",
          "used": 0,
          "limit": 1,
          "unit": "containers",
          "status": "critical",
          "detail": "ledger-exports not named in condition — only tags:project=audit passes"
        },
        {
          "id": "failed-reads",
          "label": "403 reads since Monday",
          "used": 142,
          "limit": 150,
          "unit": "requests",
          "status": "critical",
          "detail": "AuthorizationPermissionMismatch from managed identity of app-contoso-fin-reports"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Finance Blob ABAC Condition and Policy Fix · Control-Plane Evaluation Chain",
      "hops": [
        {
          "step": "1",
          "node": "mg-contoso-landingzones (CAF MG)",
          "effect": "Deny",
          "code": "RequestDisallowedByPolicy",
          "detail": "Inherited Azure Policy blocks re-creating role assignment — do not delete/recreate; edit in place"
        },
        {
          "step": "2",
          "node": "stcontosofinprod01 account scope",
          "effect": "Pass",
          "code": "Storage Blob Data Reader",
          "detail": "Role assignment for app-contoso-fin-reports managed identity still present at storage account scope"
        },
        {
          "step": "3",
          "node": "ABAC condition v2.0",
          "effect": "Deny",
          "code": "Condition: tags:project=audit",
          "detail": "Read allowed only if @Resource[.../blobs/tags:project] StringEquals 'audit' — untagged ledger blobs denied"
        },
        {
          "step": "4",
          "node": "ledger-exports container (proposed)",
          "effect": "Allow",
          "code": "containers/name = ledger-exports",
          "detail": "Add OR @Resource[.../containers/name] StringEquals 'ledger-exports' while keeping tag clause — least privilege, prod container only"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Blob tag verification — ledger-exports in stcontosofinprod01",
      "columns": [
        {
          "key": "blob",
          "label": "Blob",
          "mono": true
        },
        {
          "key": "container",
          "label": "Container",
          "mono": true
        },
        {
          "key": "tags",
          "label": "Tags",
          "mono": false
        },
        {
          "key": "result",
          "label": "Current result",
          "mono": false
        }
      ],
      "rows": [
        {
          "blob": "ledger-2026-05.csv",
          "container": "ledger-exports",
          "tags": "project=audit",
          "result": "200 — passes tag condition"
        },
        {
          "blob": "ledger-2026-06.csv",
          "container": "ledger-exports",
          "tags": "(none)",
          "result": "403 AuthorizationPermissionMismatch"
        },
        {
          "blob": "reconciliation-q2.xlsx",
          "container": "ledger-exports",
          "tags": "project=finance",
          "result": "403 AuthorizationPermissionMismatch"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Edit existing ABAC condition — keep tag gate, add ledger-exports",
      "filePath": "scripts/fix-finance-blob-abac.ps1",
      "language": "powershell",
      "diff": "# stcontosofinprod01 — Storage Blob Data Reader (app-contoso-fin-reports)\n- $condition = \"((!(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'})) OR (@Resource[Microsoft.Storage/storageAccounts/blobServices/containers/blobs/tags:project<$key$>] StringEquals 'audit'))\"\n+ $condition = \"((!(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'})) OR (@Resource[Microsoft.Storage/storageAccounts/blobServices/containers/blobs/tags:project<$key$>] StringEquals 'audit' OR @Resource[Microsoft.Storage/storageAccounts/blobServices/containers/name] StringEquals 'ledger-exports'))\"\n $ctx = New-AzStorageContext -StorageAccountName stcontosofinprod01 -UseConnectedAccount\n Get-AzStorageBlob -Container ledger-exports -Context $ctx -IncludeTag | Format-Table Name,Tags\n Get-AzStorageBlobTag -Container ledger-exports -Blob 'ledger-2026-05.csv' -Context $ctx\n $scope = \"/subscriptions/<subId>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/stcontosofinprod01\"\n Get-AzRoleAssignment -Scope $scope | Where-Object RoleDefinitionName -eq 'Storage Blob Data Reader' | Select-Object DisplayName,Condition,ConditionVersion\n-# Do NOT re-create assignment — RequestDisallowedByPolicy at mg-contoso-landingzones blocks new assignments\n+Set-AzRoleAssignment -ObjectId <managedIdentityPrincipalId> -RoleDefinitionName 'Storage Blob Data Reader' -Scope $scope -Condition $condition -ConditionVersion '2.0'\n+Get-AzRoleAssignment -Scope $scope | Where-Object Condition -Match 'ledger-exports'\n+# Verify: app-contoso-fin-reports read on ledger-exports returns 200, other containers remain tag-gated"
    },
    {
      "kind": "event-stream",
      "title": "Finance Blob ABAC Condition and Policy Fix · Audit & Activity Log",
      "events": [
        {
          "id": "evt-001",
          "timestamp": "2026-05-11T08:14:00Z",
          "operation": "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
          "status": "Failed",
          "code": "AuthorizationPermissionMismatch",
          "caller": "app-contoso-fin-reports (managed identity)",
          "detail": "403 on ledger-exports in stcontosofinprod01 — blob lacks project=audit tag required by ABAC condition"
        },
        {
          "id": "evt-002",
          "timestamp": "2026-05-12T10:32:00Z",
          "operation": "Microsoft.Authorization/roleAssignments/write",
          "status": "Failed",
          "code": "RequestDisallowedByPolicy",
          "caller": "operator",
          "detail": "Re-creating Storage Blob Data Reader assignment denied by inherited policy from mg-contoso-landingzones"
        },
        {
          "id": "evt-003",
          "timestamp": "2026-05-12T10:35:00Z",
          "operation": "Microsoft.Authorization/policyAssignments/read",
          "status": "Succeeded",
          "code": "Get-AzPolicyAssignment",
          "caller": "operator",
          "detail": "Traced inherited CAF policy assignment at /providers/Microsoft.Management/managementGroups/mg-contoso-landingzones"
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "verify-tags",
      "label": "Verify blob tags",
      "description": "Confirm which ledger-exports blobs lack project=audit before widening the condition",
      "command": "$ctx=New-AzStorageContext -StorageAccountName stcontosofinprod01 -UseConnectedAccount; Get-AzStorageBlob -Container ledger-exports -Context $ctx -IncludeTag | Format-Table Name,Tags; Get-AzStorageBlobTag -Container ledger-exports -Blob 'ledger-2026-06.csv' -Context $ctx",
      "kind": "inspect"
    },
    {
      "id": "edit-condition",
      "label": "Edit existing ABAC condition",
      "description": "Keep tag clause, add ledger-exports container allowance in place — avoids RequestDisallowedByPolicy on recreate",
      "command": "Set-AzRoleAssignment -ObjectId <managedIdentityPrincipalId> -RoleDefinitionName 'Storage Blob Data Reader' -Scope $scope -Condition $condition -ConditionVersion '2.0'; Get-AzRoleAssignment -Scope $scope | Select-Object DisplayName,Condition,ConditionVersion",
      "kind": "stage-fix"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 100,
    "reusedFromCatalog": false,
    "reuseCount": 1,
    "tsxStubPath": "data/synthesized-elements/FinanceBlobAbacConditionFix.tsx",
    "synthesizedAt": "2026-10-29T00:09:06.488Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/FinanceBlobAbacConditionFix.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
