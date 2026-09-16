/**
 * Balance check for the foe modes.
 *
 * Siege should be beatable but not free; Scribble Storm should always end, and
 * end later the better you play. Both are measured with scripted pilots of
 * different skill, since a mode that a bad pilot and a good pilot finish the
 * same way has no skill in it at all.
 *
 *   npx tsx tools/modecheck.ts
 */
import { ENDLESS, GLIDE, PUPPET, SIEGE, STEP_MS } from "../src/config";
import { EndlessDirector, GlideDirector, PuppetDirector, SiegeDirector } from "../src/game/modes";
import { Round } from "../src/game/round";
import { summarize } from "../src/input/strokes";
import type { MarkId } from "../src/input/recognizer";
import type { Foe } from "../src/game/types";

type Pilot = (r: Round, dt: number) => void;

/** Does nothing. Every mode must beat this pilot every time. */
const idle: Pilot = () => {};

/**
 * Draws on a cadence. `smart` aims marks at the foe nearest your baseline;
 * `dumb` scatters them at random.
 */
function pilot(everySec: number, smart: boolean, kit: MarkId[]): Pilot {
  let next = everySec;
  let i = 0;
  return (r: Round) => {
    if (r.time < next) return;
    next = r.time + everySec;
    const g = kit[i++ % kit.length];

    // Foe modes let you build anywhere, so aim at whatever is closest to the
    // baseline: walls and tangles just ahead of it, bombs right on it.
    let x = 0.2 + ((i * 0.17) % 0.6);
    let y = 0.6;
    if (smart) {
      const foes = r.foes as Foe[];
      if (foes.length) {
        const worst = foes.reduce((a, b) => (a.pos.y > b.pos.y ? a : b));
        x = worst.pos.x;
        y = g === "circle" ? worst.pos.y : Math.min(0.9, worst.pos.y + 0.07);
      }
    }
    const a = { x: Math.max(0.06, x - 0.07), y };
    const b = { x: Math.min(0.94, x + 0.07), y: y + 0.01 };
    r.play("player", g, summarize([a, b], 0.15), false);
  };
}

function runSiege(seed: number, p: Pilot): { won: boolean; wave: number; kills: number; secs: number } {
  const r = new Round(seed);
  r.duelRules = false;
  r.player.hearts = SIEGE.hearts;
  r.ghost.hearts = 99;
  const d = new SiegeDirector(seed ^ 0x5bf03635);
  let verdict: "won" | "lost" | null = null;
  while (!verdict && r.time < 400) {
    d.update(r, STEP_MS / 1000);
    p(r, STEP_MS / 1000);
    r.step(STEP_MS);
    verdict = d.finished(r);
  }
  return { won: verdict === "won", wave: Math.min(d.wave, SIEGE.waves), kills: r.kills, secs: r.time };
}

function runEndless(seed: number, p: Pilot): { score: number; secs: number; kills: number } {
  const r = new Round(seed);
  r.duelRules = false;
  r.player.hearts = ENDLESS.hearts;
  r.ghost.hearts = 99;
  const d = new EndlessDirector(seed ^ 0x27d4eb2d);
  while (!d.finished(r) && r.time < 600) {
    d.update(r, STEP_MS / 1000);
    p(r, STEP_MS / 1000);
    r.step(STEP_MS);
  }
  return { score: Math.floor(d.score), secs: r.time, kills: r.kills };
}

function runGlide(seed: number, p: Pilot): { score: number; secs: number; clears: number } {
  const r = new Round(seed);
  r.duelRules = false;
  r.glideRules = true;
  r.player.hearts = GLIDE.hearts;
  r.player.pos = { x: GLIDE.runnerX, y: GLIDE.groundY };
  r.ghost.hearts = 99;
  const d = new GlideDirector(seed ^ 0x6d2b79f5);
  while (!d.finished(r) && r.time < 300) {
    d.update(r, STEP_MS / 1000);
    p(r, STEP_MS / 1000);
    r.step(STEP_MS);
  }
  return { score: Math.floor(d.score), secs: r.time, clears: r.kills };
}

function glidePilot(everySec: number): Pilot {
  let next = 0.5;
  return (r) => {
    if (r.time < next) return;
    next = r.time + everySec;
    const hazard = r.foes
      .filter((f) => f.pos.x > GLIDE.runnerX)
      .reduce<Foe | null>((best, f) => !best || f.pos.x < best.pos.x ? f : best, null);
    if (!hazard) return;
    const groundThreat = hazard.pos.y > 0.67 && hazard.pos.x < 0.62;
    if (groundThreat && r.player.pos.y > 0.63) {
      r.play("player", "arrow", summarize(
        [{ x: 0.12, y: 0.72 }, { x: 0.2, y: 0.62 }], 0.14), false);
      return;
    }
    r.play("player", "line", summarize([
      { x: hazard.pos.x, y: hazard.pos.y - 0.07 },
      { x: hazard.pos.x, y: hazard.pos.y + 0.07 },
    ], 0.14), false);
  };
}

function runPuppet(active: boolean): { verdict: string; secs: number } {
  const r = new Round(77);
  r.puppetRules = true;
  r.player.pos = { x: PUPPET.leftHomeX, y: PUPPET.floorY };
  r.ghost.pos = { x: PUPPET.rightHomeX, y: PUPPET.floorY };
  r.player.home = { ...r.player.pos };
  r.ghost.home = { ...r.ghost.pos };
  const d = new PuppetDirector();
  let nextLeft = 0.3;
  let nextRight = 0.65;
  let verdict: "won" | "lost" | "draw" | null = null;
  while (!verdict && r.time < 50) {
    if (active && r.time >= nextLeft) {
      nextLeft += 0.42;
      r.puppetStrike("player", summarize([{ x: 0.18, y: 0.72 }, { x: 0.43, y: 0.69 }], 0.25));
    }
    if (active && r.time >= nextRight) {
      nextRight += 0.74;
      r.puppetStrike("ghost", summarize([{ x: 0.82, y: 0.72 }, { x: 0.61, y: 0.69 }], 0.21));
    }
    d.update(r, STEP_MS / 1000);
    r.step(STEP_MS);
    verdict = d.finished(r);
  }
  return { verdict: verdict ?? "none", secs: r.time };
}

const N = 60;
const kit: MarkId[] = ["line", "zigzag", "circle", "line", "circle", "line"];
type PilotFactory = () => Pilot;
const PILOTS: Array<[string, PilotFactory]> = [
  ["idle", () => idle],
  ["random 1.4s", () => pilot(1.4, false, kit)],
  ["aimed 1.4s", () => pilot(1.4, true, kit)],
  ["aimed 0.9s", () => pilot(0.9, true, kit)],
];

let fail = false;

console.log(`\n  SIEGE — ${SIEGE.waves} waves, ${SIEGE.hearts} hearts, ${N} runs per pilot\n`);
console.log("  " + "pilot".padEnd(14) + "cleared".padEnd(11) + "avg wave".padEnd(11) + "avg kills".padEnd(12) + "avg length");
console.log("  " + "-".repeat(70));
const siegeWins: number[] = [];
for (const [name, make] of PILOTS) {
  const rs = Array.from({ length: N }, (_, i) => runSiege(3000 + i * 4231, make()));
  const won = rs.filter((r) => r.won).length;
  siegeWins.push(won / N);
  console.log(
    "  " + name.padEnd(14) +
    `${((won / N) * 100).toFixed(0)}%`.padEnd(11) +
    (rs.reduce((a, r) => a + r.wave, 0) / N).toFixed(1).padEnd(11) +
    (rs.reduce((a, r) => a + r.kills, 0) / N).toFixed(0).padEnd(12) +
    `${(rs.reduce((a, r) => a + r.secs, 0) / N).toFixed(0)}s`,
  );
}
if (siegeWins[0] > 0) { console.log("  !! an idle pilot cleared Siege"); fail = true; }
if (siegeWins[3] < 0.25) { console.log("  !! Siege looks unwinnable even played well"); fail = true; }
if (siegeWins[3] <= siegeWins[1]) { console.log("  !! aiming does not beat scattering — no skill in it"); fail = true; }

console.log(`\n  SCRIBBLE STORM — endless, ${ENDLESS.hearts} hearts, ${N} runs per pilot\n`);
console.log("  " + "pilot".padEnd(14) + "avg score".padEnd(12) + "avg survived".padEnd(14) + "avg kills");
console.log("  " + "-".repeat(70));
const scores: number[] = [];
for (const [name, make] of PILOTS) {
  const rs = Array.from({ length: N }, (_, i) => runEndless(6000 + i * 3137, make()));
  const avg = rs.reduce((a, r) => a + r.score, 0) / N;
  scores.push(avg);
  console.log(
    "  " + name.padEnd(14) +
    Math.round(avg).toLocaleString().padEnd(12) +
    `${(rs.reduce((a, r) => a + r.secs, 0) / N).toFixed(1)}s`.padEnd(14) +
    (rs.reduce((a, r) => a + r.kills, 0) / N).toFixed(0),
  );
  if (rs.some((r) => r.secs >= 600)) { console.log(`  !! ${name} never died — the ramp is too soft`); fail = true; }
}
if (!(scores[0] < scores[1] && scores[1] < scores[2] && scores[2] < scores[3])) {
  console.log("  !! score does not rise monotonically with pilot skill");
  fail = true;
}

const GLIDE_N = 24;
console.log(`\n  PAPER GLIDE — auto-run, cape flap, ${GLIDE.hearts} hearts, ${GLIDE_N} runs per pilot\n`);
console.log("  " + "pilot".padEnd(14) + "avg distance".padEnd(16) + "avg survived".padEnd(14) + "avg clears");
console.log("  " + "-".repeat(70));
const glidePilots: Array<[string, PilotFactory]> = [
  ["idle", () => idle],
  ["drawing 1.2s", () => glidePilot(1.2)],
  ["drawing 0.8s", () => glidePilot(0.8)],
];
const glideScores: number[] = [];
for (const [name, make] of glidePilots) {
  const rs = Array.from({ length: GLIDE_N }, (_, i) => runGlide(9000 + i * 2909, make()));
  const avg = rs.reduce((a, r) => a + r.score, 0) / GLIDE_N;
  glideScores.push(avg);
  console.log(
    "  " + name.padEnd(14) +
    `${Math.round(avg)}m`.padEnd(16) +
    `${(rs.reduce((a, r) => a + r.secs, 0) / GLIDE_N).toFixed(1)}s`.padEnd(14) +
    (rs.reduce((a, r) => a + r.clears, 0) / GLIDE_N).toFixed(0),
  );
  if (rs.some((r) => r.secs >= 300)) { console.log(`  !! ${name} never ended — the course is too soft`); fail = true; }
}
if (!(glideScores[0] < glideScores[1] && glideScores[1] <= glideScores[2])) {
  console.log("  !! drawing and faster decisions should improve Paper Glide distance");
  fail = true;
}

console.log("\n  PUPPET BRAWL — jointed local fighters\n");
console.log("  " + "-".repeat(70));
const idlePuppet = runPuppet(false);
const activePuppet = runPuppet(true);
console.log(`  idle bout resolves:  ${idlePuppet.verdict} at ${idlePuppet.secs.toFixed(1)}s`);
console.log(`  active bout resolves: ${activePuppet.verdict} at ${activePuppet.secs.toFixed(1)}s`);
if (idlePuppet.verdict !== "draw" || idlePuppet.secs > PUPPET.roundSec + PUPPET.suddenSec + 0.2) {
  console.log("  !! an untouched puppet bout did not leave sudden death");
  fail = true;
}
if ((activePuppet.verdict !== "won" && activePuppet.verdict !== "lost") || activePuppet.secs >= idlePuppet.secs) {
  console.log("  !! swiping did not produce a decisive puppet fight");
  fail = true;
}

console.log(fail ? "\n  FAILURES ABOVE\n" : "\n  modes look sane\n");
process.exit(fail ? 1 : 0);
