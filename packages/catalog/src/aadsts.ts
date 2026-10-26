import type { ErrorCodeTranslation } from "./schemas/components.ts";

/**
 * Curated AADSTS translations. This is the deterministic ground truth the
 * Tier 1A hover engine falls back to (and that the LLM prompt is seeded with
 * so `muse-glimmer-30b` does not hallucinate meanings).
 */
export interface AadstsEntry extends ErrorCodeTranslation {
  numeric: number;
  category: "conditional-access" | "assignment" | "mfa" | "device" | "consent" | "credentials" | "other";
  severity: "critical" | "warning" | "info";
}

const DOCS = "https://learn.microsoft.com/entra/identity-platform/reference-error-codes";

export const AADSTS_CATALOG: Record<string, AadstsEntry> = {
  AADSTS53003: {
    numeric: 53003,
    code: "AADSTS53003",
    category: "conditional-access",
    severity: "critical",
    meaning: "Access blocked by a Conditional Access policy. The policy's grant control is Block, so no token is issued.",
    likelyCause:
      "The user is in scope of a policy targeting this app with a Block grant. Check the policy's included users/groups and the app assignment; a stale legacy group membership after a license migration is the usual culprit.",
    docsUrl: DOCS,
  },
  AADSTS53000: {
    numeric: 53000,
    code: "AADSTS53000",
    category: "device",
    severity: "critical",
    meaning: "Conditional Access requires a compliant or hybrid-joined device, and this device is neither.",
    likelyCause: "Device is not enrolled in Intune or compliance evaluation failed. Verify Intune enrollment and compliance state.",
    docsUrl: DOCS,
  },
  AADSTS50105: {
    numeric: 50105,
    code: "AADSTS50105",
    category: "assignment",
    severity: "critical",
    meaning: "The signed-in user is not assigned to a role for this application.",
    likelyCause:
      "The enterprise app requires user assignment and the user (or their group) is missing, or the service plan/license that grants the app is not assigned.",
    docsUrl: DOCS,
  },
  AADSTS50076: {
    numeric: 50076,
    code: "AADSTS50076",
    category: "mfa",
    severity: "warning",
    meaning: "Multi-factor authentication is required but was not satisfied in this session.",
    likelyCause: "Interactive MFA prompt required; usually transient. Persistent occurrences indicate a client that cannot perform interactive auth.",
    docsUrl: DOCS,
  },
  AADSTS50079: {
    numeric: 50079,
    code: "AADSTS50079",
    category: "mfa",
    severity: "warning",
    meaning: "The user must register security info before MFA can be enforced.",
    likelyCause: "New user, or MFA registration was reset. The user has to complete security info registration (aka.ms/mysecurityinfo) before signing in again.",
    docsUrl: DOCS,
  },
  AADSTS50058: {
    numeric: 50058,
    code: "AADSTS50058",
    category: "credentials",
    severity: "info",
    meaning: "Silent sign-in failed; the user must sign in interactively.",
    likelyCause: "No active session or the session cookie expired. Benign unless repeated.",
    docsUrl: DOCS,
  },
  AADSTS65001: {
    numeric: 65001,
    code: "AADSTS65001",
    category: "consent",
    severity: "warning",
    meaning: "The user or admin has not consented to the application.",
    likelyCause: "Admin consent missing for the requested permissions. Grant tenant-wide admin consent on the enterprise app.",
    docsUrl: DOCS,
  },
  AADSTS500121: {
    numeric: 500121,
    code: "AADSTS500121",
    category: "mfa",
    severity: "warning",
    meaning: "Authentication failed during the strong authentication (MFA) request.",
    likelyCause: "User denied or timed out on the MFA prompt, or the Authenticator app is not reachable.",
    docsUrl: DOCS,
  },
  AADSTS700016: {
    numeric: 700016,
    code: "AADSTS700016",
    category: "other",
    severity: "critical",
    meaning: "The application was not found in the directory.",
    likelyCause: "App registration deleted or the request targets the wrong tenant.",
    docsUrl: DOCS,
  },
};

export function lookupAadsts(codeOrNumber: string | number): AadstsEntry | null {
  const key = typeof codeOrNumber === "number" ? `AADSTS${codeOrNumber}` : codeOrNumber.toUpperCase().trim();
  return AADSTS_CATALOG[key] ?? null;
}

export function toAadstsLabel(errorCode: number): string | undefined {
  return errorCode > 0 ? `AADSTS${errorCode}` : undefined;
}
