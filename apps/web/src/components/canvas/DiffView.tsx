/**
 * Renders a unified diff with semantic line colouring: full-bleed on `bg-ground`, hairlines top and
 * bottom only (no box). `edges` picks which hairlines to draw when the parent already has one.
 */
export function DiffView({
  diff,
  maxHeight = "max-h-96",
  wrap = false,
  className = "",
  edges = "y",
}: {
  diff: string;
  maxHeight?: string;
  wrap?: boolean;
  className?: string;
  edges?: "y" | "b" | "none";
}) {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const edge = edges === "y" ? "border-y border-hairline" : edges === "b" ? "border-b border-hairline" : "";
  return (
    <pre className={`overflow-auto bg-ground py-1 font-mono text-11 leading-[1.55] ${edge} ${maxHeight} ${className}`}>
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
          <div key={i} className={`${cls} px-3 ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
