#Requires -Version 7.0
# Launches a RunPod GPU pod running vLLM's OpenAI-compatible server for open-weight muse-glimmer-30b (needs `runpodctl config --apiKey` once, and $env:HF_TOKEN).
param([string]$HfRepo = 'meta-models/Muse-Glimmer-30B', [string]$GpuType = 'NVIDIA H100 80GB HBM3', [string]$ApiKey = $env:CTX_OPEN_WEIGHT_API_KEY)
$pod = runpodctl create pod --name contextpane-glimmer --gpuType $GpuType --imageName 'vllm/vllm-openai:v0.10.1.1' --containerDiskSize 120 --ports '8000/http' --env "HUGGING_FACE_HUB_TOKEN=$env:HF_TOKEN" --args "--model $HfRepo --served-model-name muse-glimmer-30b --max-model-len 32768$(if ($ApiKey) { " --api-key $ApiKey" })"
$podId = ([regex]::Match("$pod", 'pod "([^"]+)"').Groups[1].Value)
Write-Host "Pod: $pod`nWhen vLLM is up: pwsh ./scripts/Set-ContextPaneRouterConfig.ps1 -RunPodBaseUrl https://$podId-8000.proxy.runpod.net/v1$(if ($ApiKey) { ' -OpenWeightApiKey <token>' })"
