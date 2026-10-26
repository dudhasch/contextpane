import { psq, runPwshJson } from "./pwsh.ts";

/**
 * Bearer tokens minted from the cached Az sign-in (one `Connect-AzAccount` on the
 * machine) and kept in memory, so hot reads are a plain fetch() instead of a cold
 * pwsh spawn + module import per query. One pwsh run per resource per ~45 minutes.
 */

const MAX_TTL_MS = 45 * 60_000;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000;

const cache = new Map<string, { token: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string>>();

export async function getAccessToken(resourceUrl: string, timeoutMs = 30_000): Promise<string> {
  const hit = cache.get(resourceUrl);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const pending = inflight.get(resourceUrl);
  if (pending) return pending;
  const mint = (async () => {
    const result = await runPwshJson<{ token: string; expiresOn: string }>(
      `
if (-not (Get-Command Get-AzAccessToken -ErrorAction SilentlyContinue)) { throw 'Az.Accounts module is not installed.' }
if (-not (Get-AzContext)) { throw 'No Azure context. Run Connect-AzAccount first.' }
$t = Get-AzAccessToken -ResourceUrl ${psq(resourceUrl)} -AsSecureString -ErrorAction Stop
[pscustomobject]@{ token = [System.Net.NetworkCredential]::new('', $t.Token).Password; expiresOn = $t.ExpiresOn.UtcDateTime.ToString('o') } | ConvertTo-Json -Compress
`,
      { timeoutMs },
    );
    const expiry = Date.parse(result.expiresOn) - REFRESH_BEFORE_EXPIRY_MS;
    cache.set(resourceUrl, { token: result.token, expiresAt: Math.min(Date.now() + MAX_TTL_MS, Number.isFinite(expiry) ? expiry : Date.now() + MAX_TTL_MS) });
    return result.token;
  })().finally(() => inflight.delete(resourceUrl));
  inflight.set(resourceUrl, mint);
  return mint;
}

export function invalidateAccessToken(resourceUrl: string) {
  cache.delete(resourceUrl);
}

/** Claims of a cached token (tid, upn, scp) without a network call; null before the first mint. */
export function cachedTokenClaims(resourceUrl: string): Record<string, unknown> | null {
  const hit = cache.get(resourceUrl);
  const payload = hit?.token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
