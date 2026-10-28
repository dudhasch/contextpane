export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-hairline bg-surface px-1 font-mono text-11 text-muted">
      {children}
    </kbd>
  );
}
