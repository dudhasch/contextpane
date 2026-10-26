import { spawn } from "node:child_process";

/**
 * Meta's ASR accepts 16-bit mono PCM WAV at 16 or 24 kHz only. The workbench
 * encodes that in the browser; anything else (MediaRecorder WebM/Opus from another
 * client, a 44.1 kHz WAV) is transcoded with ffmpeg when it is on PATH.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  format: number;
}

export function readWavInfo(bytes: Uint8Array): WavInfo | null {
  const text = (start: number, len: number) => String.fromCharCode(...bytes.subarray(start, start + len));
  if (bytes.length < 44 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      return {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

export function isMetaAsrWav(bytes: Uint8Array): boolean {
  const info = readWavInfo(bytes);
  return !!info && info.format === 1 && info.channels === 1 && info.bitsPerSample === 16 && (info.sampleRate === 16000 || info.sampleRate === 24000);
}

/** Transcode any ffmpeg-readable audio to 16 kHz mono PCM16 WAV. */
export function transcodeToWav16k(bytes: Uint8Array, timeoutMs = 15_000): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg not available to convert the audio to 16 kHz WAV (${error.message})`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(new Uint8Array(Buffer.concat(out)));
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().slice(0, 200)}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(bytes));
  });
}

/**
 * ffmpeg writes a streaming WAV header with 0xFFFFFFFF sizes when piping; patch
 * RIFF and data sizes so strict parsers accept it.
 */
export function fixStreamedWavSizes(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 44) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(4, bytes.length - 8, true);
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (id === "data") {
      view.setUint32(offset + 4, bytes.length - offset - 8, true);
      break;
    }
    const size = view.getUint32(offset + 4, true);
    offset += 8 + size + (size % 2);
  }
  return bytes;
}
