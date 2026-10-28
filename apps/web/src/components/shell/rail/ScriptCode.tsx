import type { ReactNode } from "react";
import { CodeBlock } from "../../ui/CodeBlock";

/**
 * Full-bleed code in the rail: a 36px name row (the CodeBlock wrap / copy toolbar floats on its right)
 * over a `bg-ground` block with hairlines top and bottom only. Wrapping is on by default, so nothing
 * scrolls sideways at 440px; with wrap off the block scrolls inside itself.
 */
export function ScriptCode({
  code,
  name,
  render,
  maxHeight = "",
}: {
  code: string;
  name: ReactNode;
  /** Custom body renderer (the coloured DiffView); receives the wrap state. */
  render?: (wrap: boolean) => ReactNode;
  maxHeight?: string;
}) {
  return (
    <CodeBlock
      code={code}
      label="Copy"
      render={(wrap) => (
        <>
          <div className="flex h-9 items-center border-y border-hairline bg-surface pr-36 pl-3 font-mono text-11 text-faint">
            <span className="min-w-0 truncate">{name}</span>
          </div>
          {render ? (
            render(wrap)
          ) : (
            <pre
              className={`overflow-auto border-b border-hairline bg-ground px-3 py-2 font-mono text-11 leading-[1.55] text-text ${maxHeight} ${
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
              }`}
            >
              {code}
            </pre>
          )}
        </>
      )}
    />
  );
}
