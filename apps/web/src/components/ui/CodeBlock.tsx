import { Check, Copy, WrapText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useWorkbench } from "@/store";

interface CodeBlockProps {
  /** Raw text that [Copy Code] puts on the clipboard. */
  code: string;
  /** Optional custom renderer (e.g. the coloured DiffView); receives the current wrap state. */
  render?: (wrap: boolean) => ReactNode;
  className?: string;
  maxHeight?: string;
  label?: string;
  /** Hide the built-in copy button when the parent container provides its own copy action. */
  hideCopy?: boolean;
  /** Hide the entire floating toolbar when the parent renders a dedicated header bar. */
  hideToolbar?: boolean;
}

/**
 * Code container with a [Copy Code] button and a line-wrap toggle in the
 * top-right corner, so long PowerShell / HCL never needs horizontal scrolling
 * while recording.
 */
export function CodeBlock({ code, render, className = "", maxHeight = "", label = "Copy Code", hideCopy = false, hideToolbar = false }: CodeBlockProps) {
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const toast = useWorkbench((s) => s.toast);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      toast({ tone: "warning", title: "Clipboard unavailable", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className={`relative ${className}`}>
      {!hideToolbar && (
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            aria-pressed={wrap}
            title={wrap ? "Disable line wrapping" : "Wrap long lines"}
            className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10.5px] transition-colors ${wrap ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-elevated text-muted hover:text-text"}`}
          >
            <WrapText className="size-3" />
            wrap
          </button>
          {!hideCopy && (
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy to clipboard"
              className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10.5px] transition-colors ${copied ? "border-healthy/40 bg-healthy/15 text-healthy" : "border-border bg-elevated text-muted hover:text-text"}`}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : label}
            </button>
          )}
        </div>
      )}
      {render ? (
        render(wrap)
      ) : (
        <pre className={`overflow-auto rounded-md border border-border-subtle bg-canvas p-3 ${hideToolbar ? "" : "pt-8"} ${maxHeight} font-mono text-[11px] leading-[1.55] text-text ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>{code}</pre>
      )}
    </div>
  );
}
