import { Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toWav16k } from "@/lib/wav";
import { useWorkbench } from "@/store";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";

const EXAMPLES = ["only show license drift and the sign-in timeline", "switch to Fabrikam", "pin this view as Month-End Triage", "generate the fix", "show everything"];

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Voice Steer panel. Records audio via MediaRecorder (sent as base64 to
 * /api/voice-steer for muse-voice-transcribe) and, in parallel, uses the
 * browser's SpeechRecognition as the text fallback so the beat works offline.
 */
export function VoiceSteerPanel() {
  const open = useWorkbench((s) => s.voiceOpen);
  const setOpen = useWorkbench((s) => s.setVoiceOpen);
  const voiceSteer = useWorkbench((s) => s.voiceSteer);
  const last = useWorkbench((s) => s.lastVoice);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoCloseRef = useRef<number | undefined>(undefined);

  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      window.clearTimeout(autoCloseRef.current);
      inputRef.current?.focus();
    } else stopRecording(false);
    return () => window.clearTimeout(autoCloseRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      const el = target instanceof Element ? target : target.parentElement;
      if (el?.closest('[aria-label="Voice Steer"]')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const submit = async (command: string, audio?: { base64: string; mimeType: string }) => {
    if (!command.trim() && !audio) return;
    setBusy(true);
    try {
      await voiceSteer({ ...(command.trim() ? { text: command.trim() } : {}), ...(audio ? { audioBase64: audio.base64, mimeType: audio.mimeType } : {}) });
      setText("");
      setLiveTranscript("");
      // collapse 600 ms after the command landed so the panel never hides the top-right of the canvas during recording
      window.clearTimeout(autoCloseRef.current);
      autoCloseRef.current = window.setTimeout(() => useWorkbench.getState().setVoiceOpen(false), 600);
    } catch (error) {
      useWorkbench.getState().toast({ tone: "critical", title: "Voice steer failed", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    let heard = "";
    const Recognition = getSpeechRecognition();
    if (Recognition) {
      const rec = new Recognition();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        heard = Array.from({ length: e.results.length }, (_, i) => e.results[i]?.[0]?.transcript ?? "").join(" ").trim();
        setLiveTranscript(heard);
      };
      rec.onerror = () => undefined;
      rec.onend = () => undefined;
      try {
        rec.start();
        recognitionRef.current = rec;
      } catch {
        recognitionRef.current = null;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const spoken = heard || liveTranscript;
        // Meta's ASR takes 16 kHz mono WAV only; fall back to the raw WebM (the server can transcode it) if decoding fails.
        const audio = blob.size > 0 ? await toWav16k(blob).then((wav) => ({ blob: wav, mimeType: "audio/wav" }), () => ({ blob, mimeType: "audio/webm" })) : null;
        await submit(spoken, audio ? { base64: await blobToBase64(audio.blob), mimeType: audio.mimeType } : undefined);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      window.setTimeout(() => stopRecording(true), 6000);
    } catch (error) {
      useWorkbench.getState().toast({ tone: "warning", title: "Microphone unavailable", detail: `${error instanceof Error ? error.message : String(error)} — type the command instead.` });
      recognitionRef.current?.stop();
    }
  };

  const stopRecording = (submitAfter: boolean) => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (recorder && recorder.state !== "inactive") {
      if (!submitAfter) recorder.onstop = () => recorder.stream.getTracks().forEach((t) => t.stop());
      recorder.stop();
    }
  };

  if (!open) return null;
  return (
    <aside ref={panelRef} className="absolute top-14 right-3 z-30 w-[420px] animate-fade-in card shadow-popover" data-testid="voice-steer-panel">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-meta" />
          <span className="text-[13px] font-semibold">Voice Steer</span>
          <Pill tone="meta" icon={<Sparkles />}>
            muse-voice-transcribe → muse-spark
          </Pill>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-faint hover:text-text" aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={recording ? "danger" : "meta"}
          size="md"
          icon={recording ? <MicOff /> : <Mic />}
          onClick={() => (recording ? stopRecording(true) : void startRecording())}
          loading={busy}
        >
          {recording ? "Stop & send" : "Record"}
        </Button>
        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(text);
          }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="or type a command…"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 text-[13px] focus:outline-2 focus:outline-meta"
          />
          <Button type="submit" variant="outline" size="md" icon={<Send />} disabled={!text.trim() || busy} aria-label="Send" />
        </form>
      </div>
      {(recording || liveTranscript) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          {recording && <span className="size-2 animate-pulse-dot rounded-full bg-critical" />}
          <span className="font-mono">{liveTranscript || "listening…"}</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => void submit(ex)}
            className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px] text-muted hover:border-meta/50 hover:text-text"
          >
            “{ex}”
          </button>
        ))}
      </div>

      {last && (
        <div className="mt-3 rounded-md border border-border-subtle bg-surface p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-muted">“{last.transcript}”</span>
            <Pill tone={last.intent.intent === "unknown" ? "warning" : "meta"}>
              {last.intent.intent} · {Math.round(last.intent.confidence * 100)}%
            </Pill>
          </div>
          <div className="mt-1 text-faint">
            intent via {last.intentSource} · {last.transcription ? `transcribed by ${last.transcription.modelId} in ${last.transcription.latencyMs} ms` : "text input / browser speech"} ·{" "}
            {last.telemetry.latencyMs} ms · {last.telemetry.tokensUsed.total} tok
          </div>
        </div>
      )}
    </aside>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
