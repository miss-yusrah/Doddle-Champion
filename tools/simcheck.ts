/**
 * Headless simulation check.
 *
 * Runs full rounds on the fixed step with no renderer, which is the only
 * honest way to test balance and determinism — a browser tab throttles rAF the
 * moment it loses focus, and every timing observation made through it lies.
 *
 *   npx tsx tools/simcheck.ts
 */
import { ROUND, STEP_MS } from "../src/config";
import { authorBout, GhostDriver, LADDER, type Personality } from "../src/game/ghost";
import { Round } from "../src/game/round";
import { summarize } from "../src/input/strokes";
import { STEPS, Tutorial } from "../src/game/tutorial";
import type { MarkId } from "../src/input/recognizer";

interface Result {
  outcome: string;
  seconds: number;
  ghostMarks: number;
  playerHearts: number;
  ghostHearts: number;
  erasureReached: number;
}

/** Play one round. `pilot` is an optional scripted player. */
function runRound(
  p: Personality,
  seed: number,
  pilot?: (r: Round) => void,
): Result {
  const round = new Round(seed);
  const bout = authorBout(p, seed ^ 0x9e3779b9, ROUND.lengthSec);
  const ghost = new GhostDriver(bout);
  let played = 0;
  const before = () => round.entities.filter((e) => e.side === "ghost").length;

  while (round.outcome === "playing" && round.time < ROUND.lengthSec + 1) {
    const n = before();
    ghost.update(round);
    if (before() > n) played++;
    pilot?.(round);
    round.step(STEP_MS);
  }

  return {
    outcome: round.outcome,
    seconds: round.time,
    ghostMarks: played,
    playerHearts: Math.max(0, round.player.hearts),
    ghostHearts: Math.max(0, round.ghost.hearts),
    erasureReached: round.erasure,
  };
}

/** A player who draws a mark on a fixed cadence, to check both sides can act. */
function makePilot(marks: MarkId[], everySec: number) {
  let next = everySec;
  let i = 0;
  return (r: Round) => {
    if (r.time < next) return;
    next += everySec;
    const g = marks[i++ % marks.length];
    // Attack marks go across the fold; defensive ones stay home.
    const attacking = g === "line" || g === "circle" ? i % 2 === 0 : false;
    const y = attacking ? 0.25 : 0.72;
    const from = { x: 0.45, y };
    const to = { x: 0.62, y: y + 0.03 };
    r.play("player", g, summarize([from, to], 0.18), true);
  };
}

function pct(n: number, d: number): string {
  return `${((n / d) * 100).toFixed(0)}%`;
}

const N = 120;
console.log(`\n  ${N} rounds per opponent, fixed ${STEP_MS.toFixed(3)}ms step\n`);
console.log("  passive player (ghost should win every time)");
console.log("  " + "-".repeat(74));
console.log(
  "  " + "opponent".padEnd(12) + "ghost wins".padEnd(13) + "avg length".padEnd(13) +
  "avg marks".padEnd(12) + "reached eraser",
);

let anyFailure = false;

for (const p of LADDER) {
  const rs: Result[] = [];
  for (let i = 0; i < N; i++) rs.push(runRound(p, 1000 + i * 7919));
  const wins = rs.filter((r) => r.outcome === "ghostWon").length;
  const stolen = rs.filter((r) => r.outcome === "playerWon").length;
  const drew = rs.filter((r) => r.outcome === "draw").length;
  const avgLen = rs.reduce((a, r) => a + r.seconds, 0) / N;
  const avgMarks = rs.reduce((a, r) => a + r.ghostMarks, 0) / N;
  const reached = rs.filter((r) => r.erasureReached > 0).length;
  console.log(
    "  " + p.name.padEnd(12) + pct(wins, N).padEnd(13) +
    `${avgLen.toFixed(1)}s`.padEnd(13) +
    avgMarks.toFixed(1).padEnd(12) + pct(reached, N),
  );
  if (stolen > 0) { anyFailure = true; console.log(`     !! ${stolen} rounds won by a player who never drew`); }
  if (drew > 0) console.log(`     .. ${drew} draws (both erased together)`);
  if (avgMarks < 5) { anyFailure = true; console.log(`     !! ghost barely acts (${avgMarks.toFixed(1)} marks)`); }
}

console.log("\n  active player, drawing every 1.2s");
console.log("  " + "-".repeat(74));
console.log("  " + "opponent".padEnd(12) + "player wins".padEnd(13) + "draws".padEnd(9) + "avg length");

const kit: MarkId[] = ["line", "circle", "zigzag", "line", "arrow", "circle"];
const ladderWinRates: number[] = [];
for (const p of LADDER) {
  const rs: Result[] = [];
  for (let i = 0; i < N; i++) rs.push(runRound(p, 2000 + i * 6421, makePilot(kit, 1.2)));
  const w = rs.filter((r) => r.outcome === "playerWon").length;
  const d = rs.filter((r) => r.outcome === "draw").length;
  const avgLen = rs.reduce((a, r) => a + r.seconds, 0) / N;
  ladderWinRates.push(w / N);
  console.log(
    "  " + p.name.padEnd(12) + pct(w, N).padEnd(13) + pct(d, N).padEnd(9) + `${avgLen.toFixed(1)}s`,
  );
}
for (let i = 1; i < ladderWinRates.length; i++) {
  if (ladderWinRates[i] > ladderWinRates[i - 1] + 0.02) {
    console.log("  !! ladder difficulty goes backwards");
    anyFailure = true;
    break;
  }
}

// Determinism: the same seed must produce a byte-identical outcome.
console.log("\n  determinism");
console.log("  " + "-".repeat(74));
let deterministic = true;
for (const p of LADDER) {
  for (let i = 0; i < 12; i++) {
    const seed = 555 + i * 31;
    const a = runRound(p, seed, makePilot(kit, 1.2));
    const b = runRound(p, seed, makePilot(kit, 1.2));
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      deterministic = false;
      console.log(`  !! ${p.name} seed ${seed} diverged`);
      console.log(`     ${JSON.stringify(a)}`);
      console.log(`     ${JSON.stringify(b)}`);
    }
  }
}
console.log(`  same seed, same round: ${deterministic ? "yes" : "NO"}`);
if (!deterministic) anyFailure = true;

// A round must always resolve — the Eraser exists so nothing can stall.
console.log("\n  no round stalls past the Eraser");
console.log("  " + "-".repeat(74));
let stalls = 0;
for (const p of LADDER) {
  for (let i = 0; i < 60; i++) {
    const r = runRound(p, 9000 + i * 13, makePilot(["line", "circle"], 0.9));
    if (r.outcome === "playing") stalls++;
  }
}
console.log(`  unresolved rounds: ${stalls}`);
if (stalls > 0) anyFailure = true;

// The guide has to accept the right mark in the right half, and nudge when the
// player uses the right mark in the wrong one — the exact confusion it exists
// to fix.
console.log("\n  guided first run");
console.log("  " + "-".repeat(74));
{
  const t = new Tutorial();
  const r = new Round(7);
  r.practice = true;
  let advanced = 0;
  let nudged = 0;

  for (const step of STEPS) {
    const ownY = 0.74;
    const foeY = 0.26;

    // Right mark, wrong half — must nudge, must not advance.
    const wrongY = step.half === "own" ? foeY : ownY;
    r.player.ink = 100;
    r.lastResolved = null;
    r.play("player", step.want, summarize(
      [{ x: 0.46, y: wrongY }, { x: 0.60, y: wrongY + 0.01 }], 0.16), false);
    const misplaced = t.wrongHalf(step.want, r.lastResolved);
    const wronglyAccepted = t.accepts(step.want, r.lastResolved);
    if (misplaced && !wronglyAccepted) nudged++;
    else if (step.want !== "zigzag" && step.want !== "arrow" && step.want !== "cross") {
      console.log(`  !! step ${t.index + 1} (${step.want}) did not nudge on the wrong half`);
      anyFailure = true;
    }

    // Right mark, right half — must advance.
    const rightY = step.half === "own" ? ownY : foeY;
    r.player.ink = 100;
    r.lastResolved = null;
    r.play("player", step.want, summarize(
      [{ x: 0.46, y: rightY }, { x: 0.60, y: rightY + 0.01 }], 0.16), false);
    if (t.accepts(step.want, r.lastResolved)) { t.advance(); advanced++; }
    else {
      console.log(`  !! step ${t.index + 1} (${step.want} in ${step.half} half) was not accepted -> got ${r.lastResolved}`);
      anyFailure = true;
    }
  }

  console.log(`  steps completed:      ${advanced} / ${STEPS.length}`);
  console.log(`  wrong-half nudges:    ${nudged} (zigzag, arrow and cross work in either half by design)`);
  console.log(`  guide finishes:       ${t.finished ? "yes" : "NO"}`);
  if (!t.finished) anyFailure = true;
}

console.log("\n  Same Page simultaneous ownership");
console.log("  " + "-".repeat(74));
{
  const r = new Round(19);
  r.player.ink = 100;
  r.ghost.ink = 100;
  const bottom = summarize([{ x: 0.16, y: 0.74 }, { x: 0.32, y: 0.74 }], 0.16);
  const top = summarize([{ x: 0.68, y: 0.26 }, { x: 0.84, y: 0.26 }], 0.16);
  r.play("player", "line", bottom, true);
  r.play("ghost", "line", top, false);
  const bothPromotable = r.wallPromotable("player", performance.now()) &&
    r.wallPromotable("ghost", performance.now());
  r.play("player", "cross", bottom, true);
  r.play("ghost", "cross", top, false);
  const separateInk = r.player.ink === 65 && r.ghost.ink === 65;
  const ownWallsRetracted = r.entities
    .filter((e) => e.kind === "wall")
    .every((e) => e.dead);
  console.log(`  separate pending strokes: ${bothPromotable ? "yes" : "NO"}`);
  console.log(`  ink refunded to each side: ${separateInk ? "yes" : "NO"}`);
  console.log(`  each wall retracted:       ${ownWallsRetracted ? "yes" : "NO"}`);
  if (!bothPromotable || !separateInk || !ownWallsRetracted) anyFailure = true;
}

console.log(anyFailure ? "\n  FAILURES ABOVE\n" : "\n  all checks passed\n");
process.exit(anyFailure ? 1 : 0);
