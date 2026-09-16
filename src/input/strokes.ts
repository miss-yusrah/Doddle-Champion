import { MARK } from "../config";
import type { Viewport } from "../core/viewport";
import type { Pt } from "./recognizer";

export interface Stroke {
  /** Points in normalized play-area space. */
  pts: Pt[];
  /** Total travel in width-units. */
  travel: number;
  /** Where the stroke started and ended. */
  from: Pt;
  to: Pt;
  /** Bounding-box centre — where the resolved object lands. */
  centre: Pt;
  /** Half-extent of the stroke, in width-units. */
  size: number;
  /** Direction of the stroke, radians. */
  rot: number;
  endedAt: number;
}

/**
 * Captures pointer input and hands finished strokes to a callback.
 *
 * Two things here are load-bearing on mobile: the canvas takes pointer capture
 * so a stroke that wanders off the element still completes, and travel is
 * capped — a mark is a flick, not a sketch, because a fingertip covers about
 * 44pt of whatever it is drawing on.
 */
export class StrokeInput {
  /** One in-flight stroke per finger. Same Page genuinely supports two people. */
  private active = new Map<number, { pts: Pt[]; travel: number }>();
  /** Points as they should be drawn right now — one wet trail per finger. */
  get wet(): Pt[][] { return [...this.active.values()].map((s) => s.pts); }
  enabled = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly vp: Viewport,
    private readonly onStroke: (s: Stroke) => void,
  ) {
    el.addEventListener("pointerdown", this.down, { passive: false });
    el.addEventListener("pointermove", this.move, { passive: false });
    el.addEventListener("pointerup", this.up, { passive: false });
    el.addEventListener("pointercancel", this.up, { passive: false });
    // Belt and braces: some iOS builds still try to scroll or long-press.
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private toNorm(e: PointerEvent): Pt {
    return { x: this.vp.toNormX(e.clientX), y: this.vp.toNormY(e.clientY) };
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled || this.active.has(e.pointerId)) return;
    e.preventDefault();
    (this.el as HTMLElement).setPointerCapture?.(e.pointerId);
    this.active.set(e.pointerId, { pts: [this.toNorm(e)], travel: 0 });
  };

  private move = (e: PointerEvent) => {
    const stroke = this.active.get(e.pointerId);
    if (!stroke) return;
    e.preventDefault();
    const p = this.toNorm(e);
    const last = stroke.pts[stroke.pts.length - 1];
    const step = Math.hypot(p.x - last.x, p.y - last.y);
    if (step < 0.002) return;                      // drop jitter
    if (stroke.travel + step > MARK.maxTravel) return; // stroke is long enough; stop growing it
    stroke.travel += step;
    stroke.pts.push(p);
  };

  private up = (e: PointerEvent) => {
    const stroke = this.active.get(e.pointerId);
    if (!stroke) return;
    e.preventDefault();
    this.active.delete(e.pointerId);
    if (stroke.pts.length < 2 || stroke.travel < MARK.minTravel) return;
    this.onStroke(summarize(stroke.pts, stroke.travel));
  };

  /** Drop any half-drawn stroke — used when a round ends mid-gesture. */
  cancel(): void {
    this.active.clear();
  }

  dispose(): void {
    this.el.removeEventListener("pointerdown", this.down);
    this.el.removeEventListener("pointermove", this.move);
    this.el.removeEventListener("pointerup", this.up);
    this.el.removeEventListener("pointercancel", this.up);
  }
}

export function summarize(pts: Pt[], travel: number): Stroke {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const from = pts[0];
  const to = pts[pts.length - 1];
  return {
    pts,
    travel,
    from,
    to,
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    size: Math.max((maxX - minX) / 2, 0.02),
    rot: Math.atan2(to.y - from.y, to.x - from.x),
    endedAt: performance.now(),
  };
}
