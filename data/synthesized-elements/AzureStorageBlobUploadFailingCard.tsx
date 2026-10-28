import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const AzureStorageBlobUploadFailingCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_AZURESTORAGEBLOBUPLOADFAILINGCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "AzureStorageBlobUploadFailingCard",
  "title": "Azure Storage Blob Upload Failing — AuthorizationPermissionMismatch",
  "headline": "spn-contoso-datalake-ingest has Contributor (control-plane only) on stcontosofinlake01 — PutBlob requires Storage Blob Data Contributor data-plane role",
  "domain": "azure",
  "reason": "Ticket \"Azure Storage blob upload failing with AuthorizationPermissionMismatch despite C\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Azure Storage Blob Upload Failing — AuthorizationPermissionMismatch · Resource & State Metrics",
      "gauges": [
        {
          "id": "data-plane-roles",
          "label": "Data-Plane Roles Assigned",
          "used": 0,
          "limit": 1,
          "unit": "roles",
          "status": "critical",
          "detail": "0 Storage Blob Data * roles for spn-contoso-datalake-ingest on stcontosofinlake01"
        },
        {
          "id": "putblob-failures",
          "label": "PutBlob 403 Failures (1h)",
          "used": 94,
          "limit": 100,
          "unit": "% failed",
          "status": "critical",
          "detail": "94% of PutBlob calls since 09:15 UTC return AuthorizationPermissionMismatch"
        },
        {
          "id": "control-plane-roles",
          "label": "Control-Plane Contributor",
          "used": 1,
          "limit": 1,
          "unit": "assignments",
          "status": "warning",
          "detail": "Contributor present but grants Microsoft.Storage/storageAccounts/write, not blob data actions"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Azure Storage Blob Upload Failing — AuthorizationPermissionMismatch · Control-Plane Evaluation Chain",
      "hops": [
        {
          "step": "1",
          "node": "Azure RBAC — ARM Control Plane",
          "effect": "Pass",
          "code": "Contributor",
          "detail": "spn-contoso-datalake-ingest authenticated; Contributor allows management of stcontosofinlake01, not data operations"
        },
        {
          "step": "2",
          "node": "Storage Data-Plane Authorization",
          "effect": "Deny",
          "code": "AuthorizationPermissionMismatch",
          "detail": "PutBlob requires Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write — absent without Storage Blob Data Contributor/Owner"
        },
        {
          "step": "3",
          "node": "Storage Account stcontosofinlake01",
          "effect": "Deny",
          "code": "HTTP 403",
          "detail": "Blob service rejects request at container scope; no SAS/SharedKey fallback permitted by pipeline (AAD auth-mode login)"
        },
        {
          "step": "4",
          "node": "Remediation Scope Check",
          "effect": "Audit",
          "code": "LeastPrivilege",
          "detail": "Grant Storage Blob Data Contributor at storage-account (or ingest container) scope only — do not elevate to Owner"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "RBAC Assignments — spn-contoso-datalake-ingest on stcontosofinlake01",
      "columns": [
        {
          "key": "principal",
          "label": "Principal",
          "mono": true
        },
        {
          "key": "role",
          "label": "Role",
          "mono": false
        },
        {
          "key": "scope",
          "label": "Scope",
          "mono": true
        },
        {
          "key": "dataAction",
          "label": "Blob Write DataAction",
          "mono": false
        }
      ],
      "rows": [
        {
          "principal": "spn-contoso-datalake-ingest",
          "role": "Contributor",
          "scope": "storageAccounts/stcontosofinlake01",
          "dataAction": "No — control-plane only"
        },
        {
          "principal": "spn-contoso-datalake-ingest",
          "role": "Storage Blob Data Contributor",
          "scope": "(missing)",
          "dataAction": "Required: blobs/write — NOT ASSIGNED"
        },
        {
          "principal": "spn-contoso-datalake-ingest",
          "role": "Reader",
          "scope": "resourceGroups/rg-contoso-fin-data (inherited)",
          "dataAction": "No — read control-plane only"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Grant Storage Blob Data Contributor (PowerShell 7 / Azure CLI)",
      "filePath": "remediation/grant-blob-data-contributor.ps1",
      "language": "powershell",
      "diff": "- # Contributor cannot PutBlob: it has no Microsoft.Storage/.../blobs/write dataAction\n- az role assignment list --assignee spn-contoso-datalake-ingest --scope $scope -o table\n+ $scope = \"/subscriptions/<sub-id>/resourceGroups/rg-contoso-fin-data/providers/Microsoft.Storage/storageAccounts/stcontosofinlake01\"\n+ $spId = (Get-AzADServicePrincipal -DisplayName \"spn-contoso-datalake-ingest\").Id\n+ # Least-privilege data-plane grant at storage-account scope (narrow to container if possible)\n+ New-AzRoleAssignment -ObjectId $spId -RoleDefinitionName \"Storage Blob Data Contributor\" -Scope $scope\n+ # Azure CLI equivalent:\n+ # az role assignment create --assignee-object-id $spId --assignee-principal-type ServicePrincipal --role \"Storage Blob Data Contributor\" --scope $scope\n+ Get-AzRoleAssignment -ObjectId $spId -Scope $scope | Format-Table RoleDefinitionName, Scope\n+ # Wait 5-10 min for RBAC propagation, then verify with AAD login:\n+ az storage blob upload --account-name stcontosofinlake01 --container-name ingest --name smoke.txt --file ./smoke.txt --auth-mode login"
    },
    {
      "kind": "event-stream",
      "title": "Azure Storage Blob Upload Failing — AuthorizationPermissionMismatch · Audit & Activity Log",
      "events": [
        {
          "id": "evt-0915-putblob",
          "timestamp": "2026-10-28T09:15:00Z",
          "operation": "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write (PutBlob)",
          "status": "Failed",
          "code": "AuthorizationPermissionMismatch",
          "caller": "spn-contoso-datalake-ingest",
          "detail": "HTTP 403: This request is not authorized to perform this operation using this permission — first failure after 09:15 UTC"
        },
        {
          "id": "evt-0917-rbac-list",
          "timestamp": "2026-10-28T09:17:00Z",
          "operation": "Microsoft.Authorization/roleAssignments/read",
          "status": "Succeeded",
          "code": "200",
          "caller": "spn-contoso-datalake-ingest",
          "detail": "Role list confirms only Contributor + inherited Reader; no Storage Blob Data Contributor/Owner assignment found"
        },
        {
          "id": "evt-0922-retry",
          "timestamp": "2026-10-28T09:22:00Z",
          "operation": "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write (PutBlob)",
          "status": "Failed",
          "code": "AuthorizationPermissionMismatch",
          "caller": "spn-contoso-datalake-ingest",
          "detail": "Pipeline retry to container 'ingest' fails identically — deterministic RBAC denial, not transient/network"
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-grant",
      "label": "Stage Blob Data Contributor Grant",
      "description": "Create Storage Blob Data Contributor assignment for spn-contoso-datalake-ingest at stcontosofinlake01 scope, then wait for propagation",
      "command": "New-AzRoleAssignment -ObjectId (Get-AzADServicePrincipal -DisplayName 'spn-contoso-datalake-ingest').Id -RoleDefinitionName 'Storage Blob Data Contributor' -Scope '/subscriptions/<sub-id>/resourceGroups/rg-contoso-fin-data/providers/Microsoft.Storage/storageAccounts/stcontosofinlake01'",
      "kind": "stage-fix"
    },
    {
      "id": "inspect-assignments",
      "label": "Inspect Current Assignments & Verify",
      "description": "List effective assignments and retry PutBlob with AAD login after 5-10 minutes to confirm 403 is cleared",
      "command": "az role assignment list --assignee spn-contoso-datalake-ingest --include-inherited --query '[].{Role:roleDefinitionName,Scope:scope}' -o table; az storage blob upload --account-name stcontosofinlake01 --container-name ingest --name smoke.txt --file ./smoke.txt --auth-mode login",
      "kind": "inspect"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 100,
    "reusedFromCatalog": false,
    "reuseCount": 1,
    "tsxStubPath": "data/synthesized-elements/AzureStorageBlobUploadFailingCard.tsx",
    "synthesizedAt": "2026-10-28T01:07:46.845Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/AzureStorageBlobUploadFailingCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
