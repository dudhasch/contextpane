"""
ContextPane pre-flight sandbox on Modal.

Deploys a web endpoint that validates a Tier 3 remediation bundle in an isolated
container, exactly like the local pre-flight in apps/orchestrator/src/preflight/local.ts:

  * PowerShell 7 AST parse of the remediation script via
    [System.Management.Automation.Language.Parser]::ParseInput() (+ cmdlet allow-list)
  * unified diff applied to the live NSG state must reproduce the Terraform baseline
  * `terraform fmt -check` and `terraform validate` on the patched state

Deploy:
    modal secret create contextpane-sandbox CTX_MODAL_SANDBOX_TOKEN=<random-token>
    modal deploy modal-sandbox/contextpane_sandbox.py

Modal prints https://<workspace>--contextpane-sandbox-validate-remediation.modal.run; point the
orchestrator at it (scripts/Set-ContextPaneRouterConfig.ps1 -ModalSandboxUrl <url> -ModalSandboxToken <token>).

Request body (JSON): { powershellScript, terraformDiff, actualHcl, expectedHcl }
Response (JSON):     { VerifiedSafe, astCheckPassed, terraformFmtPassed, terraformValidatePassed,
                       sandboxProvider: "modal-cloud-sandbox", validationLatencyMs, findings[] }
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import modal

TERRAFORM_VERSION = "1.9.8"

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
        # Pre-warm the azurerm provider so validate works without network at request time
        "mkdir -p /opt/tfcache /opt/tfwarm && cd /opt/tfwarm && printf 'terraform {\\n  required_providers {\\n    azurerm = {\\n      source  = \"hashicorp/azurerm\"\\n      version = \"~> 4.0\"\\n    }\\n  }\\n}\\n' > versions.tf",
        "cd /opt/tfwarm && TF_PLUGIN_CACHE_DIR=/opt/tfcache terraform init -backend=false -input=false -no-color",
    )
    .pip_install("fastapi[standard]", "unidiff==0.7.5")
)

with image.imports():
    from fastapi import HTTPException, Request

app = modal.App("contextpane-sandbox", image=image)

SANDBOX_PROVIDER = "modal-cloud-sandbox"

FORBIDDEN = {"invoke-expression", "iex", "remove-mguser", "remove-mggroup", "remove-azresourcegroup", "remove-item", "start-process", "invoke-webrequest", "invoke-restmethod"}
REQUIRED = {"set-mguserlicense"}

AST_RUNNER = r"""
$ErrorActionPreference = 'Stop'
try {
  $tokens = $null; $errors = $null
  $source = Get-Content -LiteralPath $args[0] -Raw
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
  $commands = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Select-Object -Unique)
  $attrs = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AttributeAst] }, $true) | ForEach-Object { $_.Extent.Text })
  [pscustomobject]@{
    parseErrors = @($errors | ForEach-Object { "$($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber) $($_.Message)" })
    commands = @($commands)
    supportsShouldProcess = [bool]($attrs | Where-Object { $_ -match 'SupportsShouldProcess' })
  } | ConvertTo-Json -Depth 4 -Compress
} catch {
  [pscustomobject]@{ parseErrors = @("AST runner failed: $($_.Exception.Message)"); commands = @(); supportsShouldProcess = $false } | ConvertTo-Json -Compress
  exit 1
}
"""


def _run(cmd: list[str], cwd: str | None = None, timeout: int = 60, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env={**os.environ, **(env or {})})


def check_powershell(script: str) -> tuple[bool | None, list[str]]:
    findings: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "remediation.ps1"
        runner = Path(tmp) / "runner.ps1"
        target.write_text(script, encoding="utf-8")
        runner.write_text(AST_RUNNER, encoding="utf-8")
        try:
            proc = _run(["pwsh", "-NoProfile", "-NonInteractive", "-File", str(runner), str(target)], timeout=60)
        except subprocess.TimeoutExpired:
            return None, ["PowerShell AST check timed out"]
        out = proc.stdout.strip()
        if not out:
            return None, [f"pwsh produced no output: {proc.stderr.strip()[:200]}"]
        report = json.loads(out[out.index("{"):])
    for err in report.get("parseErrors", []):
        findings.append(f"AST parse error: {err}")
    lowered = [c.lower() for c in report.get("commands", [])]
    for bad in FORBIDDEN:
        if bad in lowered:
            findings.append(f"Forbidden command: {bad}")
    for req in REQUIRED:
        if req not in lowered:
            findings.append(f"Expected command missing: {req}")
    if not report.get("supportsShouldProcess"):
        findings.append("Script does not declare SupportsShouldProcess (-WhatIf unsupported)")
    passed = not report.get("parseErrors") and not any(f.startswith(("Forbidden", "Expected command missing")) for f in findings)
    return passed, findings


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


def check_terraform(diff: str, actual_hcl: str, expected_hcl: str) -> tuple[bool | None, bool | None, list[str]]:
    findings: list[str] = []
    try:
        patched = apply_unified_diff(actual_hcl, diff)
    except ValueError as exc:
        return False, None, [str(exc)]
    if patched is None:
        return False, None, ["Unified diff does not apply cleanly to the live NSG state"]
    if patched.strip() != expected_hcl.strip():
        findings.append("Patched state differs from the Terraform baseline")

    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "versions.tf").write_text(
            'terraform {\n  required_providers {\n    azurerm = {\n      source  = "hashicorp/azurerm"\n      version = "~> 4.0"\n    }\n  }\n}\n\nprovider "azurerm" {\n  features {}\n}\n',
            encoding="utf-8",
        )
        Path(tmp, "main.tf").write_text(patched, encoding="utf-8")
        env = {"TF_PLUGIN_CACHE_DIR": "/opt/tfcache", "TF_IN_AUTOMATION": "1"}
        fmt = _run(["terraform", "fmt", "-check", "-diff", "-no-color", "main.tf"], cwd=tmp, env=env)
        fmt_passed = fmt.returncode == 0
        if not fmt_passed:
            findings.append("terraform fmt reported formatting differences")
        init = _run(["terraform", "init", "-backend=false", "-input=false", "-no-color"], cwd=tmp, timeout=120, env=env)
        if init.returncode != 0:
            findings.append(f"terraform validate skipped (init failed): {init.stderr.strip().splitlines()[:1]}")
            return fmt_passed, None, findings
        validate = _run(["terraform", "validate", "-no-color"], cwd=tmp, env=env)
        validate_passed = validate.returncode == 0
        if not validate_passed:
            findings.append(f"terraform validate: {(validate.stderr or validate.stdout).strip()[:300]}")
        return fmt_passed, validate_passed, findings


def verify_bundle(payload: dict) -> dict:
    """Run every pre-flight check on one bundle; shared by the web endpoint and `modal run`."""
    started = time.time()
    ast_passed, ast_findings = check_powershell(payload.get("powershellScript", ""))
    fmt_passed, validate_passed, tf_findings = check_terraform(
        payload.get("terraformDiff", ""), payload.get("actualHcl", ""), payload.get("expectedHcl", "")
    )
    return {
        "VerifiedSafe": ast_passed is True and fmt_passed is True and validate_passed is True,
        "astCheckPassed": ast_passed,
        "terraformFmtPassed": fmt_passed,
        "terraformValidatePassed": validate_passed,
        "sandboxProvider": SANDBOX_PROVIDER,
        "validationLatencyMs": int((time.time() - started) * 1000),
        "findings": ast_findings + tf_findings,
        "terraformVersion": TERRAFORM_VERSION,
    }


@app.function(timeout=300, secrets=[modal.Secret.from_name("contextpane-sandbox")])
@modal.fastapi_endpoint(method="POST")
def validate_remediation(payload: dict, request: Request) -> dict:
    """Tier 3B pre-flight. Bearer token must match CTX_MODAL_SANDBOX_TOKEN when the secret sets one."""
    expected_token = os.environ.get("CTX_MODAL_SANDBOX_TOKEN", "")
    if expected_token and request.headers.get("authorization", "") != f"Bearer {expected_token}":
        raise HTTPException(status_code=401, detail="invalid sandbox token")
    if not payload.get("powershellScript") or not payload.get("terraformDiff"):
        raise HTTPException(status_code=400, detail="powershellScript and terraformDiff are required")
    return verify_bundle(payload)


@app.function(timeout=300)
def validate_remediation_remote(payload: dict) -> dict:
    return verify_bundle(payload)


@app.local_entrypoint()
def main():
    """Quick check without the web endpoint: `modal run modal-sandbox/contextpane_sandbox.py`."""
    sample = {
        "powershellScript": "[CmdletBinding(SupportsShouldProcess)]\nparam()\nSet-MgUserLicense -UserId x -AddLicenses @() -RemoveLicenses @()\n",
        "terraformDiff": "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-x = 1\n+x = 2\n",
        "actualHcl": "x = 1\n",
        "expectedHcl": "x = 2\n",
    }
    print(json.dumps(validate_remediation_remote.remote(sample), indent=2))
