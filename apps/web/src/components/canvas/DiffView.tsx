/** Renders a unified diff with semantic line colouring. */
export function DiffView({ diff, maxHeight = "max-h-96" }: { diff: string; maxHeight?: string }) {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  return (
    <pre className={`overflow-auto rounded-md border border-border-subtle bg-canvas p-2 font-mono text-[11px] leading-[1.55] ${maxHeight}`}>
      {lines.map((line, i) => {
        const cls = line.startsWith("+++") || line.startsWith("---")
          ? "diff-line-meta"
          : line.startsWith("@@")
            ? "diff-line-hunk"
            : line.startsWith("+")
              ? "diff-line-add"
              : line.startsWith("-")
                ? "diff-line-del"
                : "text-muted";
        return (
          <div key={i} className={`${cls} px-1 whitespace-pre`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
