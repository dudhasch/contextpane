import { deflateSync, inflateSync } from "node:zlib";

/**
 * A dependency-free PNG writer and reader for the ERP inbox: the random drop generator paints a
 * customer "screenshot" (error dialog with the symptom text in a 5x7 pixel font) and tags it with
 * tEXt chunks; the deterministic vision fallback reads those chunks back when no vision model is
 * reachable. RGB, 8-bit, filter 0, one IDAT.
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

export type Rgb = [number, number, number];

/** An RGB raster with the handful of drawing primitives the generator needs. */
export class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    fill: Rgb = [0, 0, 0],
  ) {
    this.data = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width, height, fill);
  }

  set(x: number, y: number, [r, g, b]: Rgb) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgb) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: Rgb) {
    this.fillRect(x, y, w, 1, color);
    this.fillRect(x, y + h - 1, w, 1, color);
    this.fillRect(x, y, 1, h, color);
    this.fillRect(x + w - 1, y, 1, h, color);
  }

  /** Draws `text` in the 5x7 font at `scale`; returns the advance in pixels. Lower-case is upper-cased. */
  text(x: number, y: number, text: string, color: Rgb, scale = 2): number {
    let cx = x;
    for (const raw of text.toUpperCase()) {
      const glyph = FONT[raw] ?? FONT["?"]!;
      for (let row = 0; row < 7; row++) {
        const line = glyph[row]!;
        for (let col = 0; col < 5; col++) if (line[col] === "#") this.fillRect(cx + col * scale, y + row * scale, scale, scale, color);
      }
      cx += 6 * scale;
    }
    return cx - x;
  }

  toPng(texts: Record<string, string> = {}): Uint8Array {
    const stride = this.width * 3;
    const raw = new Uint8Array((stride + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (stride + 1)] = 0;
      raw.set(this.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const ihdr = new Uint8Array(13);
    ihdr.set(u32(this.width), 0);
    ihdr.set(u32(this.height), 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: RGB
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const parts: Uint8Array[] = [SIGNATURE, chunk("IHDR", ihdr)];
    for (const [key, value] of Object.entries(texts)) {
      const latin = (s: string) => Uint8Array.from([...s].map((ch) => Math.min(255, ch.charCodeAt(0))));
      const k = latin(key.slice(0, 79));
      const v = latin(value);
      const data = new Uint8Array(k.length + 1 + v.length);
      data.set(k, 0);
      data[k.length] = 0;
      data.set(v, k.length + 1);
      parts.push(chunk("tEXt", data));
    }
    parts.push(chunk("IDAT", new Uint8Array(deflateSync(raw))));
    parts.push(chunk("IEND", new Uint8Array(0)));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }
}

export interface PngInfo {
  width: number;
  height: number;
  texts: Record<string, string>;
}

/** Dimensions and tEXt chunks of a PNG; null when the bytes are not a PNG. */
export function readPngInfo(bytes: Uint8Array): PngInfo | null {
  if (bytes.length < 33) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const texts: Record<string, string> = {};
  let width = 0;
  let height = 0;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;
    if (type === "IHDR") {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
    } else if (type === "tEXt") {
      const data = bytes.subarray(start, end);
      const nul = data.indexOf(0);
      if (nul > 0) texts[String.fromCharCode(...data.subarray(0, nul))] = String.fromCharCode(...data.subarray(nul + 1));
    } else if (type === "IEND") break;
    offset = end + 4;
  }
  return width && height ? { width, height, texts } : null;
}

/** Decodes an RGB PNG written by `Canvas.toPng` back to a Canvas (tests only). */
export function decodeCanvas(bytes: Uint8Array): Canvas | null {
  const info = readPngInfo(bytes);
  if (!info) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of idat) {
    joined.set(p, o);
    o += p.length;
  }
  const raw = new Uint8Array(inflateSync(joined));
  const canvas = new Canvas(info.width, info.height);
  const stride = info.width * 3;
  for (let y = 0; y < info.height; y++) canvas.data.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  return canvas;
}

/* ----------------------------- 5x7 pixel font ----------------------------- */

const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "(": ["..#..", ".#...", "#....", "#....", "#....", ".#...", "..#.."],
  ")": ["..#..", "...#.", "....#", "....#", "....#", "...#.", "..#.."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
  ",": [".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
  "[": [".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."],
  "]": [".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."],
  "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", ".#.##", "#..##"],
};
