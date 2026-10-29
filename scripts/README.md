# scripts/

PowerShell 7 and Bun scripts for setting up, seeding, verifying and publishing ContextPane. Run them from the repository root with `pwsh -NoProfile -File ./scripts/<name>.ps1`.

| Script | Purpose |
|---|---|
| [`Install-ContextPaneModules.ps1`](Install-ContextPaneModules.ps1) | Installs the Az and Microsoft.Graph submodules through [ModuleFast](https://github.com/JustinGrote/ModuleFast) (bootstrap validated before use; falls back to `Install-PSResource`) |
| [`Connect-ContextPaneGraph.ps1`](Connect-ContextPaneGraph.ps1) | One-time delegated Microsoft Graph sign-in with the CA and Intune write scopes (`-DeviceCode` supported), persisted to `~/.mg` for silent token minting |
| [`Invoke-SeedContextPaneLab.ps1`](Invoke-SeedContextPaneLab.ps1) | Idempotently seeds the demo lab into a real tenant: users with the license extension, groups, CA policies scoped to demo groups only, Intune policies, a resource group with a deliberately drifted NSG. It also rewrites `demo-iac/demo-lab-manifest.json`. **Review before running; it writes to a tenant** |
| [`Remove-ContextPaneLab.ps1`](Remove-ContextPaneLab.ps1) | Tears the seeded lab down |
| [`Set-ContextPaneRouterConfig.ps1`](Set-ContextPaneRouterConfig.ps1) | Writes provider keys, model ids, Modal URLs and cloud mode to the git-ignored `.env.local` |
| [`Start-GlimmerOpenWeights.ps1`](Start-GlimmerOpenWeights.ps1) | `-Target Modal` deploys Muse Glimmer 30B to Modal (secret, Volume pull, deploy, `.env.local`); `-Target Local` runs llama-server locally |
| [`Start-RunPodGlimmer.ps1`](Start-RunPodGlimmer.ps1) | Alternative: a vLLM pod on RunPod (H100) via `runpodctl` |
| [`New-RandomErpTicketDrop.ps1`](New-RandomErpTicketDrop.ps1) | Drops a randomised ticket folder into `input/tickets/` for the ERP inbox |
| [`New-ContextPaneVoiceFixture.ps1`](New-ContextPaneVoiceFixture.ps1) | Generates a voice-steer WAV with Windows TTS, optionally POSTs it to `/api/voice-steer` |
| [`Test-ContextPaneSmoke.ps1`](Test-ContextPaneSmoke.ps1) | Smoke test of every tier endpoint, its latency and its Zod schema (`-ScenarioId`, `-Mode break-glass\|gitops`); `bun run smoke` runs it |
| [`Publish-ContextPaneRepo.ps1`](Publish-ContextPaneRepo.ps1) | The one-time GitHub publish used at kickoff (audit + `gh repo create`); `ConfirmImpact=High` |
| [`capture-readme-screenshots.ts`](capture-readme-screenshots.ts) | Headless Edge/Chrome over DevTools: repeatable README captures from the running stack |

**Smoke test caveat.** Five of the 53 smoke checks predate the standalone custom-ticket change: they still expect custom tickets to inherit a base scenario, and the pointer query check URL-decodes the pointer. A run whose only failures are those five is a pass.
