# modal-sandbox — remote pre-flight for Tier 3 remediation

Optional. The orchestrator validates every remediation bundle locally (PowerShell AST parse +
`terraform fmt` / `terraform validate`). Deploy this Modal app when you want that validation to
run in an isolated container instead of on the demo machine.

```bash
pip install modal
modal setup
modal secret create contextpane-sandbox CTX_MODAL_SANDBOX_TOKEN=$(openssl rand -hex 24)
modal deploy modal-sandbox/contextpane_sandbox.py
```

Modal prints the web endpoint URL (`https://<workspace>--contextpane-sandbox-preflight.modal.run`).
Wire it into the orchestrator:

```powershell
pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalSandboxUrl https://<workspace>--contextpane-sandbox-preflight.modal.run -ModalSandboxToken <token>
```

`CTX_MODAL_SANDBOX_ENABLED=true` is set automatically. If the endpoint is unreachable the
orchestrator falls back to the local pre-flight and records that in `verificationStatus.findings`.

The container image bakes in PowerShell 7, Terraform 1.9.8 and a pre-warmed `hashicorp/azurerm`
provider cache, so a request completes in roughly a second.
