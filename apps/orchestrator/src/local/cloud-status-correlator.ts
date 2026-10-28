import type {
  UpstreamAdvisory,
  UpstreamCloudStatusCorrelation,
  UpstreamServiceHealth,
  WebSearchOutageCitation,
} from "@contextpane/catalog";
import * as msgraph from "@contextpane/mcp-msgraph";
import { isLiveCloudMode } from "../config.ts";

export interface IncidentTimestampWindow {
  windowStart: string;
  windowEnd: string;
  correlatedAtLabel: string;
  extractedTimeExpression: string | null;
}

const KNOWN_AZURE_REGIONS = [
  "westeurope",
  "northeurope",
  "germanywestcentral",
  "uksouth",
  "francecentral",
  "switzerlandnorth",
  "eastus",
  "eastus2",
  "westus2",
  "centralus",
  "southeastasia",
] as const;

export function extractPrimaryAzureRegion(text: string): string {
  const lower = text.toLowerCase();
  for (const r of KNOWN_AZURE_REGIONS) {
    if (lower.includes(r)) return r;
  }
  if (lower.includes("west europe")) return "westeurope";
  if (lower.includes("north europe")) return "northeurope";
  if (lower.includes("germany west central")) return "germanywestcentral";
  if (lower.includes("east us")) return "eastus";
  return "Global";
}

/**
 * Parse ticket text for explicit time expressions ("at 14:20 UTC", "since 08:00",
 * "this morning", "2 hours ago", "on 2026-10-27") or anchor to [ticketTime - 4h, ticketTime + 15m].
 */
export function extractIncidentTimestampWindow(
  text: string,
  referenceIso: string = new Date().toISOString(),
): IncidentTimestampWindow {
  const refDate = Number.isFinite(Date.parse(referenceIso)) ? new Date(referenceIso) : new Date("2026-10-27T14:30:00Z");
  const datePrefix = refDate.toISOString().slice(0, 10);

  // 1. Explicit ISO date + optional time: "on 2026-10-27" or "2026-10-27T14:20"
  const isoMatch = /\b(202\d-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2})(?::\d{2})?Z?)?\b/i.exec(text);
  if (isoMatch) {
    const day = isoMatch[1]!;
    const hm = isoMatch[2] ?? "08:00";
    const anchor = new Date(`${day}T${hm}:00Z`);
    if (Number.isFinite(anchor.getTime())) {
      const start = new Date(anchor.getTime() - 60 * 60 * 1000);
      const end = new Date(anchor.getTime() + 30 * 60 * 1000);
      return {
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        correlatedAtLabel: `${day} ${start.toISOString().slice(11, 16)}–${end.toISOString().slice(11, 16)} UTC`,
        extractedTimeExpression: isoMatch[0],
      };
    }
  }

  // 2. Explicit clock time: "at 14:20 UTC", "since 08:00", "around 09:15"
  const clockMatch = /\b(?:at|since|around|from|after)\s+(\d{1,2}):(\d{2})(?:\s*(?:utc|gmt|cet|z))?\b/i.exec(text);
  if (clockMatch) {
    const hh = clockMatch[1]!.padStart(2, "0");
    const mm = clockMatch[2]!;
    const anchor = new Date(`${datePrefix}T${hh}:${mm}:00Z`);
    if (Number.isFinite(anchor.getTime())) {
      const start = new Date(anchor.getTime() - 30 * 60 * 1000);
      const end = new Date(anchor.getTime() + 45 * 60 * 1000);
      return {
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        correlatedAtLabel: `${datePrefix} ${start.toISOString().slice(11, 16)}–${end.toISOString().slice(11, 16)} UTC (${clockMatch[0]})`,
        extractedTimeExpression: clockMatch[0],
      };
    }
  }

  // 3. Relative hours/minutes ago: "2 hours ago", "45 minutes ago"
  const relMatch = /\b(\d{1,2})\s+(hour|hours|hr|hrs|minute|minutes|min|mins)\s+ago\b/i.exec(text);
  if (relMatch) {
    const amount = Number(relMatch[1]);
    const unit = relMatch[2]!.toLowerCase();
    const deltaMs = unit.startsWith("h") ? amount * 3600_000 : amount * 60_000;
    const anchor = new Date(refDate.getTime() - deltaMs);
    const start = new Date(anchor.getTime() - 30 * 60_000);
    const end = new Date(refDate.getTime() + 15 * 60_000);
    return {
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      correlatedAtLabel: `${start.toISOString().slice(0, 10)} ${start.toISOString().slice(11, 16)}–${end.toISOString().slice(11, 16)} UTC (${relMatch[0]})`,
      extractedTimeExpression: relMatch[0],
    };
  }

  // 4. "this morning" / "today"
  const morningMatch = /\b(this morning|earlier today|overnight)\b/i.exec(text);
  if (morningMatch) {
    const start = new Date(`${datePrefix}T06:00:00Z`);
    const end = new Date(`${datePrefix}T11:30:00Z`);
    return {
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      correlatedAtLabel: `${datePrefix} 06:00–11:30 UTC (${morningMatch[0]})`,
      extractedTimeExpression: morningMatch[0],
    };
  }

  // Default anchor: [ticketTime - 4h, ticketTime + 15m]
  const start = new Date(refDate.getTime() - 4 * 3600_000);
  const end = new Date(refDate.getTime() + 15 * 60_000);
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    correlatedAtLabel: `${start.toISOString().slice(0, 10)} ${start.toISOString().slice(11, 16)}–${end.toISOString().slice(11, 16)} UTC [T-4h..T+15m]`,
    extractedTimeExpression: null,
  };
}

async function fetchWithShortTimeout(url: string, timeoutMs: number = 900): Promise<Response | null> {
  if (process.env.CTX_OFFLINE_STATUS === "true" || process.env.NODE_ENV === "test") {
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "ContextPane-StatusCorrelator/2.0",
        Accept: "application/json, application/xml, text/html, */*",
      },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeGitHubStatus(window: IncidentTimestampWindow): Promise<{
  service: UpstreamServiceHealth;
  advisories: UpstreamAdvisory[];
}> {
  const t0 = performance.now();
  const res = await fetchWithShortTimeout("https://www.githubstatus.com/api/v2/summary.json", 850);
  const latencyMs = Math.round(performance.now() - t0);
  if (res) {
    try {
      const json = (await res.json()) as {
        status?: { indicator?: string; description?: string };
        components?: Array<{ name?: string; status?: string }>;
        incidents?: Array<{ id?: string; name?: string; impact?: string; created_at?: string; shortlink?: string }>;
      };
      const actionsComp = json.components?.find((c) => c.name === "Actions");
      const isDegraded =
        (actionsComp?.status && actionsComp.status !== "operational") ||
        (json.status?.indicator && json.status.indicator !== "none");
      const advisories: UpstreamAdvisory[] = (json.incidents ?? []).slice(0, 2).map((inc) => ({
        id: `GH-${(inc.id ?? "INC").slice(0, 8).toUpperCase()}`,
        provider: "GitHub",
        title: inc.name ?? "GitHub Actions status advisory",
        severity: inc.impact === "critical" ? "critical" : inc.impact === "major" ? "warning" : "advisory",
        region: "Global",
        timestamp: inc.created_at ?? window.windowStart,
        summary: `GitHub Status API reported '${inc.name ?? "incident"}' during incident window.`,
        url: inc.shortlink ?? "https://www.githubstatus.com",
      }));
      return {
        service: {
          serviceId: "github-actions",
          label: "GitHub Actions / OIDC",
          status: isDegraded ? "advisory" : "operational",
          statusLabel: isDegraded ? "Degraded / Advisory" : "Operational",
          summary:
            json.status?.description ??
            `Actions (${actionsComp?.status ?? "operational"}), API Requests & OIDC token exchange healthy`,
          sourceUrl: "https://www.githubstatus.com/api/v2/summary.json",
          probeSource: "live-status-api",
          latencyMs,
        },
        advisories,
      };
    } catch {
      /* unreadable answer: unknown below */
    }
  }
  return { service: notProbed("github-actions", "GitHub Actions / OIDC", "https://www.githubstatus.com/api/v2/summary.json", "GitHub status API unreachable: upstream status unknown."), advisories: [] };
}

/** A service nobody probed: its status is unknown, never a seeded "operational". */
function notProbed(serviceId: UpstreamServiceHealth["serviceId"], label: string, sourceUrl: string, why: string): UpstreamServiceHealth {
  return { serviceId, label, status: "unknown", statusLabel: "Not probed", summary: why, sourceUrl, probeSource: "seeded-status-feed", latencyMs: 0 };
}

const UNPROBED_M365 = "No public machine-readable feed is probed for this service; check Microsoft 365 Service Health in the admin center.";
const M365_HEALTH_URL = "https://admin.microsoft.com/Adminportal/Home#/servicehealth";

/** Graph serviceHealthStatus -> our status; anything not operational and not a known incident state is an advisory. */
function m365Status(raw: string): UpstreamServiceHealth["status"] {
  if (raw === "serviceOperational") return "operational";
  if (raw === "serviceInterruption") return "outage";
  if (raw === "serviceDegradation" || raw === "restoringService" || raw === "extendedRecovery") return "degraded";
  return "advisory";
}

/**
 * Entra ID and Intune have no public feed; the honest source is Graph serviceAnnouncement/healthOverviews on the
 * delegated identity (ServiceHealth.Read.All). Live mode only; a missing scope or an unreachable Graph keeps both
 * "not probed" and says why (HARD_CASES 31).
 */
async function probeM365ServiceHealth(): Promise<UpstreamServiceHealth[]> {
  const unprobed = (why: string) => [notProbed("entra-id", "Entra ID", "https://status.cloud.microsoft", why), notProbed("intune", "Intune", "https://status.cloud.microsoft", why)];
  if (!isLiveCloudMode()) return unprobed(UNPROBED_M365);
  const started = performance.now();
  try {
    const overviews = await msgraph.fetchServiceHealthOverviewsLive(8_000);
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    const pick = (serviceId: "entra-id" | "intune", label: string, match: RegExp): UpstreamServiceHealth => {
      const row = overviews.find((o) => match.test(o.service));
      if (!row) return notProbed(serviceId, label, M365_HEALTH_URL, `healthOverviews returned ${overviews.length} services, none named ${label}.`);
      const status = m365Status(row.status);
      return { serviceId, label, status, statusLabel: row.status, summary: `Microsoft 365 Service Health reports ${row.service}: ${row.status}.`, sourceUrl: M365_HEALTH_URL, probeSource: "live-status-api", latencyMs };
    };
    return [pick("entra-id", "Entra ID", /entra|azure active directory|identity/i), pick("intune", "Intune", /intune/i)];
  } catch (error) {
    const forbidden = error instanceof msgraph.GraphHttpError && error.status === 403;
    return unprobed(forbidden ? "ServiceHealth.Read.All is not granted on the delegated identity; grant it (or re-run scripts/Connect-ContextPaneGraph.ps1 with that scope) to probe Microsoft 365 Service Health." : `Microsoft 365 Service Health unreachable (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The <item>s of the Azure status RSS feed; an empty list is "no active incident". */
export function parseAzureStatusFeed(xml: string): Array<{ title: string; description: string; link: string; pubDate: string | null }> {
  const items: Array<{ title: string; description: string; link: string; pubDate: string | null }> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = m[1] ?? "";
    const tag = (name: string) => decodeXml(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(body)?.[1] ?? "");
    const title = tag("title");
    if (title) items.push({ title, description: tag("description"), link: tag("link"), pubDate: tag("pubDate") || null });
  }
  return items;
}

const REGION_WORDS: Record<string, RegExp> = {
  westeurope: /west europe|westeurope/i,
  northeurope: /north europe|northeurope/i,
  germanywestcentral: /germany west central|germanywestcentral/i,
  uksouth: /uk south|uksouth/i,
  francecentral: /france central|francecentral/i,
  switzerlandnorth: /switzerland north|switzerlandnorth/i,
  eastus: /east us(?! 2)|eastus(?!2)/i,
  eastus2: /east us 2|eastus2/i,
  westus2: /west us 2|westus2/i,
  centralus: /central us|centralus/i,
  southeastasia: /southeast asia|southeastasia/i,
};

async function probeAzureStatus(
  region: string,
  window: IncidentTimestampWindow,
): Promise<{
  service: UpstreamServiceHealth;
  advisories: UpstreamAdvisory[];
}> {
  const sourceUrl = "https://azure.status.microsoft/en-us/status/feed/";
  const label = region === "Global" ? "Azure ARM / Global" : `Azure (${region})`;
  const t0 = performance.now();
  const res = await fetchWithShortTimeout(sourceUrl, 850);
  let items: ReturnType<typeof parseAzureStatusFeed> | null = null;
  if (res) {
    try {
      items = parseAzureStatusFeed(await res.text());
    } catch {
      items = null;
    }
  }
  const latencyMs = Math.round(performance.now() - t0);
  if (!items) return { service: notProbed("azure-regional", label, sourceUrl, "Azure status feed unreachable: upstream status unknown."), advisories: [] };

  // Only what the feed says: an item that names the ticket's region (or any item for a region-less ticket).
  const regionRe = REGION_WORDS[region];
  const relevant = items.filter((i) => (regionRe ? regionRe.test(`${i.title} ${i.description}`) : true));
  const advisories: UpstreamAdvisory[] = relevant.slice(0, 3).map((i, n) => ({
    id: `AZ-FEED-${n + 1}`,
    provider: "Azure",
    title: i.title.slice(0, 160),
    severity: "advisory",
    region,
    timestamp: i.pubDate && Number.isFinite(Date.parse(i.pubDate)) ? new Date(i.pubDate).toISOString() : window.windowStart,
    summary: (i.description || i.title).slice(0, 400),
    url: i.link || "https://azure.status.microsoft/en-us/status",
  }));
  return {
    service: {
      serviceId: "azure-regional",
      label,
      status: advisories.length ? "degraded" : "operational",
      statusLabel: advisories.length ? "Active status-feed incident" : "No active incident in the status feed",
      summary: advisories.length ? advisories.map((a) => a.title).join(" · ").slice(0, 300) : `The Azure status feed lists no active incident${regionRe ? ` for ${region}` : ""}.`,
      sourceUrl,
      probeSource: "live-status-api",
      latencyMs,
    },
    advisories,
  };
}

/** Is the ticket about VM / deployment capacity? Whole words only ("jvm" and "vmware" are not VMs). */
const VM_OR_DEPLOY_RE = /\bvms?\b|virtual machines?|\bdeploy(?:ment|ing|ed)?\b|\bquota(?:exceeded)?\b|allocationfailed|\ballocation\b/i;

async function probeMicrosoftLearnAndWebSearch(ticketText: string, region: string): Promise<WebSearchOutageCitation[]> {
  const query = VM_OR_DEPLOY_RE.test(ticketText)
    ? `azure vm deployment failed ${region === "Global" ? "" : region} RequestDisallowedByPolicy QuotaExceeded AllocationFailed`
    : `${ticketText.slice(0, 80)} azure microsoft status`;
  const citations: WebSearchOutageCitation[] = [];
  const res = await fetchWithShortTimeout(`https://learn.microsoft.com/api/search?search=${encodeURIComponent(query)}&locale=en-us&$top=2`, 850);
  if (res) {
    try {
      const data = (await res.json()) as { results?: Array<{ title?: string; description?: string; url?: string }> };
      for (const item of (data.results ?? []).slice(0, 2)) {
        if (item.title && item.url) {
          citations.push({
            title: item.title,
            snippet: (item.description ?? "Microsoft Learn troubleshooting documentation.").slice(0, 240),
            url: item.url,
            source: "Microsoft Learn Search API (Live)",
          });
        }
      }
    } catch {
      /* no citations */
    }
  }
  return citations.length ? citations : referenceDocs(ticketText);
}

/** Static documentation links for the ticket's error class: references, not tenant or status facts. */
function referenceDocs(ticketText: string): WebSearchOutageCitation[] {
  if (!VM_OR_DEPLOY_RE.test(ticketText)) return [];
  return [
    {
      title: "Resolve errors for resource quotas — Azure Resource Manager",
      snippet: "How to read QuotaExceeded / OperationNotAllowed and check family vCPU usage with Get-AzVMUsage -Location <region>.",
      url: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-resource-quota",
      source: "Microsoft Learn (reference link, not searched)",
    },
    {
      title: "Troubleshoot RequestDisallowedByPolicy — Azure Policy",
      snippet: "How to find the policy assignment that denied a deployment.",
      url: "https://learn.microsoft.com/en-us/azure/governance/policy/troubleshoot/general#requestdisallowedbypolicy",
      source: "Microsoft Learn (reference link, not searched)",
    },
  ];
}

function summarize(window: IncidentTimestampWindow, region: string, services: UpstreamServiceHealth[], advisories: UpstreamAdvisory[]): string {
  if (advisories.length) return `Correlated at ${window.correlatedAtLabel}: ${advisories.length} status-feed item(s) for ${region}: ${advisories.map((a) => a.title).join("; ")}`.slice(0, 500);
  const ok = services.filter((s) => s.status === "operational").map((s) => s.label);
  const unknown = services.filter((s) => s.status === "unknown").map((s) => s.label);
  if (!ok.length) return `Correlated at ${window.correlatedAtLabel}: upstream status not probed (${unknown.join(", ")}); no outage can be ruled out from here.`;
  return `Correlated at ${window.correlatedAtLabel}: no active incident for ${ok.join(", ")}${unknown.length ? `; not probed: ${unknown.join(", ")}` : ""}.`;
}

/**
 * Synchronous variant for the brief's first paint: no network, so nothing is claimed. Every service is
 * "not probed" until the async correlation (POST /api/cloud-status/correlate, the triage pipeline) runs.
 */
export function correlateUpstreamCloudStatusSync(input: { ticketText: string; createdAt?: string }): UpstreamCloudStatusCorrelation {
  const window = extractIncidentTimestampWindow(input.ticketText, input.createdAt);
  const primaryRegion = extractPrimaryAzureRegion(input.ticketText);
  const services: UpstreamServiceHealth[] = [
    notProbed("azure-regional", primaryRegion === "Global" ? "Azure ARM / Global" : `Azure (${primaryRegion})`, "https://azure.status.microsoft/en-us/status/feed/", "Not probed yet."),
    notProbed("entra-id", "Entra ID", "https://status.cloud.microsoft", UNPROBED_M365),
    notProbed("intune", "Intune", "https://status.cloud.microsoft", UNPROBED_M365),
    notProbed("github-actions", "GitHub Actions / OIDC", "https://www.githubstatus.com/api/v2/summary.json", "Not probed yet."),
  ];
  return {
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    correlatedAtLabel: window.correlatedAtLabel,
    extractedTimeExpression: window.extractedTimeExpression,
    primaryRegion,
    services,
    advisories: [],
    webSearchCitations: referenceDocs(input.ticketText),
    overallCorrelationSummary: summarize(window, primaryRegion, services, []),
  };
}

export async function correlateUpstreamCloudStatus(input: { ticketText: string; createdAt?: string }): Promise<UpstreamCloudStatusCorrelation> {
  const window = extractIncidentTimestampWindow(input.ticketText, input.createdAt);
  const primaryRegion = extractPrimaryAzureRegion(input.ticketText);
  const [github, azure, m365, webSearchCitations] = await Promise.all([
    probeGitHubStatus(window),
    probeAzureStatus(primaryRegion, window),
    probeM365ServiceHealth(),
    probeMicrosoftLearnAndWebSearch(input.ticketText, primaryRegion),
  ]);
  const services: UpstreamServiceHealth[] = [azure.service, ...m365, github.service];
  const advisories: UpstreamAdvisory[] = [...azure.advisories, ...github.advisories];
  return {
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    correlatedAtLabel: window.correlatedAtLabel,
    extractedTimeExpression: window.extractedTimeExpression,
    primaryRegion,
    services,
    advisories,
    webSearchCitations,
    overallCorrelationSummary: summarize(window, primaryRegion, services, advisories),
  };
}
