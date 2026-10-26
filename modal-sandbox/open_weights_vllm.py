"""
Optional: Meta's open-weight muse-glimmer-30b on Modal, behind an OpenAI-compatible vLLM server
(full-precision safetensors on an H100). glimmer_open_weights.py serves the 16.8 GB GGUF on an L40S
with llama-server instead, which is the cheaper default (scripts/Start-GlimmerOpenWeights.ps1).

The orchestrator treats this as the first choice for Tier 1A (hover) and Tier 1B (catalog hydration)
when MODAL_INFERENCE_BASE_URL / CTX_OPEN_WEIGHT_BASE_URL points at it, and falls through to the
Meta Model API when it is cold, down or slow. The container scales to zero after SCALEDOWN_SECONDS.

Forced tool calls (`tool_choice: {"type": "function", ...}`) work out of the box: vLLM enforces a
named function with guided decoding, so no tool-call parser is needed for hydrate_contextpane_layout.

Deploy:
    modal secret create contextpane-open-weights HF_TOKEN=<hf-token> CTX_OPEN_WEIGHT_API_KEY=<random-token>
    modal deploy modal-sandbox/open_weights_vllm.py

Modal prints https://<workspace>--contextpane-open-weights-serve.modal.run; wire it in with
    pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalInferenceUrl https://<workspace>--contextpane-open-weights-serve.modal.run/v1 -OpenWeightApiKey <token>
"""

from __future__ import annotations

import os
import subprocess

import modal

# Hugging Face repo of the open weights; set CTX_GLIMMER_HF_REPO at deploy time to the published repo id
MODEL_REPO = os.environ.get("CTX_GLIMMER_HF_REPO", "meta-models/Muse-Glimmer-30B")
# Name the orchestrator sends as `model` (CTX_MODEL_OPEN_WEIGHT_GLIMMER)
SERVED_MODEL_NAME = os.environ.get("CTX_MODEL_OPEN_WEIGHT_GLIMMER", "muse-glimmer-30b")
GPU = os.environ.get("CTX_GLIMMER_GPU", "H100")
MAX_MODEL_LEN = int(os.environ.get("CTX_GLIMMER_MAX_MODEL_LEN", "32768"))
SCALEDOWN_SECONDS = 300
VLLM_PORT = 8000

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("vllm==0.10.1.1", "huggingface_hub[hf_transfer]==0.34.4")
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            # Bake the deploy-time choices into the container so the module evaluates identically there
            "CTX_GLIMMER_HF_REPO": MODEL_REPO,
            "CTX_MODEL_OPEN_WEIGHT_GLIMMER": SERVED_MODEL_NAME,
            "CTX_GLIMMER_GPU": GPU,
            "CTX_GLIMMER_MAX_MODEL_LEN": str(MAX_MODEL_LEN),
        }
    )
)

hf_cache = modal.Volume.from_name("contextpane-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("contextpane-vllm-cache", create_if_missing=True)

app = modal.App("contextpane-open-weights", image=image)


@app.function(
    gpu=GPU,
    timeout=60 * 60,
    scaledown_window=SCALEDOWN_SECONDS,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[modal.Secret.from_name("contextpane-open-weights")],
)
@modal.concurrent(max_inputs=32)
@modal.web_server(port=VLLM_PORT, startup_timeout=20 * 60)
def serve():
    """Scale-to-zero OpenAI-compatible server: /v1/chat/completions, /v1/models."""
    cmd = [
        "vllm",
        "serve",
        MODEL_REPO,
        "--served-model-name",
        SERVED_MODEL_NAME,
        "--host",
        "0.0.0.0",
        "--port",
        str(VLLM_PORT),
        "--max-model-len",
        str(MAX_MODEL_LEN),
        "--uvicorn-log-level",
        "info",
    ]
    api_key = os.environ.get("CTX_OPEN_WEIGHT_API_KEY", "")
    if api_key:
        cmd += ["--api-key", api_key]
    subprocess.Popen(cmd)
