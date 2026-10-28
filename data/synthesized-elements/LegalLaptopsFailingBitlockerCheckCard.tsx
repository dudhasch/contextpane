import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const LegalLaptopsFailingBitlockerCheckCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_LEGALLAPTOPSFAILINGBITLOCKERCHECKCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "LegalLaptopsFailingBitlockerCheckCard",
  "title": "Legal laptops failing BitLocker check-in with conflict error",
  "headline": "Ticket \"Legal laptops failing BitLocker check-in with conflict error\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"Legal laptops failing BitLocker check-in with conflict error\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Legal laptops failing BitLocker check-in with conflict error · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "LegalLaptopsFailingBitlockerCheckCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Legal laptops failing BitLocker check-in with conflict error · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "Legal laptops failing BitLocker check-in with conflict error",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"Legal laptops failing BitLocker check-in with conflict error\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Legal laptops failing BitLocker check-in with conflict error · Posture",
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
          "item": "LegalLaptopsFailingBitlockerCheckCard",
          "state": "Ticket \"Legal laptops failing BitLocker check-in with conflict error\" requires a bespoke diagnostic and remediation card"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Legal laptops failing BitLocker check-in with conflict error · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "Legal laptops failing BitLocker check-in with conflict error · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:43.360Z",
          "operation": "LegalLaptopsFailingBitlockerCheckCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"Legal laptops failing BitLocker check-in with conflict error\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"Legal laptops failing BitLocker check-in with conflict error\" requires a bespoke diagnostic and remediation card.",
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
    "tsxStubPath": "data/synthesized-elements/LegalLaptopsFailingBitlockerCheckCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:43.360Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/LegalLaptopsFailingBitlockerCheckCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
