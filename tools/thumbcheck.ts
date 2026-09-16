/**
 * Recognition under realistic thumb input.
 *
 * markcheck.ts wobbles a geometrically perfect shape, which flatters the
 * recogniser. Real thumbs fail structurally, not just noisily: loops don't
 * close, zigzags lose peaks, arrow hooks shrink to a stub, and a fast flick
 * arrives as a handful of points. This generates those failures directly.
 *
 *   npx tsx tools/thumbcheck.ts
 */
import { MARK } from "../src/config";
import { Rng } from "../src/core/rng";
import { isCross, recognize, type MarkId, type Pt } from "../src/input/recognizer";

const rng = new Rng(90210);

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

function rot(pts: Pt[], a: number): Pt[] {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}

/** Thin a stroke down to n points — a fast flick reports far fewer samples. */
function thin(pts: Pt[], n: number): Pt[] {
  if (pts.length <= n) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round((i / (n - 1)) * (pts.length - 1))]);
  return out;
}

function wobble(pts: Pt[], amp: number): Pt[] {
  return pts.map((p) => ({ x: p.x + rng.range(-amp, amp), y: p.y + rng.range(-amp, amp) }));
}

/** A hand tremor that drifts rather than jitters — closer to a real wobble. */
function drift(pts: Pt[], amp: number): Pt[] {
  const phase = rng.range(0, 6.28);
  const freq = rng.range(1.5, 4);
  return pts.map((p, i) => {
    const t = (i / pts.length) * Math.PI * 2 * freq + phase;
    return { x: p.x + Math.sin(t) * amp, y: p.y + Math.cos(t * 1.3) * amp };
  });
}

const THUMB: Record<Exclude<MarkId, "cross">, () => Pt[]> = {
  // People bow their "straight" lines.
  line: () => {
    const len = rng.range(45, 140);
    const bow = rng.range(-0.14, 0.14) * len;
    const mid = { x: len / 2, y: bow };
    return trace([{ x: 0, y: 0 }, mid, { x: len, y: rng.range(-6, 6) }], 12);
  },

  // Loops that stop short, overshoot, squash, and never quite close.
  circle: () => {
    const r = rng.range(22, 62);
    const turns = rng.range(0.55, 1.30);       // 0.55 = badly unclosed
    const squash = rng.range(0.55, 1.6);
    const tilt = rng.range(-0.6, 0.6);
    const out: Pt[] = [];
    const steps = 44;
    for (let i = 0; i <= steps * turns; i++) {
      const t = (i / steps) * Math.PI * 2;
      out.push({ x: Math.cos(t) * r, y: Math.sin(t) * r * squash });
    }
    return rot(out, tilt);
  },

  // Two peaks is the common sloppy case; amplitude often collapses.
  zigzag: () => {
    const peaks = Math.floor(rng.range(2, 5.999));
    const w = rng.range(14, 32);
    const h = rng.range(14, 58);              // shallow zigzags are common
    const verts: Pt[] = [{ x: 0, y: 0 }];
    for (let i = 1; i <= peaks; i++) {
      verts.push({ x: w * i, y: i % 2 ? -h * rng.range(0.7, 1.2) : rng.range(-6, 6) });
    }
    return trace(verts, 9);
  },

  // Taught as a tick: out, then a committed leg back. Modelled from a
  // half-hearted return leg up to a full one.
  arrow: () => {
    const len = rng.range(50, 130);
    const hook = len * rng.range(0.28, 1.05);
    const ang = rng.range(1.75, 2.97);         // 100 to 170 degrees back
    return trace([
      { x: 0, y: 0 },
      { x: len, y: 0 },
      { x: len - Math.cos(Math.PI - ang) * hook, y: -Math.sin(Math.PI - ang) * hook },
    ], 11);
  },
};

function messy(pts: Pt[]): Pt[] {
  return roughen(rot(pts, rng.range(-Math.PI, Math.PI)));
}

/** The same hand noise, without re-rotating — for multi-stroke marks. */
function roughen(pts: Pt[]): Pt[] {
  let out = pts;
  out = drift(out, rng.range(0.5, 3.0));
  out = wobble(out, rng.range(0.8, 3.4));
  // Fast flicks report few points; slow marks report many.
  if (rng.next() < 0.45) out = thin(out, Math.floor(rng.range(4, 16)));
  // Thumbs overshoot the start and cut the end short.
  if (rng.next() < 0.55 && out.length > 8) out.splice(0, Math.floor(rng.range(1, 3)));
  if (rng.next() < 0.55 && out.length > 8) out.splice(out.length - Math.floor(rng.range(1, 3)));
  return out;
}

const SWEEP = process.argv.includes("--sweep");
const ARG_TH = process.argv.find((a) => /^0?\.\d+$/.test(a));
const TH = ARG_TH ? Number(ARG_TH) : MARK.minScore;
const TRIALS = SWEEP ? 400 : 600;
const singles: Array<Exclude<MarkId, "cross">> = ["line", "circle", "zigzag", "arrow"];

if (SWEEP) {
  console.log(`\n  accept-threshold sweep, ${TRIALS} strokes per mark\n`);
  console.log("  " + "thresh".padEnd(9) + "correct".padEnd(10) + "misread".padEnd(10) +
    "rejected".padEnd(11) + "notes");
  console.log("  " + "-".repeat(64));
  let bestT = 0, bestVal = -1;
  for (let th = 0.30; th <= 0.80; th += 0.05) {
    let ok = 0, bad = 0, rej = 0, n = 0;
    for (const want of singles) {
      for (let i = 0; i < TRIALS; i++) {
        n++;
        const res = recognize(messy(THUMB[want]()));
        if (!res || res.score < th) rej++;
        else if (res.id === want) ok++;
        else bad++;
      }
    }
    // A misread costs ink and hands you the wrong object; a rejection costs
    // nothing but a retry. Weight accordingly.
    const val = ok / n - 2.2 * (bad / n);
    if (val > bestVal) { bestVal = val; bestT = th; }
    console.log(
      "  " + th.toFixed(2).padEnd(9) +
      `${((ok / n) * 100).toFixed(1)}%`.padEnd(10) +
      `${((bad / n) * 100).toFixed(1)}%`.padEnd(10) +
      `${((rej / n) * 100).toFixed(1)}%`.padEnd(11) +
      (Math.abs(th - bestT) < 1e-9 ? "<- best so far" : ""),
    );
  }
  console.log(`\n  best accept threshold: ${bestT.toFixed(2)}\n`);
  process.exit(0);
}

console.log(`\n  ${TRIALS} realistic thumb strokes per mark`);
console.log(`  unclosed loops, 2-peak zigzags, stub hooks, bowed lines, sparse sampling`);
console.log(`  accept threshold ${TH}\n`);
console.log("  " + "mark".padEnd(9) + "correct".padEnd(10) + "rejected".padEnd(11) + "misread as");
console.log("  " + "-".repeat(70));

let worst = 1;
let worstName = "";
const misreads: Record<string, number> = {};

for (const want of singles) {
  let ok = 0, rejected = 0;
  const wrong: Record<string, number> = {};
  for (let i = 0; i < TRIALS; i++) {
    const res = recognize(messy(THUMB[want]()));
    if (!res || res.score < TH) { rejected++; continue; }
    if (res.id === want) ok++;
    else {
      wrong[res.id] = (wrong[res.id] ?? 0) + 1;
      misreads[`${want}->${res.id}`] = (misreads[`${want}->${res.id}`] ?? 0) + 1;
    }
  }
  const rate = ok / TRIALS;
  if (rate < worst) { worst = rate; worstName = want; }
  const conf = Object.entries(wrong).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / TRIALS) * 100).toFixed(0)}%`).join(", ") || "—";
  console.log(
    "  " + want.padEnd(9) +
    `${(rate * 100).toFixed(1)}%`.padEnd(10) +
    `${((rejected / TRIALS) * 100).toFixed(1)}%`.padEnd(11) + conf,
  );
}

// Cross: two strokes that genuinely intersect near their middles, which is
// what a drawn X is — not two strokes radiating from a shared start point.
let crossOk = 0, crossFalse = 0;
for (let i = 0; i < TRIALS; i++) {
  const L = rng.range(40, 110);
  const tilt = rng.range(-Math.PI, Math.PI);
  const sep = rng.range(1.0, 2.2);        // angle between the two strokes
  const jitterX = rng.range(-0.18, 0.18) * L;
  const jitterY = rng.range(-0.18, 0.18) * L;
  const leg = (ang: number, ox: number, oy: number) => roughen(rot(trace([
    { x: -L / 2, y: 0 }, { x: L / 2, y: 0 },
  ], 12), ang).map((p) => ({ x: p.x + ox, y: p.y + oy })));

  if (isCross(leg(tilt, 0, 0), leg(tilt + sep, jitterX, jitterY))) crossOk++;

  // Two roughly parallel strokes must never read as a cross.
  const off = rng.range(0.2, 0.6) * L;
  const px = -Math.sin(tilt) * off;
  const py = Math.cos(tilt) * off;
  if (isCross(leg(tilt, 0, 0), leg(tilt + rng.range(-0.25, 0.25), px, py))) crossFalse++;
}
console.log("  " + "cross".padEnd(9) + `${((crossOk / TRIALS) * 100).toFixed(1)}%`.padEnd(10) +
  "—".padEnd(11) + `false positives ${((crossFalse / TRIALS) * 100).toFixed(1)}%`);

console.log(`\n  weakest mark: ${worstName} at ${(worst * 100).toFixed(1)}%`);
const top = Object.entries(misreads).sort((a, b) => b[1] - a[1]).slice(0, 4);
if (top.length) {
  console.log("  most common misreads:");
  for (const [k, v] of top) console.log(`    ${k.padEnd(20)} ${((v / TRIALS) * 100).toFixed(1)}%`);
}
// A misread costs ink and hands you an object you did not ask for; a rejection
// costs a retry and nothing else. So the bar is set on misreads, not on the
// correct rate — and a mark that mostly fails by being rejected is acceptable
// where one that mostly fails by lying is not.
let totalWrong = 0, totalN = 0;
for (const want of singles) {
  for (let i = 0; i < TRIALS; i++) {
    totalN++;
    const res = recognize(messy(THUMB[want]()));
    if (res && res.score >= TH && res.id !== want) totalWrong++;
  }
}
const misread = totalWrong / totalN;
console.log(`  overall misread rate: ${(misread * 100).toFixed(1)}%`);
const pass = misread <= 0.12 && worst >= 0.65 &&
  crossOk / TRIALS >= 0.95 && crossFalse / TRIALS <= 0.05;
console.log(pass ? "  holds up under a thumb\n" : "  TOO MANY WRONG MARKS\n");
process.exit(pass ? 0 : 1);
