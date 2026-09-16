/**
 * $1 Unistroke Recogniser (Wobbrock, Wilson & Li, 2007).
 *
 * Rotation- and scale-invariant template matching, ~1ms per call. Rotation
 * invariance is deliberate: a wall drawn at any angle is still a wall. Where
 * direction actually matters (arrow, slash, wall angle) we read it off the raw
 * stroke afterwards rather than asking the recogniser for it.
 */

export type MarkId = "line" | "circle" | "zigzag" | "arrow" | "cross";

export interface Pt { x: number; y: number; }

const N = 64;              // resample count
const SQUARE = 250;        // normalized bounding box
const HALF_DIAGONAL = 0.5 * Math.sqrt(SQUARE * SQUARE + SQUARE * SQUARE);
const ANGLE_RANGE = deg(45);
const ANGLE_STEP = deg(2);
const PHI = 0.5 * (-1 + Math.sqrt(5));

function deg(d: number): number { return (d * Math.PI) / 180; }

function pathLength(pts: Pt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

function resample(pts: Pt[], n: number): Pt[] {
  const I = pathLength(pts) / (n - 1);
  if (I === 0) return pts.slice(0, n);
  let D = 0;
  const src = pts.slice();
  const out: Pt[] = [src[0]];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (D + d >= I) {
      const t = (I - D) / d;
      const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      out.push(q);
      src.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
  }
  while (out.length < n) out.push(src[src.length - 1]);
  return out.slice(0, n);
}

function centroid(pts: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function rotateBy(pts: Pt[], theta: number): Pt[] {
  const c = centroid(pts);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return pts.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }));
}

function rotateToZero(pts: Pt[]): Pt[] {
  const c = centroid(pts);
  return rotateBy(pts, -Math.atan2(c.y - pts[0].y, c.x - pts[0].x));
}

/**
 * Anything flatter than this is treated as a one-dimensional gesture and
 * scaled uniformly. Swept empirically (tools/markcheck.ts): 0.12-0.16 all
 * hold above 99%, and 0.14 sits in the middle of that plateau rather than
 * on an edge. Above ~0.20 shallow arrows start reading as lines.
 */
const ONE_D_RATIO = 0.14;

function scaleToSquare(pts: Pt[], size: number): Pt[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  // A perfectly straight line has zero height; guard the divide.
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);

  // Straight strokes get a uniform scale. Stretching a line's bounding box to
  // fill a square multiplies a few pixels of thumb wobble into a full-height
  // zigzag, which is precisely how a wall turns into a tangle you didn't ask
  // for. Non-uniform scaling stays for genuinely two-dimensional marks.
  if (Math.min(w, h) / Math.max(w, h) < ONE_D_RATIO) {
    const k = size / Math.max(w, h);
    return pts.map((p) => ({ x: (p.x - minX) * k, y: (p.y - minY) * k }));
  }

  return pts.map((p) => ({ x: (p.x - minX) * (size / w), y: (p.y - minY) * (size / h) }));
}

function translateToOrigin(pts: Pt[]): Pt[] {
  const c = centroid(pts);
  return pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

function pathDistance(a: Pt[], b: Pt[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return d / a.length;
}

function distanceAtAngle(pts: Pt[], tpl: Pt[], theta: number): number {
  return pathDistance(rotateBy(pts, theta), tpl);
}

/** Golden section search for the best angular alignment. */
function distanceAtBestAngle(pts: Pt[], tpl: Pt[]): number {
  let a = -ANGLE_RANGE, b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b, f1 = distanceAtAngle(pts, tpl, x1);
  let x2 = (1 - PHI) * a + PHI * b, f2 = distanceAtAngle(pts, tpl, x2);
  while (Math.abs(b - a) > ANGLE_STEP) {
    if (f1 < f2) {
      b = x2; x2 = x1; f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = distanceAtAngle(pts, tpl, x1);
    } else {
      a = x1; x1 = x2; f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = distanceAtAngle(pts, tpl, x2);
    }
  }
  return Math.min(f1, f2);
}

function normalize(pts: Pt[]): Pt[] {
  return translateToOrigin(scaleToSquare(rotateToZero(resample(pts, N)), SQUARE));
}

// ---------------------------------------------------------------------------
// Templates, generated rather than hand-typed so they stay easy to retune.
// ---------------------------------------------------------------------------

function polyline(verts: Pt[], per = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < verts.length; i++) {
    const a = verts[i - 1], b = verts[i];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  out.push(verts[verts.length - 1]);
  return out;
}

interface Template { id: MarkId; pts: Pt[]; }

/** A loop of `turns` revolutions, optionally squashed and tilted. */
function arc(r: number, turns: number, squash = 1): Pt[] {
  const out: Pt[] = [];
  const steps = 48;
  for (let i = 0; i <= steps * turns; i++) {
    const t = (i / steps) * Math.PI * 2;
    out.push({ x: Math.cos(t) * r, y: Math.sin(t) * r * squash });
  }
  return out;
}

function zig(peaks: number, w: number, h: number): Pt[] {
  const verts: Pt[] = [{ x: 0, y: 0 }];
  for (let i = 1; i <= peaks; i++) verts.push({ x: w * i, y: i % 2 ? -h : 0 });
  return polyline(verts, 12);
}

/**
 * A V: out, then back at `deg` degrees. The return leg is `hookFrac` of the
 * first, and it wants to be long. A stub hook is geometrically almost a
 * straight line, which is why the gesture is taught as a tick rather than an
 * arrowhead — the hardest mark to recognise was the one asking for the least
 * committed movement.
 */
function arrowTpl(len: number, hookFrac: number, deg: number): Pt[] {
  const hook = len * hookFrac;
  const a = (deg * Math.PI) / 180;
  return polyline([
    { x: 0, y: 0 },
    { x: len, y: 0 },
    { x: len - Math.cos(Math.PI - a) * hook, y: -Math.sin(Math.PI - a) * hook },
  ], 14);
}

/**
 * Templates deliberately include badly drawn variants, because that is what a
 * thumb produces: loops that stop at two thirds, zigzags with two peaks
 * instead of four, and arrows whose hook is barely a stub. $1's accuracy comes
 * from template coverage, so the sloppy cases have to be represented as
 * first-class members of each class rather than left to the noise margin.
 */
const TEMPLATES: Template[] = [
  // Lines: straight, and the gentle bow everyone actually draws.
  { id: "line", pts: normalize(polyline([{ x: 0, y: 0 }, { x: 100, y: 0 }])) },
  { id: "line", pts: normalize(polyline([{ x: 0, y: 0 }, { x: 50, y: 9 }, { x: 100, y: 0 }], 20)) },
  { id: "line", pts: normalize(polyline([{ x: 0, y: 0 }, { x: 50, y: -14 }, { x: 100, y: -4 }], 20)) },

  // Loops: unclosed, closed, overshot, and squashed both ways.
  { id: "circle", pts: normalize(arc(50, 0.62)) },
  { id: "circle", pts: normalize(arc(50, 0.78)) },
  { id: "circle", pts: normalize(arc(50, 1.0)) },
  { id: "circle", pts: normalize(arc(50, 1.22)) },
  { id: "circle", pts: normalize(arc(50, 0.85, 0.62)) },
  { id: "circle", pts: normalize(arc(50, 0.95, 1.5)) },

  // Zigzags: two peaks is the common sloppy case, and shallow ones are normal.
  { id: "zigzag", pts: normalize(zig(2, 30, 46)) },
  { id: "zigzag", pts: normalize(zig(3, 26, 44)) },
  { id: "zigzag", pts: normalize(zig(4, 24, 44)) },
  { id: "zigzag", pts: normalize(zig(5, 20, 40)) },
  { id: "zigzag", pts: normalize(zig(2, 32, 20)) },
  { id: "zigzag", pts: normalize(zig(3, 28, 22)) },

  // Ticks: a committed return leg, at a range of lengths and angles. The
  // stubby ones stay in so a half-hearted flick still lands.
  { id: "arrow", pts: normalize(arrowTpl(100, 0.95, 130)) },
  { id: "arrow", pts: normalize(arrowTpl(100, 0.75, 140)) },
  { id: "arrow", pts: normalize(arrowTpl(100, 0.55, 135)) },
  { id: "arrow", pts: normalize(arrowTpl(100, 0.80, 105)) },
  { id: "arrow", pts: normalize(arrowTpl(100, 0.60, 160)) },
  { id: "arrow", pts: normalize(arrowTpl(100, 0.90, 150)) },
  { id: "arrow", pts: normalize(arrowTpl(100, 0.35, 130)) },
  { id: "arrow", pts: normalize(arrowTpl(100, 0.22, 140)) },
];

// ---------------------------------------------------------------------------
// Shape features
//
// $1 stretches every stroke to fill a square before comparing, which throws
// away aspect — a squashed loop and a hooked line end up occupying the same
// box, and everything collapses toward "arrow". These features are measured on
// the raw path instead, so they survive that normalisation entirely.
//
// The discriminating one is `runs`: the number of stretches where the pen
// keeps turning the same way. A line has none, an arrow and a circle have one
// each (separated by how far they close), and a zigzag has two or more — which
// still holds when a thumb only manages two peaks instead of four.
// ---------------------------------------------------------------------------

export interface Features {
  /** Straight-line gap between the ends, over the path length. */
  closure: number;
  /** Total turning regardless of direction, radians. */
  totalTurn: number;
  /** Stretches of committed turning in one direction. */
  runs: number;
  /**
   * The sharpest single turn. This is what separates an arrow from a bowed
   * line: both may turn the same amount overall, but an arrow spends it all at
   * one corner while a bow spreads it evenly along the stroke.
   */
  sharpest: number;
  /**
   * How far the stroke wanders from the straight path between its ends, as a
   * fraction of that distance. This is what really identifies a line: turning
   * measures are fooled by tremor, but a line drawn by any hand stays near its
   * own chord, while a hook, a loop or a zigzag leaves it.
   */
  deviation: number;
}

/**
 * A run only counts once it has accumulated this much turning. Counting every
 * direction change instead makes hand tremor look like a zigzag — on a wobbly
 * line the pen technically reverses a dozen times, but never commits to any of
 * them.
 */
const RUN_MIN_TURN = 0.95;

/** A run also has to last: tremor reverses within a sample or two, a real
 *  corner is sustained across several. */
const RUN_MIN_SPAN = 2;

/** Three-point moving average — flattens tremor, keeps genuine corners. */
function smooth(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push({
      x: (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4,
      y: (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4,
    });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function features(raw: Pt[]): Features {
  // Few points on purpose: long segments average tremor away, and the shapes
  // being told apart are coarse.
  const pts = smooth(smooth(resample(raw, 24)));
  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) {
    pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (pathLen < 1e-6) return { closure: 1, totalTurn: 0, runs: 0, sharpest: 0, deviation: 0 };

  let totalTurn = 0;
  let sharpest = 0;
  let runs = 0;
  let acc = 0;
  let span = 0;
  let sign = 0;
  const bank = () => { if (acc >= RUN_MIN_TURN && span >= RUN_MIN_SPAN) runs++; };

  for (let i = 1; i < pts.length - 1; i++) {
    const a1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const a2 = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    totalTurn += Math.abs(d);
    sharpest = Math.max(sharpest, Math.abs(d));

    const s2 = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (s2 === 0) continue;
    if (s2 === sign) {
      acc += Math.abs(d);
      span++;
    } else {
      bank();
      sign = s2;
      acc = Math.abs(d);
      span = 1;
    }
  }
  bank();

  const a = pts[0];
  const b = pts[pts.length - 1];
  const gap = Math.hypot(b.x - a.x, b.y - a.y);

  // Largest perpendicular excursion from the chord, relative to the chord.
  let maxDev = 0;
  if (gap > 1e-6) {
    const nx = -(b.y - a.y) / gap;
    const ny = (b.x - a.x) / gap;
    for (const p2 of pts) {
      maxDev = Math.max(maxDev, Math.abs((p2.x - a.x) * nx + (p2.y - a.y) * ny));
    }
  } else {
    maxDev = pathLen;   // a closed loop has no chord to speak of
  }

  return {
    closure: gap / pathLen,
    totalTurn,
    runs,
    sharpest,
    deviation: gap > 1e-6 ? maxDev / gap : 1,
  };
}

/** 0 below lo, 1 above hi, linear between — so nothing fails off a cliff. */
function soft(v: number, lo: number, hi: number): number {
  if (v <= lo) return 0;
  if (v >= hi) return 1;
  return (v - lo) / (hi - lo);
}

/** How plausible each mark is, judged on features alone. */
export function plausibility(f: Features): Record<MarkId, number> {
  const notZigzag = 1 - soft(f.runs, 1.2, 2.4);
  // A bow turns gently everywhere; a corner turns hard in one place.
  //
  // Sharpness is the noisiest of these on a short or sparsely sampled stroke —
  // a few pixels of wobble across a 2px segment is a big angle — so a line
  // only leans on it, never depends on it. Deviation carries that judgement.
  const gentle = 0.4 + 0.6 * soft(0.55 - f.sharpest, 0, 0.25);
  const cornered = soft(f.sharpest, 0.3, 0.65);
  return {
    line: soft(0.30 - f.deviation, 0, 0.14) * soft(f.closure, 0.2, 0.5) * gentle,
    circle: soft(f.totalTurn, 2.2, 4.2) * soft(0.65 - f.closure, 0, 0.3) * notZigzag,
    zigzag: soft(f.runs, 1.2, 2.4) * soft(f.totalTurn, 1.6, 3.2),
    arrow: soft(f.totalTurn, 0.7, 1.8) * soft(5.5 - f.totalTurn, 0, 1.5) *
           soft(f.closure, 0.15, 0.45) * cornered * notZigzag *
           soft(f.deviation, 0.08, 0.2),
    // Cross never reaches here — it is detected from two strokes, not one.
    cross: 0,
  };
}

export interface Recognition {
  id: MarkId;
  score: number;
}

/**
 * Classify one stroke. Returns the best template match and a 0..1 score;
 * the caller decides whether the score clears MARK.minScore.
 */
export function recognize(raw: Pt[]): Recognition | null {
  // Two points is enough: resample() interpolates along the path, so a sparse
  // stroke reconstructs fine. A fast flick on a low-poll-rate device really can
  // arrive as a handful of points, and rejecting those reads as a dead input.
  if (raw.length < 2) return null;
  const pts = normalize(raw);

  // Best template distance per class, so features can reweigh the whole field
  // rather than only the single winner.
  const byClass = new Map<MarkId, number>();
  for (const t of TEMPLATES) {
    const d = distanceAtBestAngle(pts, t.pts);
    const prev = byClass.get(t.id);
    if (prev === undefined || d < prev) byClass.set(t.id, d);
  }
  if (byClass.size === 0) return null;

  const p = plausibility(features(raw));

  let best: MarkId | null = null;
  let bestScore = -Infinity;
  for (const [id, d] of byClass) {
    const shape = 1 - d / HALF_DIAGONAL;
    // Features never veto outright, they only reweigh — a stroke that looks
    // right to $1 but odd by feature still wins if nothing else is close.
    const combined = shape * (FEATURE_FLOOR + (1 - FEATURE_FLOOR) * p[id]);
    if (combined > bestScore) { bestScore = combined; best = id; }
  }
  if (!best) return null;

  return { id: best, score: bestScore };
}

/** How much of a mark's score survives when features find it implausible. */
const FEATURE_FLOOR = 0.45;

/**
 * Do two strokes read as an X?
 *
 * Direction comes from the centroids of each end rather than the endpoints
 * themselves — a thumb's first and last samples are the least reliable part of
 * the stroke, and on a short mark an endpoint chord can be off by tens of
 * degrees. Intersection is tested against the real paths, not the chords, so a
 * bowed stroke that genuinely crosses still counts.
 */
export function isCross(a: Pt[], b: Pt[]): boolean {
  if (a.length < 2 || b.length < 2) return false;

  const dirA = direction(a);
  const dirB = direction(b);
  let diff = Math.abs(Math.atan2(dirA.y, dirA.x) - Math.atan2(dirB.y, dirB.x)) % Math.PI;
  if (diff > Math.PI / 2) diff = Math.PI - diff;
  if (diff < CROSS_MIN_ANGLE) return false;

  return pathsIntersect(a, b);
}

/** At least this much angle between the two strokes, or it is not an X. */
const CROSS_MIN_ANGLE = (40 * Math.PI) / 180;

/** Overall heading, from the centroid of the first quarter to the last. */
function direction(pts: Pt[]): Pt {
  const q = Math.max(1, Math.floor(pts.length / 4));
  let ax = 0, ay = 0, bx = 0, by = 0;
  for (let i = 0; i < q; i++) { ax += pts[i].x; ay += pts[i].y; }
  for (let i = pts.length - q; i < pts.length; i++) { bx += pts[i].x; by += pts[i].y; }
  return { x: bx / q - ax / q, y: by / q - ay / q };
}

/** Any segment of one path crossing any segment of the other. */
function pathsIntersect(a: Pt[], b: Pt[]): boolean {
  const A = coarsen(a);
  const B = coarsen(b);
  for (let i = 1; i < A.length; i++) {
    for (let j = 1; j < B.length; j++) {
      if (segmentsIntersect(A[i - 1], A[i], B[j - 1], B[j])) return true;
    }
  }
  return false;
}

/** Reduce to at most 9 points so the pairwise test stays trivial. */
function coarsen(pts: Pt[]): Pt[] {
  const n = 9;
  if (pts.length <= n) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round((i / (n - 1)) * (pts.length - 1))]);
  return out;
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
