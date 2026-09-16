/**
 * Recognition check.
 *
 * Per the spec's own risk list, a misread mark is worse than a slow one — the
 * player gets an object they didn't ask for and paid ink for it. This generates
 * deliberately sloppy strokes at every rotation and reports what the recogniser
 * makes of them.
 *
 *   npx tsx tools/markcheck.ts
 */
import { MARK } from "../src/config";
import { Rng } from "../src/core/rng";
import { isCross, recognize, type MarkId, type Pt } from "../src/input/recognizer";

/** Thumb-grade noise: the stroke wanders, and the start and end are ragged. */
function messy(pts: Pt[], rng: Rng, wobble: number): Pt[] {
  const out = pts.map((p) => ({
    x: p.x + rng.range(-wobble, wobble),
    y: p.y + rng.range(-wobble, wobble),
  }));
  // Thumbs overshoot at the start and cut the end short.
  if (rng.next() < 0.5 && out.length > 6) out.splice(0, 1 + Math.floor(rng.next() * 2));
  if (rng.next() < 0.5 && out.length > 6) out.splice(out.length - 2, 2);
  return out;
}

function rotate(pts: Pt[], a: number): Pt[] {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}

function trace(verts: Pt[], per: number): Pt[] {
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

const GEN: Record<MarkId, (rng: Rng) => Pt[]> = {
  line: (rng) => trace([{ x: 0, y: 0 }, { x: rng.range(60, 130), y: rng.range(-8, 8) }], 14),

  circle: (rng) => {
    const r = rng.range(30, 60);
    const turns = rng.range(0.85, 1.15);          // people rarely close a loop exactly
    const squash = rng.range(0.75, 1.25);
    const out: Pt[] = [];
    for (let i = 0; i <= 40 * turns; i++) {
      const t = (i / 40) * Math.PI * 2;
      out.push({ x: Math.cos(t) * r, y: Math.sin(t) * r * squash });
    }
    return out;
  },

  zigzag: (rng) => {
    const w = rng.range(18, 30), h = rng.range(30, 55);
    return trace([
      { x: 0, y: 0 }, { x: w, y: -h }, { x: w * 2, y: 0 },
      { x: w * 3, y: -h }, { x: w * 4, y: 0 },
    ], 10);
  },

  arrow: (rng) => {
    const len = rng.range(70, 120);
    const hook = rng.range(20, 34);
    return trace([{ x: 0, y: 0 }, { x: len, y: 0 }, { x: len - hook, y: -hook * rng.range(0.7, 1.2) }], 12);
  },

  // Cross is the one two-stroke mark; handled by isCross, not by $1.
  cross: (rng) => trace([{ x: 0, y: 0 }, { x: rng.range(50, 90), y: rng.range(50, 90) }], 12),
};

const rng = new Rng(20260902);
const TRIALS = 400;
const WOBBLE = 3.2;   // px of wander on a ~100px stroke — genuinely sloppy

console.log(`\n  ${TRIALS} sloppy strokes per mark, every rotation, wobble ${WOBBLE}px`);
console.log(`  accept threshold: score >= ${MARK.minScore}\n`);
console.log("  " + "mark".padEnd(10) + "correct".padEnd(11) + "rejected".padEnd(11) + "confused as");
console.log("  " + "-".repeat(72));

let worst = 1;
const singles: MarkId[] = ["line", "circle", "zigzag", "arrow"];

for (const want of singles) {
  let ok = 0, rejected = 0;
  const wrong: Record<string, number> = {};
  for (let i = 0; i < TRIALS; i++) {
    const pts = messy(rotate(GEN[want](rng), rng.range(-Math.PI, Math.PI)), rng, WOBBLE);
    const res = recognize(pts);
    if (!res || res.score < MARK.minScore) { rejected++; continue; }
    if (res.id === want) ok++;
    else wrong[res.id] = (wrong[res.id] ?? 0) + 1;
  }
  const rate = ok / TRIALS;
  worst = Math.min(worst, rate);
  const confusion = Object.entries(wrong).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / TRIALS) * 100).toFixed(1)}%`).join(", ") || "—";
  console.log(
    "  " + want.padEnd(10) +
    `${(rate * 100).toFixed(1)}%`.padEnd(11) +
    `${((rejected / TRIALS) * 100).toFixed(1)}%`.padEnd(11) +
    confusion,
  );
}

// Cross: two strokes that must be seen to intersect at a wide angle.
let crossOk = 0, crossFalse = 0;
for (let i = 0; i < TRIALS; i++) {
  const a = messy(GEN.cross(rng), rng, WOBBLE);
  const b = messy(trace([{ x: 70, y: 0 }, { x: 0, y: 70 }], 12), rng, WOBBLE);
  if (isCross(a, b)) crossOk++;
  // Two roughly parallel lines must NOT read as a cross.
  const p1 = messy(GEN.line(rng), rng, WOBBLE);
  const p2 = messy(GEN.line(rng), rng, WOBBLE).map((p) => ({ x: p.x, y: p.y + 25 }));
  if (isCross(p1, p2)) crossFalse++;
}
console.log(
  "  " + "cross".padEnd(10) + `${((crossOk / TRIALS) * 100).toFixed(1)}%`.padEnd(11) +
  "—".padEnd(11) + `false positives on parallel lines: ${((crossFalse / TRIALS) * 100).toFixed(1)}%`,
);

// Sparse strokes: a fast flick can arrive as very few points.
console.log("\n  sparse strokes (low poll rate)");
console.log("  " + "-".repeat(72));
for (const n of [2, 3, 5, 9]) {
  let ok = 0;
  const T = 200;
  for (let i = 0; i < T; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const len = rng.range(60, 130);
    const pts: Pt[] = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      pts.push({ x: Math.cos(a) * len * t, y: Math.sin(a) * len * t });
    }
    const r = recognize(messy(pts, rng, 1.1));
    if (r && r.score >= MARK.minScore && r.id === "line") ok++;
  }
  console.log(`  ${String(n).padStart(2)} points   line recognised ${((ok / T) * 100).toFixed(1)}%`);
}

console.log();
// This is the pristine-input regression guard. The recogniser is tuned for
// realistic thumb strokes (tools/thumbcheck.ts), so the bar here is "nothing
// has broken", not "perfect" — chasing 99% on synthetic shapes was what hid
// the real-world failures in the first place.
const pass = worst >= 0.88 && crossOk / TRIALS >= 0.95 && crossFalse / TRIALS <= 0.02;
console.log(pass ? "  recognition holds up\n" : `  WEAK — worst single-mark accuracy ${(worst * 100).toFixed(1)}%\n`);
process.exit(pass ? 0 : 1);
