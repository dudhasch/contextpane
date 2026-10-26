# modal-sandbox: Tier 3B pre-flight and optional open-weight hosting on Modal

Three independent Modal apps:

| File | App | What it does |
|---|---|---|
| `contextpane_sandbox.py` | `contextpane-sandbox` | Tier 3B verifiable pre-flight: `validate_remediation` web endpoint |
| `glimmer_open_weights.py` | `contextpane-glimmer` | Optional open-weight Muse Glimmer 30B (GGUF Q4_K_M) on llama-server, one L40S (Tier 1A / 1B) |
| `open_weights_vllm.py` | `contextpane-open-weights` | Alternative: full-precision `meta-models/Muse-Glimmer-30B` on vLLM, one H100 |

## Tier 3B pre-flight sandbox

The orchestrator validates every remediation bundle locally (PowerShell AST parse +
`terraform fmt` / `terraform validate`). With the Modal endpoint configured, that validation runs
in an isolated Debian container instead, and the local pre-flight becomes the fallback.

```bash
pip install modal
modal setup
modal secret create contextpane-sandbox CTX_MODAL_SANDBOX_TOKEN=$(openssl rand -hex 24)
uvx --from modal --with "fastapi[standard]" modal deploy modal-sandbox/contextpane_sandbox.py
```

Modal prints the endpoint URL (`https://<workspace>--contextpane-sandbox-validate-remediation.modal.run`).
Wire it into the orchestrator:

```powershell
pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalSandboxUrl https://<workspace>--contextpane-sandbox-validate-remediation.modal.run -ModalSandboxToken <token>
```

The container image bakes in PowerShell 7, Terraform 1.9.8 and a Terraform working directory
initialised with `hashicorp/azurerm`. The class runs on 4 vCPUs and stays up for 5 idle minutes
(`scaledown_window=300`); its `@modal.enter()` hook makes every request warm:

- one persistent `pwsh` process reads scripts from stdin and answers with the
  `[System.Management.Automation.Language.Parser]::ParseInput()` report, so the CLR and parser are
  JIT-warm (a `-File` read loop rather than `-Command -`, which splits multi-line input);
- the azurerm provider is started once in plugin debug mode and every `terraform validate`
  attaches to it through `TF_REATTACH_PROVIDERS`, instead of launching the 250 MB binary and
  rebuilding its schema (~1 s) per request; validate falls back to the normal launch if the
  attached provider is gone;
- `terraform version`, `fmt` and one `validate` run once so the binaries sit in the page cache.

Per request the AST parse (plus cmdlet allow-list), `terraform fmt -check` and `terraform validate`
on the diff-patched NSG state run concurrently on a thread pool, and `checkLatencyMs` reports each:

```json
{
  "VerifiedSafe": true,
  "astCheckPassed": true,
  "terraformFmtPassed": true,
  "terraformValidatePassed": true,
  "sandboxProvider": "modal-cloud-sandbox",
  "validationLatencyMs": 330,
  "findings": [],
  "checkLatencyMs": { "powershellAst": 8, "terraformFmt": 41, "terraformValidate": 315 }
}
```

`{"warmup": true}` returns `{ "ok": true, "warmed": true }` once `enter()` has finished. The
orchestrator sends it at startup, on every `/api/correlate` and at the start of `/api/remediate`
(at most once a minute), so the container is warm before the operator clicks Generate Fix.

If the endpoint is unreachable or errors, the orchestrator falls back to the local pre-flight
and records that in `verificationStatus.findings`. `modal run modal-sandbox/contextpane_sandbox.py`
validates the `demo-iac/main.tf` baseline three times on one container and prints the timings.

## Optional: open-weight Muse Glimmer 30B (GGUF) on Modal or locally

Muse Glimmer is self- or partner-hosted, not served on `api.meta.ai`. `glimmer_open_weights.py`
serves `meta-models/Muse-Glimmer-30B-GGUF` (`Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf`, 16.8 GB)
with llama.cpp's `llama-server` (CUDA image, build b10353 or newer is checked at start-up) on one
L40S. Per the model card it runs with
`--jinja`, and because reasoning cannot be switched off it caps it with
`reasoning_strength: "low"` and `--reasoning-budget 256` (b11889 did not enforce the budget in our runs: a
host-pool hover reasoned ~1,100 tokens, so Glimmer hovers get `max_tokens` 3000,
`CTX_OPEN_WEIGHT_HOVER_MAX_TOKENS`). One command creates the token secret,
downloads the weights, deploys and writes the URL and token into `.env.local`:

```powershell
pwsh ./scripts/Start-GlimmerOpenWeights.ps1                 # Modal; telemetry provider "modal-open-weights"
pwsh ./scripts/Start-GlimmerOpenWeights.ps1 -Target Local   # llama-server on 127.0.0.1:8080; "local-glimmer-30b"
```

Credit guardrails on the Modal target:

- the GGUF is pulled once into the `contextpane-glimmer-weights` Volume, so a scale-up loads it
  from the Volume instead of re-downloading 17 GB from Hugging Face;
- the `Glimmer` class scales to zero after 2 idle minutes (`scaledown_window=120`) and is capped at
  one container (`max_containers=1`, 4 llama-server slots), so a burst queues instead of renting a
  second L40S;
- the orchestrator only sends hovers there (`CTX_OPEN_WEIGHT_TIERS=hover`; add `catalog` or `voice`
  to opt those tiers in) and persists every answer, with its provider, model, latency and tokens, to
  `data/hover-cache.json`. A restart serves every pill from that file and only calls the GPU for
  entities it does not hold yet, or for `POST /api/hover?refresh=true`.

The local target needs about 17 GB of VRAM for full offload (`-GpuLayers` lowers it, at a large
speed cost). Tier 1A hovers then try Glimmer first (`CTX_OPEN_WEIGHT_HOVER_TIMEOUT_MS`, default
8 s; the background pre-warm waits for `/health` and allows `CTX_OPEN_WEIGHT_WARM_TIMEOUT_MS`,
default 90 s), with `chat_template_kwargs.reasoning_strength` derived from the tier's reasoning
effort; the Meta Model API stays the fallback.

### Alternative: full precision on vLLM

`open_weights_vllm.py` serves Meta's open weights behind vLLM's OpenAI-compatible API
(`@modal.web_server(8000)`, one H100, scales to zero after 5 idle minutes). Forced
`tool_choice` works through vLLM's guided decoding, so the same `hydrate_contextpane_layout`
tool call the Meta API answers also works here.

```bash
modal secret create contextpane-open-weights HF_TOKEN=<hf-token> CTX_OPEN_WEIGHT_API_KEY=$(openssl rand -hex 24)
modal deploy modal-sandbox/open_weights_vllm.py
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
