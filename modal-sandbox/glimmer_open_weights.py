"""
Meta's open-weight Muse Glimmer 30B (GGUF, Q4_K_M) on a Modal GPU behind llama.cpp's llama-server.

Muse Glimmer is self- or partner-hosted, not served on api.meta.ai. This app serves
meta-models/Muse-Glimmer-30B-GGUF (Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf, 16.8 GB, fits 24 GB VRAM)
on one L40S with an OpenAI-compatible /v1/chat/completions, and scales to zero after SCALEDOWN_SECONDS.
The orchestrator calls it first for Tier 1A hovers and Tier 1B catalog hydration and logs
provider "modal-open-weights"; a local llama-server (scripts/Start-GlimmerOpenWeights.ps1 -Local)
logs "local-glimmer-30b".

Model-card facts this follows (huggingface.co/meta-models/Muse-Glimmer-30B-GGUF):
  * llama.cpp build b10353 or newer; older builds do not register the muse-glimmer architecture
  * --jinja is required (the chat template is embedded in the GGUF)
  * reasoning cannot be switched off; --chat-template-kwargs reasoning_strength (low..xhigh) sets how
    much, --reasoning-budget caps it. Hovers want "low" and a small budget.
  * -c is split across -np slots

Deploy (one-off download of the weights into a Modal Volume, then the server):
    modal secret create contextpane-open-weights CTX_OPEN_WEIGHT_API_KEY=<random-token>
    uvx modal run modal-sandbox/glimmer_open_weights.py::download
    uvx modal deploy modal-sandbox/glimmer_open_weights.py

Modal prints https://<workspace>--contextpane-glimmer-serve.modal.run; wire it in with
    pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -ModalInferenceUrl https://<workspace>--contextpane-glimmer-serve.modal.run/v1 -OpenWeightApiKey <token>
"""

from __future__ import annotations

import os
import re
import subprocess

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
SCALEDOWN_SECONDS = 300
PORT = 8080
WEIGHTS_DIR = "/weights"

image = (
    # Rolling CUDA build of llama-server; the build number is checked at start-up against MIN_LLAMA_BUILD
    modal.Image.from_registry("ghcr.io/ggml-org/llama.cpp:server-cuda", add_python="3.12")
    .entrypoint([])
    .pip_install("huggingface_hub[hf_transfer]==0.34.4")
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            # Bake the deploy-time choices into the container so the module evaluates identically there
            "CTX_GLIMMER_GGUF": GGUF_FILE,
            "CTX_MODEL_OPEN_WEIGHT_GLIMMER": SERVED_MODEL_NAME,
            "CTX_GLIMMER_GPU": GPU,
            "CTX_GLIMMER_REASONING_STRENGTH": REASONING_STRENGTH,
            "CTX_GLIMMER_REASONING_BUDGET": str(REASONING_BUDGET),
        }
    )
)

weights = modal.Volume.from_name("contextpane-glimmer-gguf", create_if_missing=True)

app = modal.App("contextpane-glimmer", image=image)


def ensure_weights() -> str:
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(HF_REPO, GGUF_FILE, local_dir=WEIGHTS_DIR)
    weights.commit()
    return path


@app.function(volumes={WEIGHTS_DIR: weights}, timeout=60 * 60)
def download() -> str:
    """`modal run modal-sandbox/glimmer_open_weights.py::download` — pulls the 16.8 GB GGUF once."""
    path = ensure_weights()
    print(f"{path}: {os.path.getsize(path) / 1e9:.1f} GB")
    return path


def llama_build() -> int:
    proc = subprocess.run(["/app/llama-server", "--version"], capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    match = re.search(r"version:\s*(\d+)", out)
    return int(match.group(1)) if match else 0


@app.function(
    gpu=GPU,
    timeout=60 * 60,
    scaledown_window=SCALEDOWN_SECONDS,
    volumes={WEIGHTS_DIR: weights},
    secrets=[modal.Secret.from_name("contextpane-open-weights")],
)
@modal.concurrent(max_inputs=SLOTS)
@modal.web_server(port=PORT, startup_timeout=15 * 60)
def serve():
    """Scale-to-zero OpenAI-compatible server: /v1/chat/completions, /v1/models, /health."""
    build = llama_build()
    if build < MIN_LLAMA_BUILD:
        raise RuntimeError(f"llama.cpp build b{build} predates Muse Glimmer support (needs b{MIN_LLAMA_BUILD}+)")
    model_path = os.path.join(WEIGHTS_DIR, GGUF_FILE)
    if not os.path.exists(model_path):
        model_path = ensure_weights()
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
        "--host", "0.0.0.0",
        "--port", str(PORT),
    ]  # fmt: skip
    api_key = os.environ.get("CTX_OPEN_WEIGHT_API_KEY", "")
    if api_key:
        cmd += ["--api-key", api_key]
    subprocess.Popen(cmd)
