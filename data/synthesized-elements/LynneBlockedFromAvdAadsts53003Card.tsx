import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const LynneBlockedFromAvdAadsts53003CardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_LYNNEBLOCKEDFROMAVDAADSTS53003CARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "LynneBlockedFromAvdAadsts53003Card",
  "title": "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-",
  "headline": "Ticket \"Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool- · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "LynneBlockedFromAvdAadsts53003Card",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool- · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool- · Posture",
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
          "item": "LynneBlockedFromAvdAadsts53003Card",
          "state": "Ticket \"Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-\" requires a bespoke diagnostic "
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool- · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool- · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:45.665Z",
          "operation": "LynneBlockedFromAvdAadsts53003Card",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"Lynne blocked from AVD (AADSTS53003), RDP 3389 open on nsg-contoso-avd-hostpool-\" requires a bespoke diagnostic and remediation card",
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
    "tsxStubPath": "data/synthesized-elements/LynneBlockedFromAvdAadsts53003Card.tsx",
    "synthesizedAt": "2026-10-28T10:49:45.665Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/LynneBlockedFromAvdAadsts53003Card.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
