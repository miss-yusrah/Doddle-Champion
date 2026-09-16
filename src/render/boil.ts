import { BOIL } from "../config";

/**
 * Line boil.
 *
 * Every stroke is drawn three slightly different ways and swapped ten times a
 * second. It is the entire hand-drawn look, it costs one hash per vertex, and
 * it makes imprecise geometry read as intentional — which is exactly what a
 * game full of thumb-drawn shapes needs.
 */

/** Which of the three variants is showing right now. */
export function boilFrame(nowMs: number): number {
  return Math.floor(nowMs / (1000 / BOIL.hz)) % BOIL.variants;
}

function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic offset for vertex `i` of object `id` on boil frame `f`. */
export function wobX(id: number, i: number, f: number, amp: number = BOIL.jitter): number {
  return (hash(id, i * 2, f) - 0.5) * amp * 2;
}

export function wobY(id: number, i: number, f: number, amp: number = BOIL.jitter): number {
  return (hash(id, i * 2 + 1, f) - 0.5) * amp * 2;
}
