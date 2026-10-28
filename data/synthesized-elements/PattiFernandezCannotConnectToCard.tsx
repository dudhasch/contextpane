import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const PattiFernandezCannotConnectToCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_PATTIFERNANDEZCANNOTCONNECTTOCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "PattiFernandezCannotConnectToCard",
  "title": "Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t",
  "headline": "Ticket \"Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "PattiFernandezCannotConnectToCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t · Posture",
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
          "item": "PattiFernandezCannotConnectToCard",
          "state": "Ticket \"Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t\" requires a bespoke diagnostic "
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:31.637Z",
          "operation": "PattiFernandezCannotConnectToCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"Patti Fernandez cannot connect to AVD (AADSTS53003) and RDP 3389 looks open on t\" requires a bespoke diagnostic and remediation card",
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
    "tsxStubPath": "data/synthesized-elements/PattiFernandezCannotConnectToCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:31.637Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/PattiFernandezCannotConnectToCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
