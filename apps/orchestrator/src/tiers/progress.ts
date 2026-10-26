/** Progress events streamed over SSE while a tier runs. */
export interface ProgressEvent {
  stage: string;
  message: string;
  at: string;
  elapsedMs: number;
  data?: Record<string, unknown>;
}

export type ProgressSink = (event: ProgressEvent) => void;

export function progressReporter(sink?: ProgressSink) {
  const started = performance.now();
  return (stage: string, message: string, data?: Record<string, unknown>) => {
    const event: ProgressEvent = {
      stage,
      message,
      at: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started),
      ...(data ? { data } : {}),
    };
    sink?.(event);
    return event;
  };
}
