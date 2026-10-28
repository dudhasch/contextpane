import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const SpeE5GroupLicensingShowsCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_SPEE5GROUPLICENSINGSHOWSCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "SpeE5GroupLicensingShowsCard",
  "title": "SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams",
  "headline": "Ticket \"SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams\" requires a bespoke diagnostic and remediation card.",
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
      "title": "SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "SpeE5GroupLicensingShowsCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams · Posture",
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
          "item": "SpeE5GroupLicensingShowsCard",
          "state": "Ticket \"SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams\" requires a bespoke diagnostic and re"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:45.767Z",
          "operation": "SpeE5GroupLicensingShowsCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"SPE_E5 group licensing shows CountViolation and Diego Siciliani lost Teams\" requires a bespoke diagnostic and remediation card.",
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
    "tsxStubPath": "data/synthesized-elements/SpeE5GroupLicensingShowsCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:45.767Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/SpeE5GroupLicensingShowsCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
