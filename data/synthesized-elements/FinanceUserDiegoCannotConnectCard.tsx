import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const FinanceUserDiegoCannotConnectCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_FINANCEUSERDIEGOCANNOTCONNECTCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "FinanceUserDiegoCannotConnectCard",
  "title": "Finance user Diego cannot connect to AVD and firewall port 3389 looks open",
  "headline": "Ticket \"Finance user Diego cannot connect to AVD and firewall port 3389 looks open\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"Finance user Diego cannot connect to AVD and firewall port 3389 looks open\" requires a bespoke diagnostic and remediation card.",
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
      "title": "Finance user Diego cannot connect to AVD and firewall port 3389 looks open · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "FinanceUserDiegoCannotConnectCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "Finance user Diego cannot connect to AVD and firewall port 3389 looks open · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "Finance user Diego cannot connect to AVD and firewall port 3389 looks open",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"Finance user Diego cannot connect to AVD and firewall port 3389 looks open\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Finance user Diego cannot connect to AVD and firewall port 3389 looks open · Posture",
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
          "item": "FinanceUserDiegoCannotConnectCard",
          "state": "Ticket \"Finance user Diego cannot connect to AVD and firewall port 3389 looks open\" requires a bespoke diagnostic and re"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Finance user Diego cannot connect to AVD and firewall port 3389 looks open · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "Finance user Diego cannot connect to AVD and firewall port 3389 looks open · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:46.737Z",
          "operation": "FinanceUserDiegoCannotConnectCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"Finance user Diego cannot connect to AVD and firewall port 3389 looks open\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"Finance user Diego cannot connect to AVD and firewall port 3389 looks open\" requires a bespoke diagnostic and remediation card.",
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
    "tsxStubPath": "data/synthesized-elements/FinanceUserDiegoCannotConnectCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:46.737Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/FinanceUserDiegoCannotConnectCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
