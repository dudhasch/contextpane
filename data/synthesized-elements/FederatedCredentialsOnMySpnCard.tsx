import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const FederatedCredentialsOnMySpnCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_FEDERATEDCREDENTIALSONMYSPNCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "FederatedCredentialsOnMySpnCard",
  "title": "Federated Credentials on my spn stopped working",
  "headline": "Ticket \"Federated Credentials on my spn stopped working\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"Federated Credentials on my spn stopped working\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Federated Credentials on my spn stopped working · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "FederatedCredentialsOnMySpnCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Federated Credentials on my spn stopped working · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "Federated Credentials on my spn stopped working",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"Federated Credentials on my spn stopped working\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Federated Credentials on my spn stopped working · Posture",
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
          "item": "FederatedCredentialsOnMySpnCard",
          "state": "Ticket \"Federated Credentials on my spn stopped working\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Federated Credentials on my spn stopped working · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "Federated Credentials on my spn stopped working · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:43.495Z",
          "operation": "FederatedCredentialsOnMySpnCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"Federated Credentials on my spn stopped working\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"Federated Credentials on my spn stopped working\" requires a bespoke diagnostic and remediation card.",
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
    "tsxStubPath": "data/synthesized-elements/FederatedCredentialsOnMySpnCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:43.495Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/FederatedCredentialsOnMySpnCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
