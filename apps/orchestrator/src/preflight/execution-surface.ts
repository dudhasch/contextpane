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
  restCalls: Array<{ command: string; method: string | null; uri: string | null; uriDynamic: boolean; splatted?: boolean }>;
  /**
   * Engine access that runs arbitrary strings or script blocks without naming a cmdlet:
   * `$ExecutionContext.InvokeCommand.InvokeScript(…)`, `.NewScriptBlock(…)`, `.SessionState`, runspaces,
   * and `Add-Member -MemberType ScriptMethod/ScriptProperty/CodeMethod`. Optional: older sandbox reports lack it.
   */
  engineAccess?: string[];
}

export const FINDING_PREFIX = "Execution surface:";

/**
 * PowerShell fragment both AST runners embed after `$ast` is parsed; it leaves `$surface`.
 * Keep in sync with the copy in modal-sandbox/contextpane_sandbox.py (SURFACE_PS).
 */
export const SURFACE_PS = String.raw`
  $surface = [ordered]@{ staticCalls = @(); newObjects = @(); dynamicInvocations = @(); dotSources = @(); scriptBlockInvokes = @(); aliases = @(); restCalls = @(); engineAccess = @() }
  foreach ($m in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
    $member = if ($m.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $m.Member.Value } else { '<dynamic>' }
    if ($m.Static -and $m.Expression -is [System.Management.Automation.Language.TypeExpressionAst]) {
      $surface.staticCalls += [pscustomobject]@{ type = $m.Expression.TypeName.FullName; member = $member }
    } elseif ($member -in @('Invoke', 'InvokeReturnAsIs', 'InvokeWithContext', 'AddScript', 'InvokeScript', 'NewScriptBlock', 'InvokeCommand', '<dynamic>')) {
      $surface.scriptBlockInvokes += $m.Extent.Text
    }
  }
  foreach ($v in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)) {
    if ($v.VariablePath.UserPath -in @('ExecutionContext')) { $surface.engineAccess += $(if ($v.Parent) { $v.Parent.Extent.Text } else { $v.Extent.Text }) }
  }
  foreach ($x in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.MemberExpressionAst] }, $true)) {
    $mn = if ($x.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $x.Member.Value } else { '' }
    if ($mn -in @('InvokeCommand', 'SessionState', 'Runspace', 'InvokeProvider')) { $surface.engineAccess += $x.Extent.Text }
  }
  foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
    $name = $c.GetCommandName()
    if ($c.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot) { $surface.dotSources += $c.Extent.Text }
    elseif ($c.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Ampersand -and -not $name -and -not ($c.CommandElements[0] -is [System.Management.Automation.Language.ScriptBlockExpressionAst])) { $surface.dynamicInvocations += $c.Extent.Text }
    if (-not $name) { continue }
    $alias = Get-Alias -Name ([WildcardPattern]::Escape($name)) -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($alias) { $surface.aliases += [pscustomobject]@{ name = $name; definition = [string]$alias.Definition } }
    $lower = $name.ToLowerInvariant()
    if ($lower -eq 'add-member' -and ($c.CommandElements | Where-Object { $_.Extent.Text -match '(Script|Code)(Method|Property)' })) { $surface.engineAccess += $c.Extent.Text }
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
      $method = $null; $uri = $null; $dynamic = $false; $splatted = $false
      for ($i = 1; $i -lt $c.CommandElements.Count; $i++) {
        $e = $c.CommandElements[$i]
        if ($e -is [System.Management.Automation.Language.VariableExpressionAst] -and $e.Splatted) { $splatted = $true; continue }
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
      $surface.restCalls += [pscustomobject]@{ command = $lower; method = $method; uri = $uri; uriDynamic = $dynamic; splatted = $splatted }
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
const HARMLESS_ALIASES = new Set(PREFLIGHT_RULES.harmlessAliases);

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
  /** A write (anything but GET) is allowed only for paths matching this: a membership, an assignment or a named object, never a collection create. */
  writeWhen?: RegExp;
  /** DELETE is allowed only for paths matching this (a membership or grant, never the object itself). */
  deleteWhen?: RegExp;
}

/**
 * Microsoft Graph paths after /v1.0 or /beta, cut to what the built-in scenarios and the steered
 * strategies use: reads, Intune assignments and settings, and the removal of grants that the
 * least-privilege fixes take away. No PATCH /users (passwordProfile), no addPassword, no CA policy
 * writes, no $ref into groups and no role management through raw REST: those go through typed
 * cmdlets the steered contract has to name. Anything else ($batch, roleManagement, …) is denied.
 */
export const GRAPH_REST_RULES: RestRule[] = [
  { prefix: "/users", methods: ["GET"] },
  // Removing a member or owner reference is allowed (the least-privilege direction); adding one ($ref POST) is not.
  { prefix: "/groups", methods: ["GET", "DELETE"], deleteWhen: /\/(members|owners)\/[^/]+\/\$ref$/i },
  { prefix: "/identity/conditionalaccess/policies", methods: ["GET"] },
  {
    prefix: "/devicemanagement",
    methods: ["GET", "POST", "PUT"],
    // Assign a configuration or health script, sync a device, or replace one configuration policy's settings.
    writeWhen: /^\/devicemanagement\/(deviceconfigurations|devicehealthscripts|configurationpolicies|devicecompliancepolicies)\/[^/]+\/assign$|^\/devicemanagement\/manageddevices\/[^/]+\/syncdevice$|^\/devicemanagement\/configurationpolicies\/[^/]+$/i,
  },
  { prefix: "/serviceprincipals", methods: ["GET", "DELETE"], deleteWhen: /\/(approleassignments|approleassignedto)\/[^/]+$/i },
  { prefix: "/applications", methods: ["GET", "DELETE"], deleteWhen: /\/federatedidentitycredentials\/[^/]+$/i },
  { prefix: "/oauth2permissiongrants", methods: ["GET", "DELETE"], deleteWhen: /^\/oauth2permissiongrants\/[^/]+$/i },
  { prefix: "/sites", methods: ["GET"] },
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
  if (call.splatted) return `${FINDING_PREFIX} ${label} with splatted parameters; spell out a literal -Method and -Uri`;
  // No -Method is the cmdlet's default GET; a computed one cannot be checked.
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
    if (method !== "GET" && method !== "DELETE" && rule.writeWhen && !rule.writeWhen.test(path)) {
      return `${FINDING_PREFIX} Invoke-MgGraphRequest ${method} ${path}: only assignments, device syncs and named configuration policies may be written`;
    }
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
  if (method !== "GET" && /\/providers\/microsoft\.compute\/virtualmachines(scalesets)?\/[^/]+\/(runcommand|runcommands|extensions)\b/i.test(path)) {
    return `${FINDING_PREFIX} Invoke-AzRestMethod ${method} runs code on a VM (run command or extension); not allowed`;
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
  for (const text of surface.engineAccess ?? []) findings.add(`${FINDING_PREFIX} engine access '${text.slice(0, 60)}' (runs strings or script blocks without naming a cmdlet)`);
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
  const surface: ExecutionSurface = { staticCalls: [], newObjects: [], dynamicInvocations: [], dotSources: [], scriptBlockInvokes: [], aliases: [], restCalls: [], engineAccess: [] };
  for (const m of code.matchAll(/\[([A-Za-z_][\w.`]*(?:\[[^\]]*\])?)\]::(\w+)\s*\(/g)) surface.staticCalls.push({ type: m[1]!, member: m[2]! });
  for (const m of code.matchAll(/\bNew-Object\b([^\n;|]*)/gi)) {
    const args = m[1] ?? "";
    const com = /-Com\w*/i.test(args);
    const type = /(?:-TypeName\s+)?['"]?([A-Za-z_][\w.]*)/i.exec(args.replace(/-Com\w*\s+\S+/i, "").trim());
    surface.newObjects.push({ typeName: com ? null : (type?.[1] ?? null), comObject: com });
  }
  for (const m of code.matchAll(/(?:^|[;|{(=])\s*&\s*(\$[\w:{}]+|\([^)]*\)|\[[^\]]+\])/gm)) surface.dynamicInvocations.push(m[0].trim());
  for (const m of code.matchAll(/(?:^|[;{(|])\s*\.\s+(['"]?[$\w.\\/:~-]+['"]?)/gm)) surface.dotSources.push(m[0].trim());
  for (const m of code.matchAll(/\.(Invoke|InvokeReturnAsIs|InvokeWithContext|AddScript|InvokeScript|NewScriptBlock)\s*\(/gi)) surface.scriptBlockInvokes.push(m[0]);
  surface.engineAccess = [];
  for (const m of code.matchAll(/\$ExecutionContext\b[\w.]*|\.(?:InvokeCommand|SessionState|Runspace|InvokeProvider)\b/gi)) surface.engineAccess.push(m[0]);
  for (const m of code.matchAll(/\bAdd-Member\b[^\n;|]*\b(?:Script|Code)(?:Method|Property)\b/gi)) surface.engineAccess.push(m[0]);
  for (const m of code.matchAll(ALIAS_AT_COMMAND)) surface.aliases.push({ name: m[1]!, definition: KNOWN_ALIASES[m[1]!.toLowerCase()] ?? "alias" });
  for (const m of code.matchAll(/\b(Invoke-MgGraphRequest|Invoke-AzRestMethod)\b([^\n]*)/gi)) {
    const args = m[2] ?? "";
    const splatted = /(?:^|\s)@[A-Za-z_]\w*/.test(args);
    const method = /-Method\s*:?\s*['"]?([$\w]+)/i.exec(args)?.[1] ?? null;
    const quoted = /-(?:Uri|Path)\s*:?\s*(['"])(.*?)\1/i.exec(args);
    const bare = quoted ? null : /-(?:Uri|Path)\s*:?\s*(\S+)/i.exec(args);
    const uri = quoted ? quoted[2]! : (bare?.[1] ?? null);
    const uriDynamic = quoted ? quoted[1] === '"' && uri!.includes("$") : Boolean(bare);
    surface.restCalls.push({ command: m[1]!.toLowerCase(), method: method?.startsWith("$") || method?.startsWith("(") ? "<dynamic>" : method, uri, uriDynamic, splatted });
  }
  return surface;
}

/**
 * String literals hold text, not commands: single-quoted strings and here-strings are dropped whole,
 * double-quoted ones keep only their `$( … )` subexpressions, which do run (nested quotes inside a
 * subexpression are handled). With `comments`, `<# … #>` blocks and `#` comments outside strings go too
 * (`#Requires` lines stay). Still a text approximation: the AST report is exact.
 */
export function stripStringLiterals(code: string, comments = false): string {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i]!;
    if (comments && c === "<" && code[i + 1] === "#") {
      const end = code.indexOf("#>", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (comments && c === "#" && (i === 0 || /\s/.test(code[i - 1]!)) && !/^#Requires\b/i.test(code.slice(i, i + 9))) {
      const end = code.indexOf("\n", i);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === "@" && (code[i + 1] === "'" || code[i + 1] === '"')) {
      const quote = code[i + 1]!;
      const end = code.indexOf(`\n${quote}@`, i + 2);
      const body = code.slice(i + 2, end < 0 ? n : end);
      out += quote === "'" ? "''" : subexpressionsOf(body);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (c === "'") {
      i = skipSingle(code, i);
      out += "''";
      continue;
    }
    if (c === '"') {
      const { end, subs } = readDouble(code, i);
      out += subs.length ? `"";${subs.map((sub) => stripStringLiterals(sub, comments)).join(";")}` : '""';
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index after a single-quoted string starting at `i` ('' inside is an escaped quote). */
function skipSingle(code: string, i: number): number {
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === "'") {
      if (code[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return code.length;
}

/** A double-quoted string starting at `i`: the index after it and the code of its `$( … )` subexpressions. */
function readDouble(code: string, i: number): { end: number; subs: string[] } {
  const subs: string[] = [];
  let j = i + 1;
  while (j < code.length) {
    const ch = code[j]!;
    if (ch === "`") {
      j += 2;
      continue;
    }
    if (ch === '"') {
      if (code[j + 1] === '"') {
        j += 2;
        continue;
      }
      return { end: j + 1, subs };
    }
    if (ch === "$" && code[j + 1] === "(") {
      const sub = readSubexpression(code, j + 2);
      subs.push(sub.code);
      j = sub.end;
      continue;
    }
    j++;
  }
  return { end: code.length, subs };
}

/** The code of a `$( … )` subexpression whose body starts at `start`, and the index after its `)`. */
function readSubexpression(code: string, start: number): { code: string; end: number } {
  let depth = 1;
  let j = start;
  while (j < code.length) {
    const ch = code[j]!;
    if (ch === "'") {
      j = skipSingle(code, j);
      continue;
    }
    if (ch === '"') {
      j = readDouble(code, j).end;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return { code: code.slice(start, j), end: j + 1 };
    j++;
  }
  return { code: code.slice(start), end: code.length };
}

/** `"";a;b` for a here-string body: only its `$( … )` subexpressions run. */
function subexpressionsOf(body: string): string {
  const subs: string[] = [];
  for (let j = 0; j < body.length; j++) {
    if (body[j] === "`") {
      j++;
      continue;
    }
    if (body[j] === "$" && body[j + 1] === "(") {
      const sub = readSubexpression(body, j + 2);
      subs.push(stripStringLiterals(sub.code));
      j = sub.end - 1;
    }
  }
  return subs.length ? `"";${subs.join(";")}` : '""';
}

/**
 * Command names the text fallback can see, outside string literals and in any letter case: a
 * `verb-noun` at command position (line start, after `;`, `|`, `{`, `(`, `=` or `&`), plus a bare word at
 * line start or after `;`/`|`/`&` (native binaries such as `pwsh`, `az`, `bash`). The AST report is exact.
 */
export function scanCommandsText(script: string): string[] {
  const code = stripStringLiterals(script, true);
  const names = new Set<string>();
  for (const m of code.matchAll(/(?:^|[;|{(=&])\s*([A-Za-z]+-[A-Za-z]\w*)\b/gim)) names.add(m[1]!);
  for (const m of code.matchAll(/(?:^|[;|&])[ \t]*([A-Za-z][\w.]*)(?=[ \t]+[^=\s]|[ \t]*$)/gim)) {
    const word = m[1]!;
    if (!word.includes("-") && !POWERSHELL_KEYWORDS.has(word.toLowerCase())) names.add(word);
  }
  return [...names];
}

/** Keywords and statement words that can open a line without being a command. */
const POWERSHELL_KEYWORDS = new Set([
  "if", "else", "elseif", "foreach", "for", "while", "do", "until", "switch", "try", "catch", "finally", "throw", "return", "break",
  "continue", "function", "filter", "param", "begin", "process", "end", "trap", "exit", "class", "enum", "using", "data", "dynamicparam",
  "default", "in",
]);

/** Function names a script defines itself (`function Get-GroupByName { … }`). */
export function scanDefinedFunctionsText(script: string): string[] {
  const code = stripStringLiterals(script, true);
  return [...new Set([...code.matchAll(/\bfunction\s+(?:(?:global|script|local):)?([\w-]+)/gi)].map((m) => m[1]!))];
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
    engineAccess: arr(v.engineAccess),
  };
}
