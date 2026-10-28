import type { FreeRoamCategory, FreeRoamEntityItem } from "./api";

const EMAIL_RE = /[A-Za-z0-9._%+'-]+(?:#EXT#)?@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const GUEST_RE = /#EXT#@/i;

const aliasByReal = new Map<string, string>();
let personSeq = 0;
let guestSeq = 0;

function alias(real: string, guest: boolean): string {
  const key = real.toLowerCase();
  const hit = aliasByReal.get(key);
  if (hit) return hit;
  const next = guest ? `External guest ${String(++guestSeq).padStart(2, "0")}` : `User ${String(++personSeq).padStart(2, "0")}`;
  aliasByReal.set(key, next);
  return next;
}

function maskEmails(text: string, all: boolean): string {
  return text.replace(EMAIL_RE, (email) => {
    const guest = GUEST_RE.test(email);
    if (!guest && !all) return email;
    const domain = email.split("@").pop() ?? "";
    return `${alias(email, guest).toLowerCase().replace(/\s+/g, ".")}@${domain}`;
  });
}

/**
 * What the Free-Roam explorer may show for an inventory row. `#EXT#` guests (real outside
 * people) are masked in every mode; outside Real-Tenant mode, rows that still came from a
 * live source are pseudonymised entirely (names and UPNs). The seeded lab manifest is
 * fictional and shown as is. The row's `queryPrompt` is untouched: prompts are vaulted
 * server-side before any model sees them.
 */
export function displayInventoryItem(item: FreeRoamEntityItem, category: FreeRoamCategory, dataMode: string): { label: string; sublabel: string } {
  const pseudonymiseAll = dataMode !== "real-tenant" && category.source.startsWith("live");
  const guest = GUEST_RE.test(item.sublabel) || GUEST_RE.test(item.label);
  const isPerson = category.id === "users";
  const realUpn = item.sublabel.match(EMAIL_RE)?.[0] ?? item.label;
  const label = isPerson && (guest || pseudonymiseAll) ? alias(realUpn, guest) : maskEmails(item.label, pseudonymiseAll);
  return { label, sublabel: maskEmails(item.sublabel, pseudonymiseAll) };
}
