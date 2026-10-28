import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const AzureVmDeploymentFailedInCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_AZUREVMDEPLOYMENTFAILEDINCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "AzureVmDeploymentFailedInCard",
  "title": "Azure VM deployment failed in westeurope",
  "headline": "Ticket \"Azure VM deployment failed in westeurope\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"Azure VM deployment failed in westeurope\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Azure VM deployment failed in westeurope · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "AzureVmDeploymentFailedInCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Azure VM deployment failed in westeurope · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "Azure VM deployment failed in westeurope",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"Azure VM deployment failed in westeurope\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Azure VM deployment failed in westeurope · Posture",
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
          "item": "AzureVmDeploymentFailedInCard",
          "state": "Ticket \"Azure VM deployment failed in westeurope\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Azure VM deployment failed in westeurope · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "Azure VM deployment failed in westeurope · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:43.446Z",
          "operation": "AzureVmDeploymentFailedInCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"Azure VM deployment failed in westeurope\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"Azure VM deployment failed in westeurope\" requires a bespoke diagnostic and remediation card.",
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
    "tsxStubPath": "data/synthesized-elements/AzureVmDeploymentFailedInCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:43.446Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/AzureVmDeploymentFailedInCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
