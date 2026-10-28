import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const Inc202688491VirtualNetworkCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_INC202688491VIRTUALNETWORKCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "Inc202688491VirtualNetworkCard",
  "title": "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase ",
  "headline": "Ticket \"INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase \" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase \" requires a bespoke diagnostic and remediation card.",
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
      "title": "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase  · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "Inc202688491VirtualNetworkCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase  · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase ",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase \" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase  · Posture",
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
          "item": "Inc202688491VirtualNetworkCard",
          "state": "Ticket \"INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase \" requires a bespoke diagnostic "
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase  · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase  · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:46.326Z",
          "operation": "Inc202688491VirtualNetworkCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase \" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"INC-2026-88491 · Virtual Network Gateway IPsec Tunnel Drop Every 8 Hours (Phase \" requires a bespoke diagnostic and remediation card",
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
    "tsxStubPath": "data/synthesized-elements/Inc202688491VirtualNetworkCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:46.326Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/Inc202688491VirtualNetworkCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
