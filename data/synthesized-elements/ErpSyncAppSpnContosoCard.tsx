import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const ErpSyncAppSpnContosoCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_ERPSYNCAPPSPNCONTOSOCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "ErpSyncAppSpnContosoCard",
  "title": "ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se",
  "headline": "Ticket \"ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se\" requires a bespoke diagnostic and remediation card.",
  "domain": "azure",
  "reason": "Ticket \"ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se\" requires a bespoke diagnostic and remediation card.",
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
      "title": "ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se · Resource Utilization",
      "gauges": [
        {
          "id": "g1",
          "label": "ErpSyncAppSpnContosoCard",
          "used": 1,
          "limit": 1,
          "unit": "state",
          "status": "warning"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se · Evaluation Chain",
      "hops": [
        {
          "step": "Step 1 · Control-Plane Check",
          "node": "ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se",
          "effect": "Audit",
          "code": "DiagnosticCheck",
          "detail": "Ticket \"ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se\" requires a bespoke diagnostic and remediation card."
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se · Posture",
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
          "item": "ErpSyncAppSpnContosoCard",
          "state": "Ticket \"ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se\" requires a bespoke diagnostic "
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se · Remediation Diff",
      "filePath": "remediation.ps1",
      "language": "powershell",
      "diff": "- # Current state\n+ Get-AzResource -WhatIf"
    },
    {
      "kind": "event-stream",
      "title": "ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se · Activity & Audit Log",
      "events": [
        {
          "id": "ev1",
          "timestamp": "2026-10-28T10:49:45.716Z",
          "operation": "ErpSyncAppSpnContosoCard",
          "status": "Warning",
          "code": "DiagnosticEvent",
          "caller": "ControlPlane",
          "detail": "Ticket \"ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se\" requires a bespoke diagnostic and remediation card."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "stage-fix",
      "label": "Stage Remediation Fix",
      "description": "Ticket \"ERP sync app spn-contoso-erp-sync failing nightly with AADSTS7000222 (expired se\" requires a bespoke diagnostic and remediation card",
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
    "tsxStubPath": "data/synthesized-elements/ErpSyncAppSpnContosoCard.tsx",
    "synthesizedAt": "2026-10-28T10:49:45.716Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/ErpSyncAppSpnContosoCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
