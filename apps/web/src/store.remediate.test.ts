import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ActionApprovalDrawer } from "@contextpane/catalog";
import { AUTO_STAGE, useWorkbench } from "./store";

/** One controllable SSE response for `/api/remediate?stream=1`. */
function sseStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    progress: (stage: string, data?: Record<string, unknown>) => send("progress", { stage, message: stage, at: "", elapsedMs: 0, ...(data ? { data } : {}) }),
    result: (drawer: ActionApprovalDrawer) => {
      send("result", { drawer });
      controller.close();
    },
    fail: (error: string) => {
      send("error", { error });
      controller.close();
    },
  };
}

function drawerFor(ticketId: string): ActionApprovalDrawer {
  return {
    remediationId: `rem-${ticketId}`,
    ticketId,
    tenantId: "tenant-contoso-01",
    title: `Remediate ${ticketId}`,
    summary: "test bundle",
    synthesizedBy: { planner: "test", coder: "test", provider: "local" },
    powershellScript: `# ${ticketId}\nSet-MgUserLicense -UserId x`,
    terraformDiff: "",
    graphPatch: "",
    affectedEntities: [],
    verificationStatus: {
      verdict: "Verified Safe",
      astCheckPassed: true,
      terraformFmtPassed: null,
      terraformValidatePassed: null,
      sandboxProvider: "none",
      validationLatencyMs: 1,
      findings: [],
      whatIfSafe: true,
    },
    staging: null,
    approval: { state: "pending", mode: null, requiredIdentity: "admin@test", approvedBy: null, approvedAt: null },
    providerTelemetry: { tier: "Tier 3B", provider: "local", modelId: "test", latencyMs: 1, tokensUsed: 0 },
  } as ActionApprovalDrawer;
}

const realFetch = globalThis.fetch;
let remediateStreams: Array<ReturnType<typeof sseStream>> = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** What `selectScenario` resets before it loads another ticket (without its network calls). */
function switchTo(scenarioId: "INC-4092" | "INC-4099") {
  useWorkbench.setState({ scenarioId, drawer: null, codeRailMode: "idle", remediateStatus: "idle", remediateProgress: [], railStream: null });
}

beforeEach(() => {
  remediateStreams = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/remediate")) {
      const stream = sseStream();
      remediateStreams.push(stream);
      return stream.response;
    }
    // Drawer extras and anything else: unreachable, which the store already tolerates.
    return new Response(JSON.stringify({ error: "not in this test" }), { status: 503 });
  }) as typeof fetch;
  useWorkbench.setState({
    freeRoamOpen: false,
    autoStageRemediation: true,
    scenarioId: "INC-4092",
    drawer: null,
    codeRailMode: "idle",
    convergence: {},
    remediateStatus: "idle",
    remediateProgress: [],
    railStream: null,
    briefStatus: "ready",
    canvasStatus: "ready",
    refiningGoal: false,
    speculativeBuffer: [],
    toasts: [],
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("remediate() scenario guard (WP10-B)", () => {
  test("AUTO_STAGE is on by default", () => {
    expect(AUTO_STAGE).toBe(true);
  });

  test("a bundle for the ticket on screen lands in the rail", async () => {
    const run = useWorkbench.getState().remediate();
    await flush();
    expect(useWorkbench.getState().remediateStatus).toBe("loading");
    remediateStreams[0]!.result(drawerFor("INC-4092"));
    await run;
    const s = useWorkbench.getState();
    expect(s.drawer?.ticketId).toBe("INC-4092");
    expect(s.remediateStatus).toBe("ready");
  });

  test("a bundle that finishes after the operator switched tickets never lands in the new ticket's rail", async () => {
    const run = useWorkbench.getState().remediate();
    await flush();
    switchTo("INC-4099");
    remediateStreams[0]!.progress("bundle:ready", { powershellScript: "# INC-4092 partial" });
    await flush();
    expect(useWorkbench.getState().railStream).toBeNull();
    remediateStreams[0]!.result(drawerFor("INC-4092"));
    await run;
    const s = useWorkbench.getState();
    expect(s.scenarioId).toBe("INC-4099");
    expect(s.drawer).toBeNull();
    expect(s.remediateStatus).toBe("idle");
    expect(s.remediateProgress).toHaveLength(0);
  });

  test("the stale run does not overwrite the newer run for the new ticket", async () => {
    const first = useWorkbench.getState().remediate();
    await flush();
    switchTo("INC-4099");
    const second = useWorkbench.getState().remediate();
    await flush();
    remediateStreams[0]!.result(drawerFor("INC-4092"));
    await first;
    expect(useWorkbench.getState().drawer).toBeNull();
    expect(useWorkbench.getState().remediateStatus).toBe("loading");
    remediateStreams[1]!.result(drawerFor("INC-4099"));
    await second;
    expect(useWorkbench.getState().drawer?.ticketId).toBe("INC-4099");
    expect(useWorkbench.getState().remediateStatus).toBe("ready");
  });

  test("a stale run that fails stays silent and leaves the new ticket alone", async () => {
    const run = useWorkbench.getState().remediate();
    await flush();
    switchTo("INC-4099");
    remediateStreams[0]!.fail("coder timeout");
    await run;
    const s = useWorkbench.getState();
    expect(s.remediateStatus).toBe("idle");
    expect(s.toasts.some((t) => t.title === "Remediation failed")).toBe(false);
  });

  test("a run interrupted by Free-Roam lets go of the loading state", async () => {
    const run = useWorkbench.getState().remediate();
    await flush();
    useWorkbench.setState({ freeRoamOpen: true });
    remediateStreams[0]!.result(drawerFor("INC-4092"));
    await run;
    const s = useWorkbench.getState();
    expect(s.drawer).toBeNull();
    expect(s.remediateStatus).toBe("idle");
  });
});

describe("autoStage() rules (WP10-B)", () => {
  test("stages the primary fix and opens the rail on PowerShell", async () => {
    useWorkbench.setState({ codeRailOpen: false, codeRailTab: "graph" });
    useWorkbench.getState().autoStage("INC-4092");
    await flush();
    const s = useWorkbench.getState();
    expect(s.codeRailOpen).toBe(true);
    expect(s.codeRailMode).toBe("staging");
    expect(s.codeRailTab).toBe("powershell");
    expect(s.remediateStatus).toBe("loading");
    expect(remediateStreams).toHaveLength(1);
    remediateStreams[0]!.result(drawerFor("INC-4092"));
    await flush();
  });

  test("never in Free-Roam, for another ticket, with the flag off, or while a bundle is in flight", () => {
    useWorkbench.setState({ freeRoamOpen: true });
    useWorkbench.getState().autoStage("INC-4092");
    useWorkbench.setState({ freeRoamOpen: false });
    useWorkbench.getState().autoStage("INC-4099");
    useWorkbench.setState({ autoStageRemediation: false });
    useWorkbench.getState().autoStage("INC-4092");
    useWorkbench.setState({ autoStageRemediation: true, remediateStatus: "loading" });
    useWorkbench.getState().autoStage("INC-4092");
    expect(remediateStreams).toHaveLength(0);
  });

  test("no-op when a pending bundle for the ticket is already staged", () => {
    useWorkbench.setState({ drawer: drawerFor("INC-4092"), remediateStatus: "ready" });
    useWorkbench.getState().autoStage("INC-4092");
    expect(remediateStreams).toHaveLength(0);
  });

  test("silent on a resolved ticket: no remediate, no warning toast", () => {
    useWorkbench.setState({ convergence: { "INC-4092": { remediationId: "rem-x" } as never } });
    useWorkbench.getState().autoStage("INC-4092");
    expect(remediateStreams).toHaveLength(0);
    expect(useWorkbench.getState().toasts).toHaveLength(0);
    expect(useWorkbench.getState().codeRailMode).toBe("idle");
  });
});
