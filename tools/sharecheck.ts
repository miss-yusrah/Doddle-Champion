/**
 * Share-link check.
 *
 * The loop that matters is: play a round, encode it into a link, decode it on
 * someone else's phone, and have it come back as an opponent that actually
 * fights. Encoding is lossy by design, so this also checks the loss doesn't
 * change how the round plays.
 *
 *   npx tsx tools/sharecheck.ts
 */
import { ROUND, STEP_MS } from "../src/config";
import { GhostDriver } from "../src/game/ghost";
import { Round } from "../src/game/round";
import { MAX_MARKS, decodeBout, encodeBout } from "../src/game/share";
import { summarize } from "../src/input/strokes";
import type { MarkId } from "../src/input/recognizer";
import type { Bout } from "../src/game/types";

const KIT: MarkId[] = ["line", "circle", "zigzag", "line", "arrow", "circle", "cross"];

/** Play a round with a scripted player and return the bout they recorded. */
function recordBout(seed: number, everySec: number): Bout {
  const r = new Round(seed);
  let next = everySec;
  let i = 0;
  while (r.outcome === "playing" && r.time < ROUND.lengthSec) {
    if (r.time >= next) {
      next = r.time + everySec;
      const g = KIT[i++ % KIT.length];
      const attacking = i % 2 === 0;
      const y = attacking ? 0.24 : 0.74;
      r.play("player", g, summarize(
        [{ x: 0.36 + ((i * 0.13) % 0.4), y }, { x: 0.52 + ((i * 0.13) % 0.4), y: y + 0.02 }], 0.17), true);
    }
    r.step(STEP_MS);
  }
  return { v: 1, seed: r.seed, runner: "you", page: "notebook", marks: r.log.slice(0, MAX_MARKS) };
}

/** Replay a bout as the opponent against a player who does nothing. */
function replay(b: Bout): { fired: number; due: number; damage: number; won: boolean } {
  const r = new Round(b.seed);
  const g = new GhostDriver(b);
  while (r.outcome === "playing" && r.time < ROUND.lengthSec) {
    g.update(r);
    r.step(STEP_MS);
  }
  // A round that ends early never reaches the later marks, so the honest
  // denominator is the marks that came due before it finished.
  const due = b.marks.filter((m) => m.t <= r.time * 1000).length;
  return {
    fired: g.played,
    due,
    damage: ROUND.hearts - Math.max(0, r.player.hearts),
    won: r.outcome === "ghostWon",
  };
}

const BASE = "https://doodlechampion.app/#c=".length;
let fail = false;

console.log("\n  record a round -> link -> decode -> replay as an opponent");
console.log("  " + "-".repeat(72));
console.log("  " + "cadence".padEnd(10) + "marks".padEnd(8) + "url".padEnd(8) +
  "replayed".padEnd(11) + "dmg dealt".padEnd(12) + "beat an idle player");

for (const cadence of [2.2, 1.5, 1.0, 0.7]) {
  const bout = recordBout(4242 + Math.round(cadence * 100), cadence);
  const code = encodeBout(bout);
  const back = decodeBout(code);
  if (!back) { console.log(`  ${cadence}s  DECODE FAILED`); fail = true; continue; }

  const direct = replay(bout);
  const viaLink = replay(back);

  console.log(
    "  " + `${cadence}s`.padEnd(10) +
    String(bout.marks.length).padEnd(8) +
    String(BASE + code.length).padEnd(8) +
    `${viaLink.fired}/${viaLink.due}`.padEnd(12) +
    String(viaLink.damage).padEnd(7) +
    `${viaLink.won ? "won" : "survived"}`.padEnd(13) +
    (viaLink.won ? "yes" : "no"),
  );

  if (bout.marks.length < 5) { console.log("     !! recorded almost nothing"); fail = true; }
  if (BASE + code.length > 1800) { console.log("     !! link too long to share"); fail = true; }
  if (viaLink.fired < viaLink.due) {
    console.log(`     !! ${viaLink.due - viaLink.fired} marks came due but never fired`);
    fail = true;
  }
  if (viaLink.fired < 5) { console.log("     !! the replay barely acted"); fail = true; }
  // Quantisation is lossy, but it must not change the character of the round.
  if (Math.abs(viaLink.damage - direct.damage) > 1) {
    console.log(`     !! link changed the outcome: ${direct.damage} damage direct vs ${viaLink.damage} via link`);
    fail = true;
  }
}

console.log("\n  robustness");
console.log("  " + "-".repeat(72));
const good = encodeBout(recordBout(99, 1.2));
const junk = ["", "!!!", "@@@@", "A", "AAAAAAA", good.slice(0, 12), good + "AAAAAA", good.slice(4)];
let threw = 0, rejected = 0;
for (const j of junk) {
  try { if (decodeBout(j) === null) rejected++; } catch { threw++; }
}
console.log(`  malformed codes: ${rejected}/${junk.length} rejected, ${threw} threw`);
if (threw > 0) fail = true;

// A hand-tampered payload must not crash the replay either.
const bytes = [...good];
bytes[9] = "_";
let survived = true;
try {
  const b = decodeBout(bytes.join(""));
  if (b) replay(b);
} catch { survived = false; }
console.log(`  tampered payload replays or is rejected safely: ${survived ? "yes" : "NO"}`);
if (!survived) fail = true;

console.log(fail ? "\n  FAILURES ABOVE\n" : "\n  share links hold up\n");
process.exit(fail ? 1 : 0);
