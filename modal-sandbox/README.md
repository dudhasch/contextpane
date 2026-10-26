# modal-sandbox: Tier 3B pre-flight and optional open-weight hosting on Modal

Two independent Modal apps:

| File | App | What it does |
|---|---|---|
| `contextpane_sandbox.py` | `contextpane-sandbox` | Tier 3B verifiable pre-flight: `validate_remediation` web endpoint |
| `open_weights_vllm.py` | `contextpane-open-weights` | Optional scale-to-zero vLLM server for open-weight `muse-glimmer-30b` (Tier 1A / 1B) |

## Tier 3B pre-flight sandbox

The orchestrator validates every remediation bundle locally (PowerShell AST parse +
`terraform fmt` / `terraform validate`). With the Modal endpoint configured, that validation runs
in an isolated Debian container instead, and the local pre-flight becomes the fallback.

```bash
pip install modal
modal setup
modal secret create contextpane-sandbox CTX_MODAL_SANDBOX_TOKEN=$(openssl rand -hex 24)
modal deploy modal-sandbox/contextpane_sandbox.py
```

Modal prints the endpoint URL (`https://<workspace>--contextpane-sandbox-validate-remediation.modal.run`).
Wire it into the orchestrator:

```powershell
pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalSandboxUrl https://<workspace>--contextpane-sandbox-validate-remediation.modal.run -ModalSandboxToken <token>
```

The container image bakes in PowerShell 7, Terraform 1.9.8 and a pre-warmed `hashicorp/azurerm`
provider cache. Each request runs
`[System.Management.Automation.Language.Parser]::ParseInput()` on the script (plus a cmdlet
allow-list), applies the unified diff to the live NSG state, and runs `terraform fmt -check` and
`terraform validate` on the result:

```json
{
  "VerifiedSafe": true,
  "astCheckPassed": true,
  "terraformFmtPassed": true,
  "terraformValidatePassed": true,
  "sandboxProvider": "modal-cloud-sandbox",
  "validationLatencyMs": 912,
  "findings": []
}
```

If the endpoint is unreachable or errors, the orchestrator falls back to the local pre-flight
and records that in `verificationStatus.findings`. `modal run modal-sandbox/contextpane_sandbox.py`
validates a trivial bundle without going through the web endpoint.

## Optional: open-weight muse-glimmer-30b on Modal

`open_weights_vllm.py` serves Meta's open weights behind vLLM's OpenAI-compatible API
(`@modal.web_server(8000)`, one H100, scales to zero after 5 idle minutes). Forced
`tool_choice` works through vLLM's guided decoding, so the same `hydrate_contextpane_layout`
tool call the Meta API answers also works here.

```bash
modal secret create contextpane-open-weights HF_TOKEN=<hf-token> CTX_OPEN_WEIGHT_API_KEY=$(openssl rand -hex 24)
CTX_GLIMMER_HF_REPO=<org>/<repo> modal deploy modal-sandbox/open_weights_vllm.py
```

```powershell
pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalInferenceUrl https://<workspace>--contextpane-open-weights-serve.modal.run/v1 -OpenWeightApiKey <token>
```

Tier 1A hover and Tier 1B catalog hydration then call this endpoint first and fall through to
the Meta Model API when it is cold or slow (`CTX_HOVER_TIMEOUT_MS`, `CTX_CORRELATE_TIMEOUT_MS`).

## Optional: the same model on RunPod

`scripts/Start-RunPodGlimmer.ps1` launches a `vllm/vllm-openai` pod with `runpodctl` and prints the
`-RunPodBaseUrl https://<pod-id>-8000.proxy.runpod.net/v1` line to hand to
`Set-ContextPaneRouterConfig.ps1`.
