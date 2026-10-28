import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const FinanceUsersBlockedByCaCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_FINANCEUSERSBLOCKEDBYCACARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "FinanceUsersBlockedByCaCard",
  "title": "Finance users blocked by CA-001 since the break-glass change (AADSTS53003)",
  "headline": "Ticket \"Finance users blocked by CA-001 since the break-glass change (AADSTS53003)\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"Finance users blocked by CA-001 since the break-glass change (AADSTS53003)\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Finance users blocked by CA-001 since the break-glass change (AADSTS53003) · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "FinanceUsersBlockedByCaCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Finance users blocked by CA-001 since the break-glass change (AADSTS53003) · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "Finance users blocked by CA-001 since the break-glass change (AADSTS53003)",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"Finance users blocked by CA-001 since the break-glass change (AADSTS53003)\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Finance users blocked by CA-001 since the break-glass change (AADSTS53003) · Posture",
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
          "item": "FinanceUsersBlockedByCaCard",
          "state": "Ticket \"Finance users blocked by CA-001 since the break-glass change (AADSTS53003)\" requires a bespoke diagnostic and re"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Finance users blocked by CA-001 since the break-glass change (AADSTS53003) · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "Finance users blocked by CA-001 since the break-glass change (AADSTS53003) · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:31.680Z",
          "operation": "FinanceUsersBlockedByCaCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"Finance users blocked by CA-001 since the break-glass change (AADSTS53003)\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"Finance users blocked by CA-001 since the break-glass change (AADSTS53003)\" requires a bespoke diagnostic and remediation card.",
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
    "tsxStubPath": "data/synthesized-elements/FinanceUsersBlockedByCaCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:31.680Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/FinanceUsersBlockedByCaCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
