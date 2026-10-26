import { describe, expect, test } from "bun:test";
import { fixStreamedWavSizes, isMetaAsrWav, readWavInfo } from "./wav.ts";

function wav(sampleRate: number, channels: number, bits: number, dataBytes = 64, streamed = false): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, streamed ? 0xffffffff : 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, streamed ? 0xffffffff : dataBytes, true);
  return bytes;
}

describe("Meta ASR WAV checks", () => {
  test("only 16-bit mono PCM at 16 or 24 kHz passes straight through", () => {
    expect(isMetaAsrWav(wav(16000, 1, 16))).toBe(true);
    expect(isMetaAsrWav(wav(24000, 1, 16))).toBe(true);
    expect(isMetaAsrWav(wav(44100, 1, 16))).toBe(false);
    expect(isMetaAsrWav(wav(16000, 2, 16))).toBe(false);
    expect(isMetaAsrWav(new TextEncoder().encode("\x1aE\xdf\xa3 webm bytes, not a RIFF file at all"))).toBe(false);
  });

  test("ffmpeg's streamed 0xFFFFFFFF sizes are patched to the real lengths", () => {
    const fixed = fixStreamedWavSizes(wav(16000, 1, 16, 100, true));
    const view = new DataView(fixed.buffer);
    expect(view.getUint32(4, true)).toBe(fixed.length - 8);
    expect(view.getUint32(40, true)).toBe(100);
    expect(readWavInfo(fixed)).toEqual({ format: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16 });
  });
});
