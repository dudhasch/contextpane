import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const Inc202688483StorageAccountCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_INC202688483STORAGEACCOUNTCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "Inc202688483StorageAccountCard",
  "title": "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis",
  "headline": "Ticket \"INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis\" requires a bespoke diagnostic and remediation card.",
  "state": "warning",
  "requiredPrimitives": [
    "policy-chain",
    "data-table",
    "config-diff",
    "event-stream"
  ],
  "blocks": [
    {
      "kind": "quota-gauges",
      "title": "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "Inc202688483StorageAccountCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis · Posture",
      "columns": [
        {
          "key": "item",
          "label": "Target",
          "mono": true
        },
        {
          "key": "state",
          "label": "Observed State",
          "mono": false
        }
      ],
      "rows": [
        {
          "item": "Inc202688483StorageAccountCard",
          "state": "Ticket \"INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis\" requires a bespoke diagnostic "
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:46.284Z",
          "operation": "Inc202688483StorageAccountCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"INC-2026-88483 · Storage Account Private Endpoint 403 AuthorizationPermissionMis\" requires a bespoke diagnostic and remediation card",
      "command": "Get-AzResource -WhatIf",
      "kind": "stage-fix"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 1,
    "reusedFromCatalog": false,
    "reuseCount": 1,
    "tsxStubPath": "data/synthesized-elements/Inc202688483StorageAccountCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:46.284Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/Inc202688483StorageAccountCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
