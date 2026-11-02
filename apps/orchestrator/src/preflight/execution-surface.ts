/**
 * Execution-surface rules for model-written PowerShell (review item 12).
 *
 * A cmdlet allow-list only sees CommandAst names, so it misses everything that runs code
 * without naming a cmdlet: .NET static calls (`[Diagnostics.Process]::Start`), `New-Object
 * Net.WebClient`, runtime script blocks (`[scriptblock]::Create`, `& $sb`, `$sb.Invoke()`),
 * dot-sourcing, aliases (`irm`, `iwr`, `saps`) and free-form REST calls through
 * `Invoke-MgGraphRequest` / `Invoke-AzRestMethod`. Every finding here is a hard failure.
 *
 * The PowerShell AST runners (preflight/local.ts and modal-sandbox/contextpane_sandbox.py)
 * report an {@link ExecutionSurface}; the denied commands live in packages/catalog/src/preflight-rules.json
 * with the rest of the shared rule set. When no AST report is available (pwsh missing, an older
 * sandbox deployment) {@link scanExecutionSurfaceText} extracts a best-effort one from the text.
 */

import { PREFLIGHT_RULES } from "@contextpane/catalog";

export interface ExecutionSurface {
  staticCalls: Array<{ type: string; member: string }>;
  newObjects: Array<{ typeName: string | null; comObject: boolean }>;
  /** `& $var`, `& (expr)`: the command is computed at run time. */
  dynamicInvocations: string[];
  /** `. ./other.ps1`, `. $path`. */
  dotSources: string[];
  /** `$sb.Invoke()`, `.InvokeReturnAsIs()`, `.AddScript()` on a non-type expression. */
  scriptBlockInvokes: string[];
  aliases: Array<{ name: string; definition: string }>;
  restCalls: Array<{ command: string; method: string | null; uri: string | null; uriDynamic: boolean }>;
}

export const FINDING_PREFIX = "Execution surface:";

/**
 * PowerShell fragment both AST runners embed after `$ast` is parsed; it leaves `$surface`.
 * Keep in sync with the copy in modal-sandbox/contextpane_sandbox.py (SURFACE_PS).
 */
export const SURFACE_PS = String.raw`
  $surface = [ordered]@{ staticCalls = @(); newObjects = @(); dynamicInvocations = @(); dotSources = @(); scriptBlockInvokes = @(); aliases = @(); restCalls = @() }
  foreach ($m in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
    $member = if ($m.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $m.Member.Value } else { '<dynamic>' }
    if ($m.Static -and $m.Expression -is [System.Management.Automation.Language.TypeExpressionAst]) {
      $surface.staticCalls += [pscustomobject]@{ type = $m.Expression.TypeName.FullName; member = $member }
    } elseif ($member -in @('Invoke', 'InvokeReturnAsIs', 'InvokeWithContext', 'AddScript', '<dynamic>')) {
      $surface.scriptBlockInvokes += $m.Extent.Text
    }
  }
  foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
    $name = $c.GetCommandName()
    if ($c.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot) { $surface.dotSources += $c.Extent.Text }
    elseif ($c.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Ampersand -and -not $name -and -not ($c.CommandElements[0] -is [System.Management.Automation.Language.ScriptBlockExpressionAst])) { $surface.dynamicInvocations += $c.Extent.Text }
    if (-not $name) { continue }
    $alias = Get-Alias -Name ([WildcardPattern]::Escape($name)) -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($alias) { $surface.aliases += [pscustomobject]@{ name = $name; definition = [string]$alias.Definition } }
    $lower = $name.ToLowerInvariant()
    if ($lower -eq 'new-object') {
      $typeName = $null; $com = $false
      for ($i = 1; $i -lt $c.CommandElements.Count; $i++) {
        $e = $c.CommandElements[$i]
        if ($e -is [System.Management.Automation.Language.CommandParameterAst]) {
          if ($e.ParameterName -like 'Com*') { $com = $true }
          elseif ($e.ParameterName -like 'Type*' -and $i + 1 -lt $c.CommandElements.Count) { $typeName = $c.CommandElements[$i + 1].Extent.Text.Trim([char[]]@([char]39, [char]34)) }
        } elseif (-not $typeName -and $i -eq 1) { $typeName = $e.Extent.Text.Trim([char[]]@([char]39, [char]34)) }
      }
      $surface.newObjects += [pscustomobject]@{ typeName = $typeName; comObject = $com }
    }
    if ($lower -in @('invoke-mggraphrequest', 'invoke-azrestmethod')) {
      $method = $null; $uri = $null; $dynamic = $false
      for ($i = 1; $i -lt $c.CommandElements.Count; $i++) {
        $e = $c.CommandElements[$i]
        if (-not ($e -is [System.Management.Automation.Language.CommandParameterAst])) { continue }
        $arg = if ($e.Argument) { $e.Argument } elseif ($i + 1 -lt $c.CommandElements.Count) { $c.CommandElements[$i + 1] } else { $null }
        if (-not $arg) { continue }
        if ($e.ParameterName -eq 'Method') {
          $method = if ($arg -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $arg.Value } else { '<dynamic>' }
        } elseif ($e.ParameterName -in @('Uri', 'Path')) {
          if ($arg -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $uri = $arg.Value }
          elseif ($arg -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) { $uri = $arg.Value; $dynamic = $true }
          else { $uri = $arg.Extent.Text; $dynamic = $true }
        }
      }
      $surface.restCalls += [pscustomobject]@{ command = $lower; method = $method; uri = $uri; uriDynamic = $dynamic }
    }
  }
`;

/** Commands that run code, open sessions or rebind the Az context; the verb allow-list (Invoke, Start, Set, Add, New) lets them through. */
export const DENIED_EXECUTION_COMMANDS = new Set(PREFLIGHT_RULES.deniedExecutionCommands);

/**
 * Aliases a model script might use; scripts must spell cmdlets out (an alias hides what runs, and
 * pwsh on Linux lacks some of them, so `curl` there is the curl binary). Text detection uses these too.
 */
export const KNOWN_ALIASES: Record<string, string> = {
  iex: "Invoke-Expression",
  irm: "Invoke-RestMethod",
  iwr: "Invoke-WebRequest",
  curl: "Invoke-WebRequest / curl binary",
  wget: "Invoke-WebRequest / wget binary",
  saps: "Start-Process",
  start: "Start-Process",
  icm: "Invoke-Command",
  sajb: "Start-Job",
  ii: "Invoke-Item",
  iwmi: "Invoke-WmiMethod",
  rm: "Remove-Item",
  ri: "Remove-Item",
  del: "Remove-Item",
  erase: "Remove-Item",
  rd: "Remove-Item",
  rmdir: "Remove-Item",
  sal: "Set-Alias",
  nal: "New-Alias",
  ipmo: "Import-Module",
  "%": "ForEach-Object",
  "?": "Where-Object",
};
/** Pipeline shorthands that run no code of their own; reported only when pwsh resolves something else. */
const HARMLESS_ALIASES = new Set(["%", "?", "foreach", "where", "select", "sort", "measure", "group", "ft", "fl", "echo", "write"]);

/** .NET types a remediation script may call static members on (case-insensitive, `System.` optional). */
const SAFE_STATIC_TYPES = new Set([
  "datetime",
  "datetimeoffset",
  "timespan",
  "math",
  "guid",
  "string",
  "char",
  "int",
  "int32",
  "int64",
  "long",
  "double",
  "bool",
  "boolean",
  "version",
  "uri",
  "regex",
  "text.regularexpressions.regex",
  "array",
  "linq.enumerable",
]);

function normalizeType(type: string): string {
  return type.trim().replace(/^\[|\]$/g, "").replace(/^system\./i, "").toLowerCase();
}

function isConstructibleType(type: string): boolean {
  const t = normalizeType(type);
  return SAFE_STATIC_TYPES.has(t) || /^collections\./.test(t) || /^microsoft\.(graph|azure)\./.test(t) || t === "psobject" || t === "pscustomobject" || t === "management.automation.pscustomobject";
}

/* ------------------------------ REST allow-list ------------------------------ */

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
interface RestRule {
  prefix: string;
  methods: Method[];
  /** DELETE is allowed only for paths matching this (a membership or grant, never the object itself). */
  deleteWhen?: RegExp;
}

/** Microsoft Graph paths after /v1.0 or /beta. Anything else (roleManagement, directoryRoles, $batch, …) is denied. */
export const GRAPH_REST_RULES: RestRule[] = [
  { prefix: "/users", methods: ["GET", "POST", "PATCH"] },
  { prefix: "/groups", methods: ["GET", "POST", "PATCH", "DELETE"], deleteWhen: /\/(members|owners)\/[^/]+\/\$ref$/i },
  { prefix: "/identity/conditionalaccess/policies", methods: ["GET", "POST", "PATCH"] },
  { prefix: "/devicemanagement", methods: ["GET", "POST", "PATCH", "PUT"] },
  { prefix: "/serviceprincipals", methods: ["GET", "POST", "PATCH", "DELETE"], deleteWhen: /\/(approleassignments|approleassignedto)\/[^/]+$/i },
  { prefix: "/applications", methods: ["GET", "POST", "PATCH", "DELETE"], deleteWhen: /\/federatedidentitycredentials\/[^/]+$/i },
  { prefix: "/oauth2permissiongrants", methods: ["GET", "DELETE"], deleteWhen: /^\/oauth2permissiongrants\/[^/]+$/i },
  { prefix: "/sites", methods: ["GET", "POST"] },
  { prefix: "/subscribedskus", methods: ["GET"] },
  { prefix: "/auditlogs", methods: ["GET"] },
  { prefix: "/reports", methods: ["GET"] },
  { prefix: "/organization", methods: ["GET"] },
  { prefix: "/domains", methods: ["GET"] },
];

function matchRule(rules: RestRule[], path: string): RestRule | null {
  const lower = path.toLowerCase();
  return rules.find((r) => lower === r.prefix || lower.startsWith(`${r.prefix}/`) || lower.startsWith(`${r.prefix}?`)) ?? null;
}

/** `"/v1.0/groups/$gid/members/$($u.Id)/`$ref"` → `/v1.0/groups/x/members/x/$ref`: variables become a placeholder segment. */
function shapeUri(uri: string): string {
  return uri.replace(/`\$/g, "$").replace(/\$\([^)]*\)/g, "x").replace(/\$(?!ref\b)\{?[\w:.]+\}?/gi, "x");
}

function splitHost(uri: string, expected: string, label: string): { path: string } | { finding: string } {
  const abs = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(uri.trim());
  if (!abs) return { path: uri.trim().startsWith("/") ? uri.trim() : `/${uri.trim()}` };
  const host = abs[1]!.toLowerCase();
  if (host !== expected) return { finding: `${FINDING_PREFIX} ${label} to ${host}: only ${expected} is allowed` };
  return { path: abs[2] ?? "/" };
}

function restCallFinding(call: ExecutionSurface["restCalls"][number]): string | null {
  const graph = call.command.toLowerCase() === "invoke-mggraphrequest";
  const label = graph ? "Invoke-MgGraphRequest" : "Invoke-AzRestMethod";
  const method = (call.method ?? "GET").toUpperCase();
  if (method === "<DYNAMIC>") return `${FINDING_PREFIX} ${label} with a computed -Method; use a literal method`;
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) return `${FINDING_PREFIX} ${label} -Method ${method} is not allowed`;
  if (!call.uri) return `${FINDING_PREFIX} ${label} without a literal -Uri/-Path`;
  // A computed URI must still name its collection literally ("/v1.0/users/$id" yes, "$uri" no).
  const literal = call.uriDynamic ? call.uri.split("$")[0]! : call.uri;
  if (call.uriDynamic && !literal.trim()) return `${FINDING_PREFIX} ${label} -Uri is computed at run time (${call.uri.slice(0, 80)}); the target cannot be checked`;
  const expected = graph ? "graph.microsoft.com" : "management.azure.com";
  const literalSplit = splitHost(literal, expected, label);
  if ("finding" in literalSplit) return literalSplit.finding;
  const shapedSplit = splitHost(call.uriDynamic ? shapeUri(call.uri) : call.uri, expected, label);
  if ("finding" in shapedSplit) return shapedSplit.finding;
  if (graph) {
    const strip = (p: string) => p.replace(/^\/(v1\.0|beta)(?=\/|$)/i, "");
    const path = strip(shapedSplit.path).split("?")[0]!;
    const rule = matchRule(GRAPH_REST_RULES, path);
    if (!rule) return `${FINDING_PREFIX} Invoke-MgGraphRequest ${method} ${path || "/"} is outside the Graph allow-list`;
    if (call.uriDynamic && strip(literalSplit.path).length < rule.prefix.length) {
      return `${FINDING_PREFIX} Invoke-MgGraphRequest ${method} ${call.uri.slice(0, 80)}: the collection is computed at run time`;
    }
    if (!rule.methods.includes(method as Method)) return `${FINDING_PREFIX} Invoke-MgGraphRequest ${method} on ${rule.prefix} is not allowed`;
    if (method === "DELETE" && !rule.deleteWhen?.test(path)) {
      return `${FINDING_PREFIX} Invoke-MgGraphRequest DELETE ${path}: only membership or grant references may be deleted`;
    }
    return null;
  }
  // ARM: subscription scope only; no writes to role or policy assignments through raw REST.
  const path = shapedSplit.path;
  if (!/^\/subscriptions\//i.test(path) || !/^\/subscriptions\//i.test(literalSplit.path + (call.uriDynamic ? "/" : ""))) {
    return `${FINDING_PREFIX} Invoke-AzRestMethod ${method} ${path}: only /subscriptions/… paths are allowed`;
  }
  if (method !== "GET" && /\/providers\/microsoft\.authorization\//i.test(path)) {
    return `${FINDING_PREFIX} Invoke-AzRestMethod ${method} on Microsoft.Authorization (role or policy) is not allowed; use the typed cmdlet`;
  }
  if (method !== "GET" && call.uriDynamic && !/\/providers\//i.test(literal)) {
    return `${FINDING_PREFIX} Invoke-AzRestMethod ${method} ${call.uri.slice(0, 80)}: the resource provider is computed at run time`;
  }
  return null;
}

/* --------------------------------- the rules --------------------------------- */

/** Every hard-fail finding for a script's execution surface; `commands` are the AST's command names. */
export function executionSurfaceFindings(surface: ExecutionSurface, commands: string[] = []): string[] {
  const findings = new Set<string>();
  for (const cmd of commands) {
    const lower = cmd.toLowerCase();
    if (DENIED_EXECUTION_COMMANDS.has(lower)) findings.add(`${FINDING_PREFIX} ${cmd} runs code or changes the session; not allowed in a remediation script`);
    if (KNOWN_ALIASES[lower] && !HARMLESS_ALIASES.has(lower)) findings.add(`${FINDING_PREFIX} alias '${cmd}' (${KNOWN_ALIASES[lower]}); spell the cmdlet out`);
  }
  for (const a of surface.aliases) {
    const lower = a.name.toLowerCase();
    if (HARMLESS_ALIASES.has(lower)) continue;
    findings.add(`${FINDING_PREFIX} alias '${a.name}' (${KNOWN_ALIASES[lower] ?? a.definition}); spell the cmdlet out`);
  }
  for (const call of surface.staticCalls) {
    const t = normalizeType(call.type);
    const member = call.member.toLowerCase();
    if (SAFE_STATIC_TYPES.has(t)) continue;
    if (member === "new" && isConstructibleType(call.type)) continue;
    findings.add(`${FINDING_PREFIX} .NET call [${call.type}]::${call.member} is not allowed`);
  }
  for (const obj of surface.newObjects) {
    if (obj.comObject) findings.add(`${FINDING_PREFIX} New-Object -ComObject is not allowed`);
    else if (!obj.typeName || !isConstructibleType(obj.typeName)) findings.add(`${FINDING_PREFIX} New-Object ${obj.typeName ?? "<computed type>"} is not allowed`);
  }
  for (const text of surface.dynamicInvocations) findings.add(`${FINDING_PREFIX} computed command invocation '${text.slice(0, 60)}'`);
  for (const text of surface.dotSources) findings.add(`${FINDING_PREFIX} dot-sourcing '${text.slice(0, 60)}'`);
  for (const text of surface.scriptBlockInvokes) findings.add(`${FINDING_PREFIX} script block invocation '${text.slice(0, 60)}'`);
  for (const call of surface.restCalls) {
    const f = restCallFinding(call);
    if (f) findings.add(f);
  }
  return [...findings];
}

/* ------------------------- text fallback (no AST report) ------------------------- */

function stripComments(script: string): string {
  return script.replace(/<#[\s\S]*?#>/g, "").replace(/(^|\s)#(?!Requires)[^\n]*/gi, "$1");
}

const ALIAS_AT_COMMAND = new RegExp(
  String.raw`(?:^|[;|{(]|\b(?:if|else|foreach)\b[^{\n]*\{)\s*(?:&\s*)?(` +
    Object.keys(KNOWN_ALIASES)
      .filter((a) => /^\w+$/.test(a) && !HARMLESS_ALIASES.has(a))
      .join("|") +
    String.raw`)(?=\s|$|\()`,
  "gim",
);

/**
 * Best-effort surface from the script text, for when no PowerShell AST report exists. It is
 * stricter than the AST in places (it cannot tell a string from code) and that is the safe side.
 */
export function scanExecutionSurfaceText(script: string): ExecutionSurface {
  const code = stripComments(script);
  const surface: ExecutionSurface = { staticCalls: [], newObjects: [], dynamicInvocations: [], dotSources: [], scriptBlockInvokes: [], aliases: [], restCalls: [] };
  for (const m of code.matchAll(/\[([A-Za-z_][\w.`]*(?:\[[^\]]*\])?)\]::(\w+)\s*\(/g)) surface.staticCalls.push({ type: m[1]!, member: m[2]! });
  for (const m of code.matchAll(/\bNew-Object\b([^\n;|]*)/gi)) {
    const args = m[1] ?? "";
    const com = /-Com\w*/i.test(args);
    const type = /(?:-TypeName\s+)?['"]?([A-Za-z_][\w.]*)/i.exec(args.replace(/-Com\w*\s+\S+/i, "").trim());
    surface.newObjects.push({ typeName: com ? null : (type?.[1] ?? null), comObject: com });
  }
  for (const m of code.matchAll(/(?:^|[;|{(=])\s*&\s*(\$[\w:{}]+|\([^)]*\)|\[[^\]]+\])/gm)) surface.dynamicInvocations.push(m[0].trim());
  for (const m of code.matchAll(/(?:^|[;{(|])\s*\.\s+(['"]?[$\w.\\/:~-]+['"]?)/gm)) surface.dotSources.push(m[0].trim());
  for (const m of code.matchAll(/\.(Invoke|InvokeReturnAsIs|InvokeWithContext|AddScript)\s*\(/g)) surface.scriptBlockInvokes.push(m[0]);
  for (const m of code.matchAll(ALIAS_AT_COMMAND)) surface.aliases.push({ name: m[1]!, definition: KNOWN_ALIASES[m[1]!.toLowerCase()] ?? "alias" });
  for (const m of code.matchAll(/\b(Invoke-MgGraphRequest|Invoke-AzRestMethod)\b([^\n]*)/gi)) {
    const args = m[2] ?? "";
    const method = /-Method\s*:?\s*['"]?([$\w]+)/i.exec(args)?.[1] ?? null;
    const quoted = /-(?:Uri|Path)\s*:?\s*(['"])(.*?)\1/i.exec(args);
    const bare = quoted ? null : /-(?:Uri|Path)\s*:?\s*(\S+)/i.exec(args);
    const uri = quoted ? quoted[2]! : (bare?.[1] ?? null);
    const uriDynamic = quoted ? quoted[1] === '"' && uri!.includes("$") : Boolean(bare);
    surface.restCalls.push({ command: m[1]!.toLowerCase(), method: method?.startsWith("$") ? "<dynamic>" : method, uri, uriDynamic });
  }
  return surface;
}

/**
 * String literals hold text, not commands: single-quoted strings and here-strings are dropped whole,
 * double-quoted ones keep only their `$( … )` subexpressions, which do run. Approximate (no nesting),
 * which is the most a text fallback can do; the AST report is exact.
 */
export function stripStringLiterals(code: string): string {
  // One pass, so whichever literal opens first wins ("can't" does not start a single-quoted string).
  return code.replace(/@'[\s\S]*?'@|@"[\s\S]*?"@|'(?:[^']|'')*'|"(?:[^"`]|`[\s\S])*"/g, (m) => (m.startsWith("'") || m.startsWith("@'") ? "''" : keepSubexpressions(m)));
}

function keepSubexpressions(literal: string): string {
  const subs = [...literal.matchAll(/\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => m[1]!);
  return subs.length ? `"";${subs.join(";")}` : '""';
}

/** Command names the text fallback can see (`Verb-Noun` at command position, outside string literals). */
export function scanCommandsText(script: string): string[] {
  const code = stripStringLiterals(stripComments(script));
  return [...new Set([...code.matchAll(/(?:^|[;|{(=]|\bif\s*\(|\s)([A-Z][a-z]+-[A-Za-z][\w]*)\b/gm)].map((m) => m[1]!))];
}

/** Parses the optional `surface` of an AST report; anything malformed falls back to the text scan. */
export function surfaceFromReport(value: unknown, script: string): ExecutionSurface {
  if (!value || typeof value !== "object") return scanExecutionSurfaceText(script);
  const v = value as Partial<Record<keyof ExecutionSurface, unknown>>;
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : x && typeof x === "object" ? [x as T] : []);
  return {
    staticCalls: arr(v.staticCalls),
    newObjects: arr(v.newObjects),
    dynamicInvocations: arr(v.dynamicInvocations),
    dotSources: arr(v.dotSources),
    scriptBlockInvokes: arr(v.scriptBlockInvokes),
    aliases: arr(v.aliases),
    restCalls: arr(v.restCalls),
  };
}
