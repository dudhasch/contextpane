import { z } from "zod";
import { LayoutComponentSchema, type LayoutComponent } from "./schemas/layout.ts";

export interface ComponentValidationResult {
  valid: LayoutComponent[];
  rejected: Array<{ index: number; type: string | undefined; id: string | undefined; issues: string[] }>;
}

/**
 * Validate an untrusted array of components one by one. Valid components are
 * kept; invalid ones are reported so the deterministic hydrator can repair the
 * layout instead of failing the whole response.
 */
export function validateComponents(input: unknown): ComponentValidationResult {
  const result: ComponentValidationResult = { valid: [], rejected: [] };
  if (!Array.isArray(input)) {
    result.rejected.push({ index: -1, type: undefined, id: undefined, issues: ["components is not an array"] });
    return result;
  }
  input.forEach((candidate, index) => {
    const parsed = LayoutComponentSchema.safeParse(candidate);
    if (parsed.success) {
      result.valid.push(parsed.data);
    } else {
      const c = (candidate ?? {}) as { type?: unknown; id?: unknown };
      result.rejected.push({
        index,
        type: typeof c.type === "string" ? c.type : undefined,
        id: typeof c.id === "string" ? c.id : undefined,
        issues: formatIssues(parsed.error),
      });
    }
  });
  return result;
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Parse the arguments string of a function tool call. Models occasionally wrap
 * JSON in fences or emit trailing commentary; this tolerates both.
 */
export function parseToolArguments(raw: string | null | undefined): unknown {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
