/**
 * Auto-Synthesized ContextPane UI Element (EntraOidcFederatedCredentialMismatchCard)
 * Gatekeeper: muse-spark-1.3 -> Synthesizer: muse-wonder-1.0
 * Domain: identity | Primitives: policy-chain, data-table, config-diff, event-stream
 * Generated At: 2026-10-27T23:35:08.280Z
 */
import { z } from "zod";
import { SynthesizedDynamicCardSchema, type SynthesizedDynamicCard } from "@contextpane/catalog";

export const EntraOidcFederatedCredentialMismatchCardPropsSchema = SynthesizedDynamicCardSchema.extend({
  elementId: z.literal("EntraOidcFederatedCredentialMismatchCard"),
  domain: z.literal("identity"),
});
export type EntraOidcFederatedCredentialMismatchCardProps = z.infer<typeof EntraOidcFederatedCredentialMismatchCardPropsSchema>;

export const DEFAULT_ENTRAOIDCFEDERATEDCREDENTIALMISMATCHCARD_SPEC: SynthesizedDynamicCard = {
  "elementId": "EntraOidcFederatedCredentialMismatchCard",
  "title": "Entra ID Workload Identity Federation (OIDC Subject Claim Mismatch)",
  "headline": "OIDC Token Exchange Failed (AADSTS70021) on spn-contoso-erp-sync · Presented JWT sub 'repo:contoso/erp-sync:environment:production' != Configured 'repo:contoso/erp-sync:ref:refs/heads/main'",
  "domain": "identity",
  "reason": "Static EntraSignInTimeline inspects CA policies and expired client secrets (AADSTS7000222), not OIDC JWT subject claim diffs (sub vs federatedIdentityCredential.subject) or GitHub Actions workflow ref/environment mismatches (AADSTS70021).",
  "state": "critical",
  "requiredPrimitives": [
    "policy-chain",
    "data-table",
    "config-diff",
    "event-stream"
  ],
  "blocks": [
    {
      "kind": "policy-chain",
      "title": "OIDC Token Exchange Evaluation Chain (Entra STS <- GitHub Actions OIDC Provider)",
      "hops": [
        {
          "step": "Hop 1 · Issuer Verification (https://token.actions.githubusercontent.com)",
          "node": "OIDC Discovery & JWKS Signature Validation",
          "effect": "Pass",
          "code": "IssuerMatched",
          "detail": "Presented JWT 'iss' claim matches configured federatedIdentityCredential.issuer ('https://token.actions.githubusercontent.com').",
          "policyId": "fic-spn-contoso-erp-sync-01"
        },
        {
          "step": "Hop 2 · Audience Verification (api://AzureADTokenExchange)",
          "node": "Entra Workload Identity Token Exchange Audience Gate",
          "effect": "Pass",
          "code": "AudienceMatched",
          "detail": "Presented JWT 'aud' claim matches configured federatedIdentityCredential.audiences (['api://AzureADTokenExchange']).",
          "policyId": "fic-spn-contoso-erp-sync-01"
        },
        {
          "step": "Hop 3 · Subject Identifier Match (sub claim)",
          "node": "Entra federatedIdentityCredential.subject Strict String Comparison",
          "effect": "Deny",
          "code": "AADSTS70021",
          "detail": "Deny (AADSTS70021: Presented 'repo:contoso/erp-sync:environment:production' != Configured 'repo:contoso/erp-sync:ref:refs/heads/main'). Adding 'environment: production' to the GitHub Actions job altered the OIDC subject claim.",
          "policyId": "44b8e1a7-9c2d-4d6a-8f11-001122334455"
        }
      ]
    },
    {
      "kind": "data-table",
      "title": "OIDC JWT Token Claim vs. Entra federatedIdentityCredential Comparison Matrix",
      "columns": [
        {
          "key": "claim",
          "label": "OIDC Claim / Field",
          "mono": true
        },
        {
          "key": "presentedJwt",
          "label": "Presented GitHub Actions JWT",
          "mono": true
        },
        {
          "key": "configuredEntra",
          "label": "Configured Entra federatedIdentityCredential",
          "mono": true
        },
        {
          "key": "verdict",
          "label": "STS Match Verdict",
          "mono": false
        }
      ],
      "rows": [
        {
          "claim": "issuer",
          "presentedJwt": "https://token.actions.githubusercontent.com",
          "configuredEntra": "https://token.actions.githubusercontent.com",
          "verdict": "Pass (Exact Match)"
        },
        {
          "claim": "audience (aud)",
          "presentedJwt": "api://AzureADTokenExchange",
          "configuredEntra": "api://AzureADTokenExchange",
          "verdict": "Pass (Exact Match)"
        },
        {
          "claim": "repository",
          "presentedJwt": "contoso/erp-sync",
          "configuredEntra": "contoso/erp-sync",
          "verdict": "Pass (Same Repo)"
        },
        {
          "claim": "subject (sub)",
          "presentedJwt": "repo:contoso/erp-sync:environment:production",
          "configuredEntra": "repo:contoso/erp-sync:ref:refs/heads/main",
          "verdict": "Mismatch (Triggers AADSTS70021)"
        },
        {
          "claim": "tokenEndpointResult",
          "presentedJwt": "POST /4cc41c20.../oauth2/v2.0/token",
          "configuredEntra": "App ID 44b8e1a7-9c2d-4d6a-8f11-001122334455",
          "verdict": "HTTP 400 invalid_client (AADSTS70021)"
        }
      ]
    },
    {
      "kind": "config-diff",
      "title": "IaC Remediation Diff (golden-tenant/entra/apps/spn-contoso-erp-sync-oidc.tf)",
      "filePath": "golden-tenant/entra/apps/spn-contoso-erp-sync-oidc.tf",
      "language": "terraform",
      "diff": "--- a/golden-tenant/entra/apps/spn-contoso-erp-sync-oidc.tf (branch-scoped subject)\n+++ b/golden-tenant/entra/apps/spn-contoso-erp-sync-oidc.tf (production environment subject)\n@@ -1,9 +1,9 @@\n resource \"azuread_application_federated_identity_credential\" \"github_actions_prod\" {\n   application_id = \"/applications/44b8e1a7-9c2d-4d6a-8f11-001122334455\"\n-  display_name   = \"github-actions-erp-sync-main\"\n+  display_name   = \"github-actions-erp-sync-production\"\n   description    = \"GitHub Actions OIDC Workload Identity Federation for spn-contoso-erp-sync\"\n   audiences      = [\"api://AzureADTokenExchange\"]\n   issuer         = \"https://token.actions.githubusercontent.com\"\n-  subject        = \"repo:contoso/erp-sync:ref:refs/heads/main\"\n+  subject        = \"repo:contoso/erp-sync:environment:production\"\n }"
    },
    {
      "kind": "event-stream",
      "title": "Entra Workload Identity Sign-In & Audit Log (spn-contoso-erp-sync)",
      "events": [
        {
          "id": "evt-oidc-01",
          "timestamp": "2026-10-27T14:22:11Z",
          "operation": "ServicePrincipalSignIn / OAuth2TokenExchange",
          "status": "Failed",
          "code": "AADSTS70021",
          "caller": "spn-contoso-erp-sync (44b8e1a7-9c2d-4d6a-8f11-001122334455)",
          "detail": "No matching federated identity record found for presented assertion subject 'repo:contoso/erp-sync:environment:production'."
        },
        {
          "id": "evt-oidc-02",
          "timestamp": "2026-10-27T14:22:14Z",
          "operation": "GET /v1.0/applications/44b8e1a7-9c2d-4d6a-8f11-001122334455/federatedIdentityCredentials",
          "status": "Succeeded",
          "code": "SubjectDriftDetected",
          "caller": "ContextPane-MCP-MsGraph",
          "detail": "Inspected federatedIdentityCredentials on spn-contoso-erp-sync: found subject 'repo:contoso/erp-sync:ref:refs/heads/main', missing 'repo:contoso/erp-sync:environment:production'."
        }
      ]
    }
  ],
  "recommendedActions": [
    {
      "id": "update-fic-subject",
      "label": "Update Federated Credential Subject to environment:production",
      "description": "Patch federatedIdentityCredential subject on spn-contoso-erp-sync to match GitHub Actions production environment",
      "command": "Update-MgApplicationFederatedIdentityCredential -ApplicationId \"44b8e1a7-9c2d-4d6a-8f11-001122334455\" -FederatedIdentityCredentialId \"fic-spn-contoso-erp-sync-01\" -Subject \"repo:contoso/erp-sync:environment:production\" -WhatIf",
      "kind": "stage-fix"
    },
    {
      "id": "add-fic-prod-env",
      "label": "Add Dedicated Production Environment Federated Credential",
      "description": "Create a new federatedIdentityCredential for repo:contoso/erp-sync:environment:production alongside main branch credential",
      "command": "New-MgApplicationFederatedIdentityCredential -ApplicationId \"44b8e1a7-9c2d-4d6a-8f11-001122334455\" -Name \"github-actions-erp-sync-production\" -Issuer \"https://token.actions.githubusercontent.com\" -Subject \"repo:contoso/erp-sync:environment:production\" -Audiences @(\"api://AzureADTokenExchange\") -WhatIf",
      "kind": "view-diff"
    }
  ],
  "synthesisMeta": {
    "gatekeeperModel": "muse-spark-1.3",
    "synthesizerModel": "muse-wonder-1.0",
    "latencyMs": 4,
    "reusedFromCatalog": true,
    "reuseCount": 3,
    "tsxStubPath": "data/synthesized-elements/EntraOidcFederatedCredentialMismatchCard.tsx",
    "synthesizedAt": "2026-10-27T23:35:08.280Z"
  },
  "sourceRef": {
    "file": "data/synthesized-elements/EntraOidcFederatedCredentialMismatchCard.tsx",
    "startLine": 1,
    "endLine": 26,
    "ref": "dynamic-catalog"
  }
};

export function EntraOidcFederatedCredentialMismatchCardTemplate(): SynthesizedDynamicCard {
  return DEFAULT_ENTRAOIDCFEDERATEDCREDENTIALMISMATCHCARD_SPEC;
}
