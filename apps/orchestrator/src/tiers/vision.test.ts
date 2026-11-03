import { describe, expect, test } from "bun:test";
import { config } from "../config.ts";
import { VISION_BLOCKED, visionExtract } from "./vision.ts";

describe("Tier 2 · Vision is opt-in", () => {
  test("without CTX_VISION_SEND_IMAGES the screenshot never leaves the orchestrator, and telemetry says why", async () => {
    expect(config.visionSendImages).toBe(false);
    const result = await visionExtract({ tenantId: "tenant-contoso-01", ticketId: "INC-4092", imageDataUri: "data:image/png;base64,AAAA" });
    expect(result.extraction).toBeNull();
    expect(result.error).toBe(VISION_BLOCKED);
    expect(result.telemetry.provider).toBe("local");
    expect(result.telemetry.fallbackChain[0]).toMatchObject({ outcome: "skipped", error: VISION_BLOCKED });
  });
});
