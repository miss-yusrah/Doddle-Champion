/**
 * Puppet Brawl balance.
 *
 * A fighting mode has to answer "what am I deciding?". This checks two things:
 * that the jab / swing / guard triangle actually resolves the way it claims to,
 * and that no single style beats all the others.
 *
 *   npx tsx tools/puppetcheck.ts
 */
import { PUPPET, STEP_MS } from "../src/config";
import { PuppetDirector } from "../src/game/modes";
import { Round } from "../src/game/round";
import { summarize } from "../src/input/strokes";
import type { Side } from "../src/game/types";

type Move = "jab" | "swing" | "guard";

function arena(): { r: Round; d: PuppetDirector } {
  const r = new Round(77);
  r.puppetRules = true;
  r.player.pos = { x: PUPPET.leftHomeX, y: PUPPET.floorY };
  r.ghost.pos = { x: PUPPET.rightHomeX, y: PUPPET.floorY };
  r.player.home = { ...r.player.pos };
  r.ghost.home = { ...r.ghost.pos };
  r.player.hearts = PUPPET.hearts;
  r.ghost.hearts = PUPPET.hearts;
  return { r, d: new PuppetDirector() };
}

/**
 * Put the two puppets already within reach and fully idle, so a triangle test
 * measures timing alone. At home spacing the gap is 0.46 against a reach near
 * 0.2, so contact only ever happens mid-lunge — fine for a real bout, useless
 * for isolating which move beats which.
 */
function locked(): { r: Round; d: PuppetDirector } {
  const { r, d } = arena();
  r.player.pos.x = 0.44;
  r.ghost.pos.x = 0.56;
  r.player.home = { ...r.player.pos };
  r.ghost.home = { ...r.ghost.pos };
  return { r, d };
}

function act(r: Round, side: Side, move: Move): void {
  const home = side === "player" ? PUPPET.leftHomeX : PUPPET.rightHomeX;
  const facing = side === "player" ? 1 : -1;
  const travel = move === "swing" ? 0.26 : move === "jab" ? 0.09 : 0.2;
  const dir = move === "guard" ? -facing : facing;
  r.puppetStrike(side, summarize(
    [{ x: home, y: 0.72 }, { x: home + dir * travel, y: 0.70 }], travel));
}

const step = (r: Round, d: PuppetDirector, secs: number) => {
  const n = Math.round(secs / (STEP_MS / 1000));
  for (let i = 0; i < n; i++) { d.update(r, STEP_MS / 1000); r.step(STEP_MS); }
};

// ---------------------------------------------------------------------------
// The triangle, tested directly.
// ---------------------------------------------------------------------------

console.log("\n  the triangle");
console.log("  " + "-".repeat(72));
let fail = false;

function check(label: string, got: string, want: string): void {
  const ok = got === want;
  if (!ok) fail = true;
  console.log(`  ${label.padEnd(34)} ${got.padEnd(22)} ${ok ? "ok" : "EXPECTED " + want}`);
}

// Heavy vs guard: the swing should break it and score.
{
  const { r, d } = locked();
  const before = r.ghost.hearts;
  act(r, "ghost", "guard");
  step(r, d, 0.04);
  act(r, "player", "swing");
  step(r, d, 0.5);
  check("swing into a guard", r.ghost.hearts < before ? "guard broken" : "nothing", "guard broken");
}

// Jab vs guard: turned aside, and the attacker eats the recovery.
{
  const { r, d } = locked();
  const before = r.ghost.hearts;
  const blocks = r.puppetBlock;
  act(r, "ghost", "guard");
  step(r, d, 0.04);
  act(r, "player", "jab");
  step(r, d, 0.4);
  check("jab into a guard",
    r.ghost.hearts === before && r.puppetBlock > blocks ? "blocked" : "got through", "blocked");
}

// Jab vs a heavy wind-up: the jab is faster and lands first.
{
  const { r, d } = locked();
  const pBefore = r.player.hearts;
  const gBefore = r.ghost.hearts;
  act(r, "ghost", "swing");     // 0.24s wind-up starts
  step(r, d, 0.02);
  act(r, "player", "jab");      // 0.09s wind-up, active from 0.09 to 0.20
  step(r, d, 0.6);
  const jabWon = r.ghost.hearts < gBefore && r.player.hearts === pBefore;
  check("jab inside a heavy wind-up", jabWon ? "jab lands first" : "heavy wins", "jab lands first");
}

// Two live swings meeting should clack, not trade hits.
{
  const { r, d } = locked();
  const pBefore = r.player.hearts;
  const gBefore = r.ghost.hearts;
  act(r, "player", "swing");
  act(r, "ghost", "swing");
  step(r, d, 0.6);
  check("two swings meeting",
    r.player.hearts === pBefore && r.ghost.hearts === gBefore && r.puppetClash > 0
      ? "rods clack" : "traded hits", "rods clack");
}

// You cannot start a second swing mid-swing.
{
  const { r, d } = locked();
  act(r, "player", "swing");
  step(r, d, 0.05);
  const phase = r.puppetMotion.player.phase;
  act(r, "player", "jab");
  check("swipe during a committed swing",
    r.puppetMotion.player.phase === phase && r.puppetMotion.player.heavy ? "ignored" : "accepted",
    "ignored");
}

// ---------------------------------------------------------------------------
// Styles against each other.
// ---------------------------------------------------------------------------

interface Style { name: string; mix: Move[]; rate: number; }
const STYLES: Style[] = [
  { name: "jabber",  mix: ["jab", "jab", "jab", "jab", "guard"], rate: 5 },
  { name: "swinger", mix: ["swing", "swing", "swing", "guard"], rate: 5 },
  { name: "turtle",  mix: ["guard", "guard", "jab", "guard", "swing"], rate: 5 },
  { name: "mixer",   mix: ["jab", "swing", "guard", "jab", "guard", "swing"], rate: 5 },
];

function bout(a: Style, b: Style, seed: number): { winner: string; secs: number } {
  const { r, d } = arena();
  let nextA = 0.15 + (seed % 5) * 0.02;
  let nextB = 0.15 + (seed % 7) * 0.02;
  let ia = seed % a.mix.length;
  let ib = seed % b.mix.length;
  let verdict: string | null = null;
  while (!verdict && r.time < 70) {
    if (r.time >= nextA) { nextA = r.time + 1 / a.rate; act(r, "player", a.mix[ia++ % a.mix.length]); }
    if (r.time >= nextB) { nextB = r.time + 1 / b.rate; act(r, "ghost", b.mix[ib++ % b.mix.length]); }
    d.update(r, STEP_MS / 1000);
    r.step(STEP_MS);
    verdict = d.finished(r);
  }
  return { winner: verdict ?? "none", secs: r.time };
}

const N = 40;
console.log("\n  style matchups (" + N + " seeds each way)");
console.log("  " + "-".repeat(72));
console.log("  " + "matchup".padEnd(24) + "left wins".padEnd(12) + "draws".padEnd(10) + "avg length");

let worstEdge = 0;
let shortest = 999, longest = 0;
const lengths: number[] = [];
for (let i = 0; i < STYLES.length; i++) {
  for (let j = i + 1; j < STYLES.length; j++) {
    let w = 0, dr = 0, secs = 0;
    for (let s = 0; s < N; s++) {
      const b = bout(STYLES[i], STYLES[j], 100 + s * 37);
      if (b.winner === "won") w++;
      else if (b.winner === "draw") dr++;
      secs += b.secs;
      shortest = Math.min(shortest, b.secs);
      longest = Math.max(longest, b.secs);
      lengths.push(b.secs);
    }
    worstEdge = Math.max(worstEdge, Math.abs(w / N - 0.5));
    console.log(
      "  " + `${STYLES[i].name} v ${STYLES[j].name}`.padEnd(24) +
      `${((w / N) * 100).toFixed(0)}%`.padEnd(12) +
      `${((dr / N) * 100).toFixed(0)}%`.padEnd(10) +
      `${(secs / N).toFixed(1)}s`,
    );
  }
}

lengths.sort((a, b) => a - b);
const median = lengths[Math.floor(lengths.length / 2)];
const quick = lengths.filter((l) => l < 5).length / lengths.length;

console.log(`\n  bout length: ${shortest.toFixed(1)}s to ${longest.toFixed(1)}s, median ${median.toFixed(1)}s (round is ${PUPPET.roundSec}s)`);
console.log(`  bouts under 5s: ${(quick * 100).toFixed(0)}%`);
console.log(`  biggest matchup edge: ${((0.5 + worstEdge) * 100).toFixed(0)}%`);

// A rare blowout is fine — a perfectly played round should end fast. Frequent
// two-second bouts are the thing that made this mode not a fight.
if (quick > 0.12) { console.log("  !! too many bouts end almost instantly"); fail = true; }
if (median < 8) { console.log("  !! the typical bout is too short to be a fight"); fail = true; }
if (worstEdge > 0.28) { console.log("  !! one style dominates another too heavily"); fail = true; }

console.log(fail ? "\n  NEEDS WORK\n" : "\n  puppet brawl holds up\n");
process.exit(fail ? 1 : 0);
