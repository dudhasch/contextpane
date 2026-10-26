/**
 * A deliberately small HCL reader for the subset used by demo-iac/*.tf:
 *   locals { <name> = { K = "V" ... } }
 *   resource "azurerm_network_security_group" "<label>" { attr = value ... security_rule { ... } }
 *
 * It is not a general HCL parser. It is enough to lift the expected NSG state
 * out of the baseline and to render both expected and live state in one
 * canonical shape so the unified diff is line-stable.
 */

export interface NsgRule {
  name: string;
  priority: number;
  direction: "Inbound" | "Outbound";
  access: "Allow" | "Deny";
  protocol: string;
  sourcePortRange: string;
  destinationPortRange: string;
  sourceAddressPrefix: string;
  destinationAddressPrefix: string;
  description?: string;
}

export interface NsgState {
  name: string;
  resourceGroup: string;
  location: string;
  tags: Record<string, string>;
  rules: NsgRule[];
}

interface Block {
  header: string;
  body: string;
  start: number;
  end: number;
}

/** Find `{...}` blocks whose header matches, with correct brace nesting. */
function findBlocks(source: string, headerPattern: RegExp): Block[] {
  const blocks: Block[] = [];
  const re = new RegExp(headerPattern.source + "\\s*\\{", "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let i = open;
    let inString = false;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"' && source[i - 1] !== "\\") inString = !inString;
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push({ header: match[0], body: source.slice(open + 1, i), start: match.index, end: i + 1 });
    re.lastIndex = i + 1;
  }
  return blocks;
}

/** Parse `key = "value"` / `key = 123` / `key = local.x` lines at the top level of a body. */
function parseAttributes(body: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let depth = 0;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    if (depth === 0) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*=\s*(.+?)\s*$/);
      if (m && m[1] && m[2] !== undefined && !m[2].endsWith("{")) {
        attrs[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
      }
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return attrs;
}

/** Parse the `locals { name = { ... } }` maps. */
export function parseLocals(source: string): Record<string, Record<string, string>> {
  const locals: Record<string, Record<string, string>> = {};
  for (const block of findBlocks(source, /\blocals/)) {
    for (const map of findBlocks(block.body, /([A-Za-z_][\w-]*)\s*=/)) {
      const name = map.header.match(/([A-Za-z_][\w-]*)\s*=/)?.[1];
      if (name) locals[name] = parseAttributes(map.body);
    }
  }
  return locals;
}

function resolveValue(raw: string | undefined, locals: Record<string, Record<string, string>>, resourceGroups: Record<string, Record<string, string>>): string {
  if (raw === undefined) return "";
  const localRef = raw.match(/^local\.([\w-]+)$/);
  if (localRef?.[1]) return JSON.stringify(locals[localRef[1]] ?? {});
  const rgRef = raw.match(/^azurerm_resource_group\.([\w-]+)\.(name|location)$/);
  if (rgRef?.[1] && rgRef[2]) return resourceGroups[rgRef[1]]?.[rgRef[2]] ?? raw;
  return raw;
}

export interface ParsedNsg extends NsgState {
  terraformLabel: string;
}

/** Extract every azurerm_network_security_group from a Terraform source string. */
export function parseNsgResources(source: string): ParsedNsg[] {
  const locals = parseLocals(source);
  const resourceGroups: Record<string, Record<string, string>> = {};
  for (const rg of findBlocks(source, /resource\s+"azurerm_resource_group"\s+"([\w-]+)"/)) {
    const label = rg.header.match(/"azurerm_resource_group"\s+"([\w-]+)"/)?.[1];
    if (label) resourceGroups[label] = parseAttributes(rg.body);
  }

  const result: ParsedNsg[] = [];
  for (const block of findBlocks(source, /resource\s+"azurerm_network_security_group"\s+"([\w-]+)"/)) {
    const label = block.header.match(/"azurerm_network_security_group"\s+"([\w-]+)"/)?.[1] ?? "nsg";
    const attrs = parseAttributes(block.body);
    const tagsRaw = attrs.tags;
    let tags: Record<string, string> = {};
    if (tagsRaw?.startsWith("local.")) {
      tags = JSON.parse(resolveValue(tagsRaw, locals, resourceGroups)) as Record<string, string>;
    } else {
      const inline = findBlocks(block.body, /tags\s*=/)[0];
      if (inline) tags = parseAttributes(inline.body);
    }
    const rules: NsgRule[] = findBlocks(block.body, /security_rule/).map((rb) => {
      const a = parseAttributes(rb.body);
      return {
        name: a.name ?? "",
        priority: Number.parseInt(a.priority ?? "0", 10),
        direction: (a.direction === "Outbound" ? "Outbound" : "Inbound") as NsgRule["direction"],
        access: (a.access === "Deny" ? "Deny" : "Allow") as NsgRule["access"],
        protocol: a.protocol ?? "*",
        sourcePortRange: a.source_port_range ?? "*",
        destinationPortRange: a.destination_port_range ?? "*",
        sourceAddressPrefix: a.source_address_prefix ?? "*",
        destinationAddressPrefix: a.destination_address_prefix ?? "*",
        ...(a.description ? { description: a.description } : {}),
      };
    });
    result.push({
      terraformLabel: label,
      name: attrs.name ?? label,
      resourceGroup: resolveValue(attrs.resource_group_name, locals, resourceGroups),
      location: resolveValue(attrs.location, locals, resourceGroups),
      tags,
      rules: rules.sort((x, y) => x.priority - y.priority),
    });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Canonical rendering (shared by expected and live state)                     */
/* -------------------------------------------------------------------------- */

const pad = (key: string, width: number) => key.padEnd(width);

export function renderNsgHcl(state: NsgState, label = "nsg"): string {
  const lines: string[] = [];
  lines.push(`resource "azurerm_network_security_group" "${label}" {`);
  lines.push(`  name                = "${state.name}"`);
  lines.push(`  location            = "${state.location}"`);
  lines.push(`  resource_group_name = "${state.resourceGroup}"`);
  lines.push("");
  lines.push("  tags = {");
  const tagKeys = Object.keys(state.tags).sort();
  const tagWidth = Math.max(0, ...tagKeys.map((k) => k.length));
  for (const key of tagKeys) lines.push(`    ${pad(key, tagWidth)} = "${state.tags[key]}"`);
  lines.push("  }");
  const rules = [...state.rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const rule of rules) {
    lines.push("");
    lines.push("  security_rule {");
    lines.push(`    name                       = "${rule.name}"`);
    lines.push(`    priority                   = ${rule.priority}`);
    lines.push(`    direction                  = "${rule.direction}"`);
    lines.push(`    access                     = "${rule.access}"`);
    lines.push(`    protocol                   = "${rule.protocol}"`);
    lines.push(`    source_port_range          = "${rule.sourcePortRange}"`);
    lines.push(`    destination_port_range     = "${rule.destinationPortRange}"`);
    lines.push(`    source_address_prefix      = "${rule.sourceAddressPrefix}"`);
    lines.push(`    destination_address_prefix = "${rule.destinationAddressPrefix}"`);
    if (rule.description) lines.push(`    description                = "${rule.description}"`);
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

export function ruleSignature(rule: NsgRule): string {
  return [
    rule.priority,
    rule.direction,
    rule.access,
    rule.protocol,
    rule.sourcePortRange,
    rule.destinationPortRange,
    rule.sourceAddressPrefix,
    rule.destinationAddressPrefix,
  ].join("|");
}
