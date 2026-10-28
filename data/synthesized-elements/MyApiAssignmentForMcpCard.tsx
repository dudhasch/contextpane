import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";
export const MyApiAssignmentForMcpCardPropsSchema = SynthesizedDynamicCardSchema;
export const DEFAULT_MYAPIASSIGNMENTFORMCPCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "MyApiAssignmentForMcpCard",
  "title": "my api assignment for mcp.read disappeared on my entra app",
  "headline": "mcp.read is absent from RequiredResourceAccess and has no consent grant — audit trail points to an app update that overwrote API permissions, not an expiry.",
  "domain": "azure",
  "reason": "Ticket \"my api assignment for mcp.read disappeared on my entra app\" requires a bespoke diagnostic and remediation card.",
  "state": "critical",
  "requiredPrimitives": [
    "quota-gauges",
    "policy-chain",
    "data-table",
    "config-diff",
    "event-stream"
  ],
  "blocks": [
    {
      "kind": "quota-gauges",
      "title": "my api assignment for mcp.read disappeared on my entra app · Resource & State Metrics",
      "gauges": [
        {
          "id": "api-permissions-configured",
          "label": "API Permissions Configured",
          "used": 2,
          "limit": 3,
          "unit": "permissions",
          "status": "critical",
          "detail": "User.Read + mcp.write present; mcp.read (Delegated) missing from requiredResourceAccess"
        },
        {
          "id": "admin-consent-grants",
          "label": "Consent Grants for mcp.read",
          "used": 0,
          "limit": 1,
          "unit": "grants",
          "status": "critical",
          "detail": "No oauth2PermissionGrant / appRoleAssignment for mcp.read on the service principal"
        },
        {
          "id": "removal-audit-events",
          "label": "Removal Audit Events (14d)",
          "used": 1,
          "limit": 1,
          "unit": "events",
          "status": "warning",
          "detail": "1x Update application event correlated with permission removal; no Delete service principal event"
        }
      ]
    },
    {
      "kind": "policy-chain",
      "title": "my api assignment for mcp.read disappeared on my entra app · Control-Plane Evaluation Chain",
      "hops": [
        {
          "step": "1",
          "node": "App Registration (Graph applications)",
          "effect": "Deny",
          "code": "RequiredResourceAccessMissing",
          "detail": "Get-MgApplication shows requiredResourceAccess for the MCP API resource without the mcp.read scope Id"
        },
        {
          "step": "2",
          "node": "Service Principal Consent",
          "effect": "Deny",
          "code": "ConsentGrantMissing",
          "detail": "Get-MgServicePrincipalOauth2PermissionGrant returns no grant containing mcp.read; token requests therefore omit the scope"
        },
        {
          "step": "3",
          "node": "Directory Audit Log",
          "effect": "Audit",
          "code": "UpdateApplication",
          "detail": "AuditLog 'Update application' modified RequiredResourceAccess — consistent with a deployment/IaC overwrite that re-declared permissions without mcp.read"
        },
        {
          "step": "4",
          "node": "Exposed API (Resource App)",
          "effect": "Pass",
          "code": "ScopeStillPublished",
          "detail": "Resource API still publishes oauth2PermissionScope mcp.read (enabled), so the scope was not deleted at source"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "Entra API Permissions — Expected vs Live (MCP API)",
      "columns": [
        {
          "key": "permission",
          "label": "Permission",
          "mono": true
        },
        {
          "key": "type",
          "label": "Type",
          "mono": false
        },
        {
          "key": "resource",
          "label": "Resource API",
          "mono": false
        },
        {
          "key": "status",
          "label": "Status",
          "mono": false
        }
      ],
      "rows": [
        {
          "permission": "mcp.read",
          "type": "Delegated (Scope)",
          "resource": "Contoso MCP API",
          "status": "Missing — not in requiredResourceAccess, no consent"
        },
        {
          "permission": "mcp.write",
          "type": "Delegated (Scope)",
          "resource": "Contoso MCP API",
          "status": "Present — configured and admin-consented"
        },
        {
          "permission": "User.Read",
          "type": "Delegated (Scope)",
          "resource": "Microsoft Graph",
          "status": "Present — configured and admin-consented"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "Restore mcp.read — Microsoft Graph PowerShell 7",
      "filePath": "scripts/restore-mcp-read-permission.ps1",
      "language": "powershell",
      "diff": "-# Live: requiredResourceAccess for MCP API = [mcp.write] only; mcp.read removed\n+# Restore: requiredResourceAccess for MCP API = [mcp.write, mcp.read] + admin consent\n+Connect-MgGraph -Scopes \"Application.ReadWrite.All,DelegatedPermissionGrant.ReadWrite.All\"\n+$apiSp  = Get-MgServicePrincipal -Filter \"displayName eq 'Contoso MCP API'\"\n+$app    = Get-MgApplication -Filter \"displayName eq 'Contoso MCP Client'\"\n+$scope  = $apiSp.Oauth2PermissionScopes | Where-Object Value -eq 'mcp.read'\n-$access = @{ ResourceAppId=$apiSp.AppId; ResourceAccess=@(@{Id='<mcp.write-id>';Type='Scope'}) }\n+$access = @{ ResourceAppId=$apiSp.AppId; ResourceAccess=@(@{Id='<mcp.write-id>';Type='Scope'},@{Id=$scope.Id;Type='Scope'}) }\n+Update-MgApplication -ApplicationId $app.Id -RequiredResourceAccess @($access)\n+$sp = Get-MgServicePrincipal -Filter \"appId eq '$($app.AppId)'\"\n+New-MgOauth2PermissionGrant -ClientId $sp.Id -ConsentType AllPrincipals -ResourceId $apiSp.Id -Scope 'mcp.read mcp.write'\n+Get-MgApplication -ApplicationId $app.Id | Select-Object -ExpandProperty RequiredResourceAccess"
    },
    {
      "kind": "event-stream",
      "title": "my api assignment for mcp.read disappeared on my entra app · Audit & Activity Log",
      "events": [
        {
          "id": "evt-audit-update-app-001",
          "timestamp": "2026-10-27T14:18:00Z",
          "operation": "Update application",
          "status": "Succeeded",
          "code": "DirectoryAudit.UpdateApplication",
          "caller": "deployment-pipeline / app-owner (see audit initiatedBy)",
          "detail": "RequiredResourceAccess modified; mcp.read scope Id removed while mcp.write retained — likely IaC/manifest overwrite"
        },
        {
          "id": "evt-consent-missing-002",
          "timestamp": "2026-10-27T14:19:00Z",
          "operation": "GET /servicePrincipals/{id}/oauth2PermissionGrants",
          "status": "Warning",
          "code": "ConsentGrantMissing",
          "caller": "Microsoft Graph",
          "detail": "No oauth2PermissionGrant containing mcp.read for the client service principal; delegated consent must be re-granted after restore"
        },
        {
          "id": "evt-scope-published-003",
          "timestamp": "2026-10-28T09:02:00Z",
          "operation": "GET /servicePrincipals (MCP API) oauth2PermissionScopes",
          "status": "Succeeded",
          "code": "ScopeEnabled",
          "caller": "Microsoft Graph",
          "detail": "mcp.read still exists and isEnabled=true on the resource API, confirming removal was client-side only"
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "restore-mcp-read",
      "label": "Stage Fix: Restore mcp.read + Consent",
      "description": "Re-add mcp.read to requiredResourceAccess and re-grant admin consent, then verify the scope appears on the app.",
      "command": "Connect-MgGraph -Scopes 'Application.ReadWrite.All,DelegatedPermissionGrant.ReadWrite.All'; $apiSp=Get-MgServicePrincipal -Filter \"displayName eq 'Contoso MCP API'\"; $app=Get-MgApplication -Filter \"displayName eq 'Contoso MCP Client'\"; $scope=$apiSp.Oauth2PermissionScopes|Where-Object Value -eq 'mcp.read'; Update-MgApplication -ApplicationId $app.Id -RequiredResourceAccess @(@{ResourceAppId=$apiSp.AppId;ResourceAccess=@(@{Id=$scope.Id;Type='Scope'})})",
      "kind": "stage-fix"
    },
    {
      "id": "inspect-audit-removal",
      "label": "Inspect Who Removed It",
      "description": "Query directory audit logs for Update application events to identify the actor/pipeline that overwrote permissions before re-applying from IaC.",
      "command": "Connect-MgGraph -Scopes 'AuditLog.Read.All,Application.Read.All'; Get-MgAuditLogDirectoryAudit -Filter \"activityDisplayName eq 'Update application'\" -Top 20 | Select-Object ActivityDateTime,ActivityDisplayName,Result,@{n='Actor';e={$_.InitiatedBy.User.UserPrincipalName}},TargetResources",
      "kind": "inspect"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 100,
    "reusedFromCatalog": false,
    "reuseCount": 1,
    "tsxStubPath": "data/synthesized-elements/MyApiAssignmentForMcpCard.tsx",
    "synthesizedAt": "2026-10-28T09:59:02.523Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/MyApiAssignmentForMcpCard.tsx",
    "startLine": 1,
    "endLine": 12,
    "ref": "dynamic-catalog"
  }
};
