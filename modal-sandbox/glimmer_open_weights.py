"""
Meta's open-weight Muse Glimmer 30B (GGUF, Q4_K_M) on a Modal GPU behind llama.cpp's llama-server.

Muse Glimmer is self- or partner-hosted, not served on api.meta.ai. This app serves
meta-models/Muse-Glimmer-30B-GGUF (Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf, 16.8 GB, fits 24 GB VRAM)
on one L40S with an OpenAI-compatible /v1/chat/completions, and scales to zero after SCALEDOWN_SECONDS (2 min).
Credit guardrails: the weights live in the contextpane-glimmer-weights Volume (pulled once, never per
container), at most one GPU container runs, and the orchestrator persists every answer to
data/hover-cache.json so restarts do not wake the GPU.
The orchestrator calls it first for Tier 1A hovers and Tier 1B catalog hydration and logs
provider "modal-open-weights"; a local llama-server (scripts/Start-GlimmerOpenWeights.ps1 -Local)
logs "local-glimmer-30b".

Model-card facts this follows (huggingface.co/meta-models/Muse-Glimmer-30B-GGUF):
  * llama.cpp build b10353 or newer; older builds do not register the muse-glimmer architecture
  * --jinja is required (the chat template is embedded in the GGUF)
  * reasoning cannot be switched off; --chat-template-kwargs reasoning_strength (low..xhigh) sets how
    much, --reasoning-budget is meant to cap it. Hovers want "low" and a small budget; on b11889 the
    budget was not enforced (a hover reasoned ~1,100 tokens), so the orchestrator also sends max_tokens 3000
  * -c is split across -np slots

Deploy (one-off download of the weights into a Modal Volume, then the server):
    modal secret create contextpane-open-weights CTX_OPEN_WEIGHT_API_KEY=<random-token>
    uvx modal run modal-sandbox/glimmer_open_weights.py::download
    uvx modal deploy modal-sandbox/glimmer_open_weights.py

Modal prints https://<workspace>--contextpane-glimmer-serve.modal.run; wire it in with
    pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalInferenceUrl https://<workspace>--contextpane-glimmer-serve.modal.run/v1 -OpenWeightApiKey <token>
"""

from __future__ import annotations

import copy
import json
import os
import re
import subprocess
import time

import modal

HF_REPO = "meta-models/Muse-Glimmer-30B-GGUF"
GGUF_FILE = os.environ.get("CTX_GLIMMER_GGUF", "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf")
# Name the orchestrator sends as `model` (CTX_MODEL_OPEN_WEIGHT_GLIMMER)
SERVED_MODEL_NAME = os.environ.get("CTX_MODEL_OPEN_WEIGHT_GLIMMER", "muse-glimmer-30b")
GPU = os.environ.get("CTX_GLIMMER_GPU", "L40S")
SLOTS = 4
CONTEXT_PER_SLOT = 16384
REASONING_STRENGTH = os.environ.get("CTX_GLIMMER_REASONING_STRENGTH", "low")
REASONING_BUDGET = int(os.environ.get("CTX_GLIMMER_REASONING_BUDGET", "256"))
MIN_LLAMA_BUILD = 10353
SCALEDOWN_SECONDS = 120
MAX_CONTAINERS = 1
PORT = 8080
WEIGHTS_DIR = "/weights"
# The default Q4_K_M GGUF is 16.8 GB; anything under this is a truncated or partial pull.
MIN_GGUF_BYTES = int(os.environ.get("CTX_GLIMMER_MIN_GGUF_BYTES", "16000000000"))
HEALTH_URL = f"http://127.0.0.1:{PORT}/health"
# Inside the 15 min web_server startup_timeout; loading 16.8 GB onto the L40S takes well under it.
HEALTH_TIMEOUT_SECONDS = 14 * 60
HEALTH_POLL_SECONDS = 2.0

# Speculative decoding + KV-cache quantisation (llama-server flags in build_llama_server_cmd).
# CTX_GLIMMER_DRAFT_MODEL is a draft GGUF filename under /weights or an absolute path; unset disables it.
DRAFT_MODEL = os.environ.get("CTX_GLIMMER_DRAFT_MODEL", "")
DRAFT_MAX = 8
DRAFT_MIN = 2
KV_CACHE_QUANT = "q8_0"

_ENTITY_TYPES = ["upn", "group", "device", "policy", "errorCode", "sku", "resource", "setting", "ticket", "contract"]
_HEALTH_STATES = ["healthy", "warning", "critical", "unknown"]
_ACTION_KINDS = ["inspect-policy", "stage-license-fix", "stage-intune-fix", "view-diff", "generate-fix", "open-sign-in-logs", "custom"]
_NO_PTR = "Plain text only; never emit a ptr:// data-plane pointer (the hover diagnostic carries no dataPtr)."

# Strict JSON Schema mirroring HoverDiagnosticArgs in packages/catalog (HoverDiagnosticPopover
# minus providerTelemetry/latencyBudgetMs, which the orchestrator stamps). additionalProperties:false
# everywhere + every property required (optionals are nullable) is what strict/GBNF decoding needs,
# and it leaves no slot for a hallucinated dataPtr/ptr:// field.
HOVER_JSON_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "entityId": {"type": "string", "minLength": 1, "description": _NO_PTR},
        "entityType": {"type": "string", "enum": _ENTITY_TYPES},
        "status": {"type": "string", "enum": _HEALTH_STATES},
        "headline": {"type": "string", "maxLength": 120, "description": _NO_PTR},
        "errorCodeTranslation": {
            "anyOf": [
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "code": {"type": "string", "description": _NO_PTR},
                        "meaning": {"type": "string", "maxLength": 240},
                        "likelyCause": {"type": "string", "maxLength": 300},
                        "docsUrl": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    },
                    "required": ["code", "meaning", "likelyCause", "docsUrl"],
                },
                {"type": "null"},
            ]
        },
        "facts": {
            "type": "array",
            "maxItems": 8,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "label": {"type": "string", "maxLength": 40},
                    "value": {"type": "string", "maxLength": 200, "description": _NO_PTR},
                    "mono": {"type": "boolean"},
                    "tone": {"anyOf": [{"type": "string", "enum": _HEALTH_STATES}, {"type": "null"}]},
                },
                "required": ["label", "value", "mono", "tone"],
            },
        },
        "quickActions": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "label": {"type": "string", "minLength": 1, "maxLength": 40},
                    "kind": {"type": "string", "enum": _ACTION_KINDS},
                    "description": {"anyOf": [{"type": "string", "maxLength": 200}, {"type": "null"}]},
                    "targetEntityId": {"anyOf": [{"type": "string", "description": _NO_PTR}, {"type": "null"}]},
                    "destructive": {"type": "boolean"},
                },
                "required": ["id", "label", "kind", "description", "targetEntityId", "destructive"],
            },
        },
    },
    "required": ["entityId", "entityType", "status", "headline", "errorCodeTranslation", "facts", "quickActions"],
}

HOVER_RESPONSE_FORMAT: dict = {
    "type": "json_schema",
    "json_schema": {"name": "HoverDiagnostic", "strict": True, "schema": HOVER_JSON_SCHEMA},
}

# Surfaced in the serve() log line (llama-server owns /health, so there is no Python health route to embed it in).
INFERENCE_CONFIG: dict = {
    "grammarConstrained": True,
    "kvCacheQuant": KV_CACHE_QUANT,
    "cacheTypeK": KV_CACHE_QUANT,
    "cacheTypeV": KV_CACHE_QUANT,
    "speculativeDraftMax": DRAFT_MAX,
    "speculativeDraftMin": DRAFT_MIN,
    "speculativeEnabled": bool(DRAFT_MODEL),
    "draftModel": DRAFT_MODEL or None,
    "responseFormatName": "HoverDiagnostic",
    "maxContainers": MAX_CONTAINERS,
}


def build_hover_response_format() -> dict:
    """Fresh copy of the strict response_format for one hover chat call (llama-server turns it into a GBNF grammar)."""
    return copy.deepcopy(HOVER_RESPONSE_FORMAT)


def build_open_weight_hover_payload(model: str, messages: list, max_tokens: int = 3000, temperature: float = 0.0) -> dict:
    """OpenAI-compatible hover chat payload carrying the strict HoverDiagnostic response_format."""
    return {
        "model": model,
        "messages": messages,
        "response_format": build_hover_response_format(),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }


def build_llama_server_cmd(model_path: str, draft_model: str = "", api_key: str = "") -> list[str]:
    """llama-server command: always q8_0 KV cache; --model-draft speculative decoding only when a draft is set."""
    cmd = [
        "/app/llama-server",
        "-m", model_path,
        "-a", SERVED_MODEL_NAME,
        "-ngl", "99",
        "-np", str(SLOTS),
        "-c", str(SLOTS * CONTEXT_PER_SLOT),
        "--jinja",
        "--chat-template-kwargs", f'{{"reasoning_strength":"{REASONING_STRENGTH}"}}',
        "--reasoning-budget", str(REASONING_BUDGET),
        "--temp", "1.0", "--top-p", "0.95", "--top-k", "64",
        "--cache-type-k", KV_CACHE_QUANT,
        "--cache-type-v", KV_CACHE_QUANT,
        "--host", "0.0.0.0",
        "--port", str(PORT),
    ]  # fmt: skip
    draft = (draft_model or "").strip()
    if draft:
        draft_path = draft if draft.startswith("/") else os.path.join(WEIGHTS_DIR, draft)
        cmd += ["--model-draft", draft_path, "--draft-max", str(DRAFT_MAX), "--draft-min", str(DRAFT_MIN)]
    if api_key:
        cmd += ["--api-key", api_key]
    return cmd

image = (
    # Rolling CUDA build of llama-server; the build number is checked at start-up against MIN_LLAMA_BUILD
    modal.Image.from_registry("ghcr.io/ggml-org/llama.cpp:server-cuda", add_python="3.12")
    .entrypoint([])
    # The repo is Xet-backed; hf_xet pulls it in parallel chunks
    .pip_install("huggingface_hub[hf_xet]==0.34.4")
    .env(
        {
            # Bake the deploy-time choices into the container so the module evaluates identically there
            "CTX_GLIMMER_GGUF": GGUF_FILE,
            "CTX_MODEL_OPEN_WEIGHT_GLIMMER": SERVED_MODEL_NAME,
            "CTX_GLIMMER_GPU": GPU,
            "CTX_GLIMMER_REASONING_STRENGTH": REASONING_STRENGTH,
            "CTX_GLIMMER_REASONING_BUDGET": str(REASONING_BUDGET),
            "CTX_GLIMMER_DRAFT_MODEL": DRAFT_MODEL,
            "CTX_GLIMMER_MIN_GGUF_BYTES": str(MIN_GGUF_BYTES),
        }
    )
)

weights = modal.Volume.from_name("contextpane-glimmer-weights", create_if_missing=True)

app = modal.App("contextpane-glimmer", image=image)


def ensure_weights() -> str:
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(HF_REPO, GGUF_FILE, local_dir=WEIGHTS_DIR)
    weights.commit()
    return path


def weights_complete(path: str) -> bool:
    return os.path.exists(path) and os.path.getsize(path) >= MIN_GGUF_BYTES


def require_complete_weights(path: str) -> None:
    size = os.path.getsize(path) if os.path.exists(path) else 0
    if size < MIN_GGUF_BYTES:
        raise RuntimeError(f"{path} is {size:,} bytes, below the {MIN_GGUF_BYTES:,} expected for {GGUF_FILE}; re-run ::download")


def wait_for_health(proc: subprocess.Popen, url: str = HEALTH_URL, timeout_s: float = HEALTH_TIMEOUT_SECONDS) -> float:
    """Polls llama-server's /health until it reports {"status": "ok"}; it answers 503 while the GGUF loads."""
    import requests  # installed with huggingface_hub

    started = time.monotonic()
    while time.monotonic() - started < timeout_s:
        if proc.poll() is not None:
            raise RuntimeError(f"llama-server exited with code {proc.returncode} before /health reported ok")
        try:
            if requests.get(url, timeout=5).json().get("status") == "ok":
                return time.monotonic() - started
        except (requests.RequestException, ValueError):
            pass  # port not open yet, or a non-JSON reply during start-up
        time.sleep(HEALTH_POLL_SECONDS)
    proc.kill()
    raise RuntimeError(f"llama-server /health did not report ok within {timeout_s:.0f} s")


@app.function(volumes={WEIGHTS_DIR: weights}, timeout=60 * 60)
def download() -> str:
    """`modal run modal-sandbox/glimmer_open_weights.py::download` — pulls the 16.8 GB GGUF once."""
    path = ensure_weights()
    require_complete_weights(path)
    print(f"{path}: {os.path.getsize(path) / 1e9:.1f} GB")
    return path


def llama_build() -> int:
    proc = subprocess.run(["/app/llama-server", "--version"], capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    # "version: 0.7.0-dev (build 11889, commit ...)" on current builds, "version: 6123 (...)" on older ones
    match = re.search(r"\(build (\d+)", out) or re.search(r"version:\s*b?(\d+)\b(?!\.)", out)
    return int(match.group(1)) if match else 0


@app.cls(
    gpu=GPU,
    timeout=60 * 60,
    scaledown_window=SCALEDOWN_SECONDS,
    max_containers=MAX_CONTAINERS,
    volumes={WEIGHTS_DIR: weights},
    secrets=[modal.Secret.from_name("contextpane-open-weights")],
)
@modal.concurrent(max_inputs=SLOTS)
class Glimmer:
    @modal.web_server(port=PORT, startup_timeout=15 * 60, label="contextpane-glimmer-serve")
    def serve(self):
        """Scale-to-zero OpenAI-compatible server: /v1/chat/completions, /v1/models, /health."""
        build = llama_build()
        if build < MIN_LLAMA_BUILD:
            raise RuntimeError(f"llama.cpp build b{build} predates Muse Glimmer support (needs b{MIN_LLAMA_BUILD}+)")
        model_path = os.path.join(WEIGHTS_DIR, GGUF_FILE)
        if not weights_complete(model_path):
            model_path = ensure_weights()
        require_complete_weights(model_path)
        cmd = build_llama_server_cmd(model_path, draft_model=DRAFT_MODEL, api_key=os.environ.get("CTX_OPEN_WEIGHT_API_KEY", ""))
        print(f"llama.cpp b{build}: loading {model_path} inference={json.dumps(INFERENCE_CONFIG)}")
        proc = subprocess.Popen(cmd)
        # Modal routes traffic once the port opens, but llama-server opens it before the model is loaded.
        # Returning only after /health is ok keeps requests off the container until it can answer them.
        print(f"llama-server ready: /health ok after {wait_for_health(proc):.1f} s")
