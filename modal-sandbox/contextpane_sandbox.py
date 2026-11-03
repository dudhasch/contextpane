"""
ContextPane pre-flight sandbox on Modal.

Deploys a web endpoint that validates a Tier 3 remediation bundle in an isolated
container, exactly like the local pre-flight in apps/orchestrator/src/preflight/local.ts:

  * PowerShell 7 AST parse of the remediation script via
    [System.Management.Automation.Language.Parser]::ParseInput() and the shared rule set in
    packages/catalog/src/preflight-rules.json (allow-list, forbidden commands, destructive
    wildcards: all hard failures, exactly as in the local pre-flight)
  * unified diff applied to the live NSG state must reproduce the Terraform baseline
  * `terraform fmt -check` and `terraform validate` on the patched state

Warm path: every container starts one persistent pwsh process at @modal.enter() and keeps its
stdin/stdout pipes open, so the .NET CLR and the PowerShell parser are already JIT-warm when a
request arrives. The Terraform working directory is initialised at image build time, and enter()
runs `terraform version` plus one throwaway `terraform validate` so the azurerm provider binary
sits in the page cache. Per request the AST parse, `terraform fmt -check` and `terraform validate`
then run concurrently on a thread pool. `{"warmup": true}` returns as soon as enter() is done,
which is how the orchestrator wakes a container before the operator asks for a fix.

Deploy:
    modal secret create contextpane-sandbox CTX_MODAL_SANDBOX_TOKEN=<random-token>
    uvx --from modal --with "fastapi[standard]" modal deploy modal-sandbox/contextpane_sandbox.py

Modal prints https://<workspace>--contextpane-sandbox-validate-remediation.modal.run; point the
orchestrator at it (scripts/Set-ContextPaneRouterConfig.ps1 -ModalSandboxUrl <url> -ModalSandboxToken <token>).

Request body (JSON): { powershellScript, terraformDiff, actualHcl, expectedHcl } or { warmup: true }
Response (JSON):     { VerifiedSafe, astCheckPassed, terraformFmtPassed, terraformValidatePassed,
                       sandboxProvider: "modal-cloud-sandbox", validationLatencyMs, findings[] }
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import queue
import re
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import modal

TERRAFORM_VERSION = "1.9.8"
TF_WORKDIR = "/opt/tfwork"
TF_ENV = {"TF_PLUGIN_CACHE_DIR": "/opt/tfcache", "TF_IN_AUTOMATION": "1", "CHECKPOINT_DISABLE": "1"}
VERSIONS_TF = (
    'terraform {\n  required_providers {\n    azurerm = {\n      source  = "hashicorp/azurerm"\n      version = "~> 4.0"\n    }\n  }\n}\n\n'
    'provider "azurerm" {\n  features {}\n}\n'
)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("wget", "unzip", "ca-certificates", "apt-transport-https", "gnupg")
    .run_commands(
        # PowerShell 7
        "wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/ms.deb",
        "dpkg -i /tmp/ms.deb && apt-get update && apt-get install -y powershell",
        # Terraform
        f"wget -q https://releases.hashicorp.com/terraform/{TERRAFORM_VERSION}/terraform_{TERRAFORM_VERSION}_linux_amd64.zip -O /tmp/tf.zip",
        "unzip -o /tmp/tf.zip -d /usr/local/bin && chmod +x /usr/local/bin/terraform",
    )
    # Initialise the working directory once at build time; requests only link to its .terraform dir
    .run_commands(
        f"mkdir -p /opt/tfcache {TF_WORKDIR} && echo {base64.b64encode(VERSIONS_TF.encode()).decode()} | base64 -d > {TF_WORKDIR}/versions.tf",
        f"cd {TF_WORKDIR} && TF_PLUGIN_CACHE_DIR=/opt/tfcache CHECKPOINT_DISABLE=1 terraform init -backend=false -input=false -no-color",
    )
    .pip_install("fastapi[standard]", "unidiff==0.7.5")
    # The rule set the local pre-flight enforces too (packages/catalog/src/preflight-rules.json): one list, two sandboxes.
    .add_local_file(str(Path(__file__).resolve().parent.parent / "packages" / "catalog" / "src" / "preflight-rules.json"), "/root/preflight-rules.json")
)

with image.imports():
    from fastapi import HTTPException, Request

app = modal.App("contextpane-sandbox", image=image)

SANDBOX_PROVIDER = "modal-cloud-sandbox"



def _load_rules() -> dict:
    """The shared rule set: next to this file inside the Modal image, under packages/catalog/src in a checkout."""
    here = Path(__file__).resolve().parent
    for candidate in (here / "preflight-rules.json", here.parent / "packages" / "catalog" / "src" / "preflight-rules.json"):
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("preflight-rules.json not found next to the sandbox or in packages/catalog/src")


RULES = _load_rules()
READ_ONLY_VERBS = {v.lower() for v in RULES["readOnlyVerbs"]}
ALLOWED_COMMANDS = set(RULES["allowedCommands"])
HARMLESS_ALIASES = set(RULES["harmlessAliases"])
FORBIDDEN = set(RULES["forbiddenCommands"])
DENIED_EXECUTION = set(RULES["deniedExecutionCommands"])
DESTRUCTIVE = [re.compile(p, re.IGNORECASE) for p in RULES["destructivePatterns"]]
FORBIDDEN_PATTERNS = [re.compile(p, re.IGNORECASE) for p in RULES["forbiddenPatterns"]]
PRIVILEGED = [re.compile(p, re.IGNORECASE) for p in RULES["privilegedPatterns"]]
# "Execution surface:" findings (RULES["deniedExecutionCommands"], .NET calls, aliases, REST targets) are added by the
# orchestrator from this sandbox's AST report; listed here so the two sides share one set of hard-fail prefixes.
# Same list as PREFLIGHT_HARD_FAIL_PREFIXES in packages/catalog/src/preflight-rules.ts.
HARD_FAIL_PREFIXES = (
    "Forbidden command",
    "Expected command missing",
    "Destructive wildcard",
    "Command outside allow-list",
    "Privileged command",
    "PowerShell 7 not available",
    "Execution surface:",
)


def evaluate_rules(commands: list[str], script: str, required: set[str], allow: set[str], defined: set[str]) -> list[str]:
    """The shared rule set, finding for finding the same as evaluatePreflightRules (packages/catalog/src/preflight-rules.ts)."""
    findings: list[str] = []
    lowered = list(dict.fromkeys(c.lower() for c in commands))
    allowed = {c.lower() for c in required} | {c.lower() for c in allow}
    defined_lower = {c.lower() for c in defined}
    for bad in RULES["forbiddenCommands"]:
        if bad in lowered:
            findings.append(f"Forbidden command: {bad}")
    for req in required:
        if req.lower() not in lowered:
            findings.append(f"Expected command missing: {req}")
    for cmd in dict.fromkeys(commands):
        c = cmd.lower()
        if c in FORBIDDEN or c in DENIED_EXECUTION or c in allowed or c in defined_lower:
            continue
        if "-" not in c:
            if c not in HARMLESS_ALIASES:
                findings.append(f"Command outside allow-list: {cmd} (native command or alias; use an allow-listed cmdlet)")
            continue
        if c in ALLOWED_COMMANDS:
            continue
        if any(p.search(c) for p in PRIVILEGED):
            findings.append(f"Privileged command outside the steered contract: {cmd}")
            continue
        if c.split("-")[0] in READ_ONLY_VERBS:
            continue
        findings.append(f"Command outside allow-list: {cmd}")
    for p in FORBIDDEN_PATTERNS:
        if p.search(script):
            findings.append(f"Forbidden command: password or policy-disable pattern /{p.pattern}/")
    if any(p.search(script) for p in DESTRUCTIVE):
        findings.append("Destructive wildcard command detected (e.g. Remove-MgUser -All or unscoped Remove-AzResource -Force)")
    return findings


REQUIRED = {"set-mguserlicense"}

# Execution-surface extraction (.NET calls, dynamic invocations, aliases, REST targets); the orchestrator applies
# the rules to it (apps/orchestrator/src/preflight/execution-surface.ts). Keep in sync with SURFACE_PS there.
SURFACE_PS = r"""
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
"""

# One request per stdin line (the script as base64), one compressed JSON report per stdout line.
# A -File loop rather than `pwsh -Command -`: -Command - executes stdin line by line and splits multi-line blocks.
AST_SERVER = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $tokens = $null; $errors = $null
    $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Trim()))
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
    $commands = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Select-Object -Unique)
    $attrs = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AttributeAst] }, $true) | ForEach-Object { $_.Extent.Text })
    $functions = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name } | Select-Object -Unique)
__SURFACE_PS__
    $report = [pscustomobject]@{
      parseErrors = @($errors | ForEach-Object { "$($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber) $($_.Message)" })
      commands = @($commands)
      functions = @($functions)
      supportsShouldProcess = [bool]($attrs | Where-Object { $_ -match 'SupportsShouldProcess' })
      surface = $surface
    }
  } catch {
    $report = [pscustomobject]@{ parseErrors = @("AST runner failed: $($_.Exception.Message)"); commands = @(); supportsShouldProcess = $false }
  }
  [Console]::Out.WriteLine(($report | ConvertTo-Json -Depth 6 -Compress))
  [Console]::Out.Flush()
}
"""

AST_SERVER = AST_SERVER.replace("__SURFACE_PS__", SURFACE_PS)

SAMPLE_SCRIPT = "[CmdletBinding(SupportsShouldProcess)]\nparam()\nif ($PSCmdlet.ShouldProcess('x')) { Set-MgUserLicense -UserId x -AddLicenses @() -RemoveLicenses @() }\n"
SAMPLE_HCL = 'resource "azurerm_resource_group" "warm" {\n  name     = "rg-warm"\n  location = "westeurope"\n}\n'


def _run(cmd: list[str], cwd: str | None = None, timeout: int = 60, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env={**os.environ, **(env or {})})


class PwshAstServer:
    """A pwsh process that stays up for the life of the container; restarted if it dies or hangs."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.path = Path(tempfile.gettempdir(), "contextpane_ast_server.ps1")
        self.path.write_text(AST_SERVER, encoding="utf-8")
        self.proc: subprocess.Popen | None = None
        self.lines: queue.Queue[str] = queue.Queue()
        self._start()

    def _start(self) -> None:
        self.proc = subprocess.Popen(
            ["pwsh", "-NoProfile", "-NonInteractive", "-File", str(self.path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        self.lines = queue.Queue()
        threading.Thread(target=self._pump, args=(self.proc, self.lines), daemon=True).start()

    @staticmethod
    def _pump(proc: subprocess.Popen, lines: queue.Queue[str]) -> None:
        for line in proc.stdout:  # type: ignore[union-attr]
            lines.put(line)

    def parse(self, script: str, timeout: float = 30.0) -> dict | None:
        with self.lock:
            if self.proc is None or self.proc.poll() is not None:
                self._start()
            assert self.proc and self.proc.stdin
            self.proc.stdin.write(base64.b64encode(script.encode("utf-8")).decode("ascii") + "\n")
            self.proc.stdin.flush()
            try:
                out = self.lines.get(timeout=timeout).strip()
            except queue.Empty:
                self.proc.kill()
                self.proc = None
                return None
            return json.loads(out[out.index("{") :])


def timed(fn, *args):
    """Run fn and return (result, elapsed ms); the response reports each check's own time."""
    started = time.time()
    result = fn(*args)
    return result, int((time.time() - started) * 1000)


def check_powershell(ast_server: PwshAstServer, script: str, required: set[str] | None = None, allow: set[str] | None = None) -> tuple[bool | None, list[str], dict | None]:
    """Parse verdict, findings and the raw AST report (its commands and surface go back to the orchestrator)."""
    report = ast_server.parse(script)
    if report is None:
        # No verdict: the orchestrator fails the bundle (PowerShell 7 not available / AST did not run).
        return None, ["PowerShell AST check timed out"], None
    findings: list[str] = []
    for err in report.get("parseErrors", []):
        findings.append(f"AST parse error: {err}")
    commands = report.get("commands", []) or []
    if isinstance(commands, str):
        commands = [commands]
    functions = report.get("functions", []) or []
    if isinstance(functions, str):
        functions = [functions]
    findings.extend(evaluate_rules(commands, script, required if required is not None else REQUIRED, allow or set(), set(functions)))
    if not report.get("supportsShouldProcess"):
        findings.append("Script does not declare SupportsShouldProcess (-WhatIf unsupported)")
    # Same hard failures as the local pre-flight: allow-list, privileged commands, forbidden, steered commands, destructive
    # wildcards. The execution-surface rules (and the shared rules once more) run on the returned report in the orchestrator.
    passed = not report.get("parseErrors") and not any(f.startswith(HARD_FAIL_PREFIXES) for f in findings)
    return passed, findings, report


def apply_unified_diff(original: str, diff: str) -> str | None:
    from unidiff import PatchSet

    try:
        patch = PatchSet(diff)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"diff could not be parsed: {exc}") from exc
    if not patch:
        return original
    lines = original.splitlines(keepends=True)
    out: list[str] = []
    cursor = 0
    for hunk in patch[0]:
        start = hunk.source_start - 1
        out.extend(lines[cursor:start])
        cursor = start
        for line in hunk:
            if line.is_context or line.is_removed:
                if cursor >= len(lines) or lines[cursor].rstrip("\n") != line.value.rstrip("\n"):
                    return None
                if line.is_context:
                    out.append(lines[cursor])
                cursor += 1
            elif line.is_added:
                out.append(line.value if line.value.endswith("\n") else line.value + "\n")
    out.extend(lines[cursor:])
    return "".join(out)


def terraform_fmt(hcl: str) -> bool:
    """`terraform fmt -check` on stdin: exit 0 when the file is already canonical."""
    proc = subprocess.run(
        ["terraform", "fmt", "-check", "-no-color", "-"], input=hcl, capture_output=True, text=True, timeout=30, env={**os.environ, **TF_ENV}
    )
    return proc.returncode == 0


class ReattachedProvider:
    """
    The azurerm provider, started once in plugin debug mode. `terraform validate` attaches to it through
    TF_REATTACH_PROVIDERS instead of launching the 250 MB binary and rebuilding its schema on every request
    (~1 s of each validate). `env` stays empty when the provider cannot be started that way, and validate
    then launches the provider itself as usual.
    """

    def __init__(self, timeout: float = 90.0) -> None:
        self.proc: subprocess.Popen | None = None
        self.env: dict[str, str] = {}
        binary = next(Path("/opt/tfcache").rglob("terraform-provider-azurerm*"), None)
        if binary is None:
            return
        self.proc = subprocess.Popen([str(binary), "-debuggable"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        found: queue.Queue[str] = queue.Queue()

        def pump() -> None:
            # Keeps draining the provider's output for its whole life so the pipe never blocks it.
            for line in self.proc.stdout:  # type: ignore[union-attr]
                match = re.search(r"TF_REATTACH_PROVIDERS='(.+)'", line)
                if match:
                    found.put(match.group(1))

        threading.Thread(target=pump, daemon=True).start()
        try:
            self.env = {"TF_REATTACH_PROVIDERS": found.get(timeout=timeout)}
        except queue.Empty:
            self.stop()

    def alive(self) -> bool:
        return bool(self.env) and self.proc is not None and self.proc.poll() is None

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
        self.env = {}


def terraform_validate(hcl: str, provider: ReattachedProvider | None = None) -> tuple[bool, str]:
    """`terraform validate` in a throwaway dir that links to the build-time initialised .terraform."""
    with tempfile.TemporaryDirectory() as tmp:
        os.symlink(f"{TF_WORKDIR}/.terraform", f"{tmp}/.terraform")
        for name in ("versions.tf", ".terraform.lock.hcl"):
            Path(tmp, name).write_text(Path(TF_WORKDIR, name).read_text(encoding="utf-8"), encoding="utf-8")
        Path(tmp, "main.tf").write_text(hcl, encoding="utf-8")
        reattach = provider.env if provider and provider.alive() else {}
        proc = _run(["terraform", "validate", "-no-color"], cwd=tmp, env={**TF_ENV, **reattach})
        if reattach and proc.returncode != 0 and "plugin" in (proc.stderr or "").lower():
            # The attached provider misbehaved: drop it and validate the ordinary way.
            provider.stop()  # type: ignore[union-attr]
            proc = _run(["terraform", "validate", "-no-color"], cwd=tmp, env=TF_ENV)
        return proc.returncode == 0, (proc.stderr or proc.stdout).strip()


def authorized(header: str, env: dict | None = None) -> bool:
    """Bearer check for the web endpoint: required by default, compared in constant time."""
    env = os.environ if env is None else env
    expected = env.get("CTX_MODAL_SANDBOX_TOKEN", "")
    if not expected:
        return str(env.get("CTX_MODAL_SANDBOX_ALLOW_UNAUTHENTICATED", "")).lower() == "true"
    return hmac.compare_digest(header.encode("utf-8"), f"Bearer {expected}".encode("utf-8"))


@app.cls(cpu=4.0, memory=2048, scaledown_window=300, timeout=300, secrets=[modal.Secret.from_name("contextpane-sandbox")])
class Sandbox:
    @modal.enter()
    def warm(self) -> None:
        started = time.time()
        self.pool = ThreadPoolExecutor(max_workers=3)
        self.ast = PwshAstServer()
        # Run each code path once so the CLR JIT, the terraform binary and the azurerm provider are hot.
        warm_ast = self.pool.submit(self.ast.parse, SAMPLE_SCRIPT, 120.0)
        _run(["terraform", "version"], env=TF_ENV)
        terraform_fmt(SAMPLE_HCL)
        self.provider = ReattachedProvider()
        print(f"azurerm provider {'attached via TF_REATTACH_PROVIDERS' if self.provider.alive() else 'launched per validate'}")
        terraform_validate(SAMPLE_HCL, self.provider)
        warm_ast.result()
        self.boot_ms = int((time.time() - started) * 1000)
        print(f"sandbox warm in {self.boot_ms} ms")

    @modal.exit()
    def stop(self) -> None:
        if self.ast.proc:
            self.ast.proc.kill()
        self.provider.stop()
        self.pool.shutdown(wait=False)

    def verify_bundle(self, payload: dict) -> dict:
        started = time.time()
        findings: list[str] = []
        timings: dict[str, int] = {}
        required = {c.lower() for c in payload["requiredCommands"]} if isinstance(payload.get("requiredCommands"), list) else None
        allow = {c.lower() for c in payload["allowedCommands"]} if isinstance(payload.get("allowedCommands"), list) else set()
        ast_future = self.pool.submit(timed, check_powershell, self.ast, payload.get("powershellScript", ""), required, allow)

        fmt_passed: bool | None = None
        validate_passed: bool | None = None
        has_iac = bool(payload.get("terraformDiff", "").strip())
        try:
            # Conditional Access, Intune and licensing fixes carry no Terraform diff: those checks are not applicable.
            patched = apply_unified_diff(payload.get("actualHcl", ""), payload.get("terraformDiff", "")) if has_iac else None
            if has_iac and patched is None:
                fmt_passed = False
                findings.append("Unified diff does not apply cleanly to the live NSG state")
        except ValueError as exc:
            patched = None
            fmt_passed = False
            findings.append(str(exc))
        if patched is not None:
            if patched.strip() != payload.get("expectedHcl", "").strip():
                findings.append("Patched state differs from the Terraform baseline")
            fmt_future = self.pool.submit(timed, terraform_fmt, patched)
            validate_future = self.pool.submit(timed, terraform_validate, patched, self.provider)
            fmt_passed, timings["terraformFmt"] = fmt_future.result()
            if not fmt_passed:
                findings.append("terraform fmt reported formatting differences")
            (validate_passed, validate_output), timings["terraformValidate"] = validate_future.result()
            if not validate_passed:
                findings.append(f"terraform validate: {validate_output[:300]}")

        (ast_passed, ast_findings, ast_report), timings["powershellAst"] = ast_future.result()
        return {
            "VerifiedSafe": ast_passed is True and (not has_iac or (fmt_passed is True and validate_passed is True)),
            "astCheckPassed": ast_passed,
            "terraformFmtPassed": fmt_passed,
            "terraformValidatePassed": validate_passed,
            "sandboxProvider": SANDBOX_PROVIDER,
            "validationLatencyMs": int((time.time() - started) * 1000),
            "findings": ast_findings + findings,
            # The orchestrator applies the execution-surface rules to these (preflight/modal.ts).
            **({"commands": ast_report.get("commands", []), "functions": ast_report.get("functions", []), "surface": ast_report.get("surface")} if ast_report else {}),
            "checkLatencyMs": timings,
            "terraformVersion": TERRAFORM_VERSION,
        }

    @modal.fastapi_endpoint(method="POST", label="contextpane-sandbox-validate-remediation")
    def validate_remediation(self, payload: dict, request: Request) -> dict:
        """Tier 3B pre-flight. The bearer token must match CTX_MODAL_SANDBOX_TOKEN (constant-time compare).

        With no token in the secret the endpoint refuses every request, unless the secret also sets
        CTX_MODAL_SANDBOX_ALLOW_UNAUTHENTICATED=true (a throwaway test deployment only).
        """
        if not authorized(request.headers.get("authorization", "")):
            raise HTTPException(status_code=401, detail="invalid sandbox token")
        if payload.get("warmup"):
            return {"ok": True, "warmed": True, "bootMs": self.boot_ms, "sandboxProvider": SANDBOX_PROVIDER}
        if not payload.get("powershellScript"):
            raise HTTPException(status_code=400, detail="powershellScript is required")
        return self.verify_bundle(payload)

    @modal.method()
    def verify(self, payload: dict) -> dict:
        return self.verify_bundle(payload)


@app.local_entrypoint()
def main():
    """Timing check without the web endpoint: `modal run modal-sandbox/contextpane_sandbox.py` validates demo-iac/main.tf."""
    main_tf = (Path(__file__).resolve().parent.parent / "demo-iac" / "main.tf").read_text(encoding="utf-8")
    # The orchestrator sends resource blocks only; the terraform/provider blocks come from versions.tf
    baseline = main_tf[main_tf.index("locals {") :]
    sample = {"powershellScript": SAMPLE_SCRIPT, "terraformDiff": "", "actualHcl": baseline, "expectedHcl": baseline}
    sandbox = Sandbox()
    for _ in range(3):
        print(json.dumps(sandbox.verify.remote(sample)))
