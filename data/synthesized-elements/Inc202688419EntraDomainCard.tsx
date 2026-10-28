import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const Inc202688419EntraDomainCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_INC202688419ENTRADOMAINCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "Inc202688419EntraDomainCard",
  "title": "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening",
  "headline": "Ticket \"INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening\" requires a bespoke diagnostic and remediation card.",
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
      "title": "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "Inc202688419EntraDomainCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening · Posture",
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
          "item": "Inc202688419EntraDomainCard",
          "state": "Ticket \"INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening\" requires a bespoke diagnostic and"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:45.899Z",
          "operation": "Inc202688419EntraDomainCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"INC-2026-88419 · Entra Domain Services (AAD DS) Suspended After NSG Hardening\" requires a bespoke diagnostic and remediation card.",
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
    "tsxStubPath": "data/synthesized-elements/Inc202688419EntraDomainCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:45.899Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/Inc202688419EntraDomainCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
