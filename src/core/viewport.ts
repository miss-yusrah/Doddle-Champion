import { ASPECT } from "../config";

export interface Vec { x: number; y: number; }

/**
 * Maps the fixed 9:19.5 play area into whatever screen we were handed.
 *
 * The whole simulation lives in normalized space: x runs 0..1 across the play
 * area, y runs 0..1 down it. Nothing downstream ever sees a pixel, which is
 * what lets a bout recorded on an SE replay identically on a tablet.
 */
export class Viewport {
  left = 0;
  top = 0;
  width = 0;
  height = 0;

  resize(screenW: number, screenH: number): void {
    // Fit the tallest 9:19.5 box that still fits, then centre it.
    let w = screenW;
    let h = w * ASPECT;
    if (h > screenH) {
      h = screenH;
      w = h / ASPECT;
    }
    this.width = w;
    this.height = h;
    this.left = (screenW - w) / 2;
    this.top = (screenH - h) / 2;
  }

  /** Normalized point to screen pixels. */
  toScreenX(nx: number): number { return this.left + nx * this.width; }
  toScreenY(ny: number): number { return this.top + ny * this.height; }

  /** Screen pixels back to normalized. */
  toNormX(px: number): number { return (px - this.left) / this.width; }
  toNormY(py: number): number { return (py - this.top) / this.height; }

  /** A length in width-units, converted to pixels. */
  toScreenLen(n: number): number { return n * this.width; }
}

/**
 * Aspect-corrected distance.
 *
 * x and y are both normalized 0..1, but the play area is far taller than it is
 * wide — so a raw hypotenuse would make every radius an ellipse. Everything
 * measures in width-units instead.
 */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = (ay - by) * ASPECT;
  return Math.hypot(dx, dy);
}

export function dist2(a: Vec, b: Vec): number {
  return dist(a.x, a.y, b.x, b.y);
}

/** Shortest distance from point p to segment ab, in width-units. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ax = a.x, ay = a.y * ASPECT;
  const bx = b.x, by = b.y * ASPECT;
  const px = p.x, py = p.y * ASPECT;
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
