/**
 * Line provenance for JSON baselines: a small position-tracking JSON parser, so a
 * drifted Conditional Access or Intune setting can name the exact lines of the
 * golden file that declare it (golden-tenant/.../CA-001.json:L7-L9). HCL blocks are
 * located by mcp-azure-iac's own reader.
 */

export interface LineRange {
  startLine: number;
  endLine: number;
}

interface JsonNode {
  start: number;
  end: number;
  /** Object members (with the offset of the key) or array items. */
  members?: Map<string, { keyStart: number; value: JsonNode }>;
  items?: JsonNode[];
}

function parseJson(text: string): JsonNode {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const fail = (what: string): never => {
    throw new Error(`JSON locator: ${what} at offset ${i}`);
  };
  const string = (): string => {
    if (text[i] !== '"') fail("expected string");
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): JsonNode => {
    ws();
    const start = i;
    const ch = text[i];
    if (ch === "{") {
      i++;
      const members = new Map<string, { keyStart: number; value: JsonNode }>();
      ws();
      if (text[i] === "}") return { start, end: ++i, members };
      for (;;) {
        ws();
        const keyStart = i;
        const key = string();
        ws();
        if (text[i++] !== ":") fail("expected ':'");
        members.set(key, { keyStart, value: value() });
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return { start, end: ++i, members };
        else fail("expected ',' or '}'");
      }
    }
    if (ch === "[") {
      i++;
      const items: JsonNode[] = [];
      ws();
      if (text[i] === "]") return { start, end: ++i, items };
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return { start, end: ++i, items };
        else fail("expected ',' or ']'");
      }
    }
    if (ch === '"') {
      string();
      return { start, end: i };
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) fail("unexpected token");
    i += m![0].length;
    return { start, end: i };
  };
  const root = value();
  ws();
  if (i < text.length) fail("trailing content");
  return root;
}

const lineOf = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/**
 * Lines of the member at `path` (keys, or array indexes as numbers), from its key to the
 * end of its value. An empty path is the whole document. Null when the path is absent.
 */
export function locateJsonPath(text: string, path: Array<string | number>): LineRange | null {
  let node = parseJson(text);
  let from = node.start;
  for (const segment of path) {
    if (typeof segment === "number") {
      const item = node.items?.[segment];
      if (!item) return null;
      node = item;
      from = item.start;
    } else {
      const member = node.members?.get(segment);
      if (!member) return null;
      node = member.value;
      from = member.keyStart;
    }
  }
  return { startLine: lineOf(text, from), endLine: lineOf(text, node.end) };
}

/** Lines of a character span, for readers (like the HCL one) that track offsets. */
export function lineRangeOfSpan(text: string, start: number, end: number): LineRange {
  return { startLine: lineOf(text, start), endLine: lineOf(text, Math.max(start, end - 1)) };
}
