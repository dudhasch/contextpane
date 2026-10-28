import type { ReactNode } from "react";
import { CodeBlock } from "../../ui/CodeBlock";

/** WP10-B: the bounded-module frame every rail block shares (prover strip, summary box, code viewer). */
export const RAIL_FRAME = "rounded-md border border-hairline";
/**
 * Inset of a framed block in the rail's scroll body: 10px on the left; on the right the body keeps a
 * stable 10px scrollbar gutter, so every frame ends 10px from the rail edge like the prover strip.
 */
export const RAIL_INSET = "ml-2.5";
/** Inset of a framed block outside the scroll body (the prover strip). */
export const RAIL_INSET_X = "mx-2.5";

/**
 * Framed code in the rail: a 36px name row (the CodeBlock wrap / copy toolbar floats on its right)
 * over a `bg-ground` block, inside one `rounded-md` hairline box inset 10px from the rail edges.
 * Wrapping is on by default, so nothing scrolls sideways at 440px; with wrap off the block scrolls
 * inside itself.
 */
export function ScriptCode({
  code,
  name,
  render,
  maxHeight = "",
  inset = RAIL_INSET,
}: {
  code: string;
  name: ReactNode;
  /** Custom body renderer (the coloured DiffView); receives the wrap state. */
  render?: (wrap: boolean) => ReactNode;
  maxHeight?: string;
  /** Horizontal inset of the frame; a frame nested in another frame passes its own. */
  inset?: string;
}) {
  return (
    <CodeBlock
      code={code}
      label="Copy"
      className={`${inset} min-w-0 overflow-hidden ${RAIL_FRAME} bg-ground`}
      render={(wrap) => (
        <div data-rail-frame="code">
          <div className="flex h-9 items-center border-b border-hairline bg-surface pr-36 pl-3 font-mono text-11 text-faint">
            <span className="min-w-0 truncate">{name}</span>
          </div>
          {render ? (
            render(wrap)
          ) : (
            <pre
              className={`overflow-auto bg-ground px-3 py-2 font-mono text-11 leading-[1.55] text-text ${maxHeight} ${
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
              }`}
            >
              {code}
            </pre>
          )}
        </div>
      )}
    />
  );
}
