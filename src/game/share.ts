import type { MarkId } from "../input/recognizer";
import type { Bout, MarkRecord } from "./types";

/**
 * Compact bout codec, for putting a whole recorded round in a link.
 *
 * JSON in base64 runs about 6,000 characters for a normal round, which is
 * three times what a URL can carry safely. Six bytes per mark gets the same
 * round to roughly 300 characters, comfortably inside every chat app.
 *
 * Layout:
 *   byte  0      format version
 *   bytes 1-4    seed, uint32 little-endian
 *   then per mark, 6 bytes:
 *     0-1  time, uint16, in 20ms ticks
 *     2    mark id in the low 3 bits, size in the high 5
 *     3    x, quantised to 0-255
 *     4    y, quantised to 0-255
 *     5    rotation, quantised to 0-255 over a full turn
 *
 * Positions quantise to 1/256 of the page — about 8% of a doodle's radius, so
 * a replayed bout is indistinguishable from the one that was recorded.
 *
 * Nothing identifying goes in the payload. A link carries a round, not a person.
 */

const VERSION = 1;
const MARK_IDS: MarkId[] = ["line", "circle", "zigzag", "arrow", "cross"];
const TICK_MS = 20;
const S_MIN = 0.02;
const S_MAX = 0.30;
const HEADER = 5;
const STRIDE = 6;

/** A round is decided long before this; the cap just bounds the URL. */
export const MAX_MARKS = 160;

const TAU = Math.PI * 2;

function q(v: number, lo: number, hi: number, steps: number): number {
  const t = (v - lo) / (hi - lo);
  return Math.max(0, Math.min(steps, Math.round(t * steps)));
}

function dq(n: number, lo: number, hi: number, steps: number): number {
  return lo + (n / steps) * (hi - lo);
}

export function encodeBout(b: Bout): string {
  const marks = b.marks.slice(0, MAX_MARKS);
  const buf = new Uint8Array(HEADER + marks.length * STRIDE);
  buf[0] = VERSION;
  new DataView(buf.buffer).setUint32(1, b.seed >>> 0, true);

  marks.forEach((m, i) => {
    const o = HEADER + i * STRIDE;
    const ticks = Math.min(65535, Math.max(0, Math.round(m.t / TICK_MS)));
    buf[o] = ticks & 0xff;
    buf[o + 1] = (ticks >> 8) & 0xff;

    const gi = Math.max(0, MARK_IDS.indexOf(m.g));
    const size = q(m.s, S_MIN, S_MAX, 31);
    buf[o + 2] = (gi & 0x07) | (size << 3);

    buf[o + 3] = q(m.x, 0, 1, 255);
    buf[o + 4] = q(m.y, 0, 1, 255);

    // Normalise rotation into one turn before quantising.
    let r = m.r % TAU;
    if (r < 0) r += TAU;
    buf[o + 5] = q(r, 0, TAU, 255) & 0xff;
  });

  return toBase64Url(buf);
}

export function decodeBout(code: string): Bout | null {
  try {
    const buf = fromBase64Url(code);
    if (buf.length < HEADER) return null;
    if (buf[0] !== VERSION) return null;
    if ((buf.length - HEADER) % STRIDE !== 0) return null;

    const seed = new DataView(buf.buffer, buf.byteOffset).getUint32(1, true);
    const count = (buf.length - HEADER) / STRIDE;
    if (count === 0 || count > MAX_MARKS) return null;

    const marks: MarkRecord[] = [];
    for (let i = 0; i < count; i++) {
      const o = HEADER + i * STRIDE;
      const gi = buf[o + 2] & 0x07;
      if (gi >= MARK_IDS.length) return null;
      marks.push({
        t: (buf[o] | (buf[o + 1] << 8)) * TICK_MS,
        g: MARK_IDS[gi],
        s: dq(buf[o + 2] >> 3, S_MIN, S_MAX, 31),
        x: dq(buf[o + 3], 0, 1, 255),
        y: dq(buf[o + 4], 0, 1, 255),
        r: dq(buf[o + 5], 0, TAU, 255),
      });
    }
    return { v: 1, seed, runner: "challenger", page: "notebook", marks };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * The code rides in the hash, not the query string — a fragment never reaches
 * a server and never lands in an access log.
 */
export function challengeUrl(b: Bout): string {
  const { origin, pathname } = location;
  return `${origin}${pathname}#c=${encodeBout(b)}`;
}

/** A challenge waiting in the current URL, if there is one. */
export function readChallenge(): Bout | null {
  const m = /[#&]c=([A-Za-z0-9_-]+)/.exec(location.hash);
  return m ? decodeBout(m[1]) : null;
}

/** Drop the challenge from the address bar without reloading. */
export function clearChallenge(): void {
  history.replaceState(null, "", location.pathname + location.search);
}

// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
