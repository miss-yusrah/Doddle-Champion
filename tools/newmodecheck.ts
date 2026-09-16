/** Fast behavioural checks for the five added game modes. */
import { GLIDE, STEP_MS, VOLLEY } from "../src/config";
import {
  BridgeDirector, CopycatDirector, HuntDirector, MonsterDirector, VolleyDirector,
} from "../src/game/modes";
import { Round } from "../src/game/round";
import { summarize } from "../src/input/strokes";

let failed = false;
function check(label: string, value: boolean): void {
  console.log(`  ${value ? "✓" : "✗"} ${label}`);
  if (!value) failed = true;
}

console.log("\n  NEW MODES\n");

// Margin Monster loses one segment for each threat that is cleared.
{
  const r = new Round(11);
  r.duelRules = false;
  r.bossRules = true;
  r.bossHp = r.bossMaxHp = 3;
  const d = new MonsterDirector(12);
  for (let i = 0; i < 3; i++) { r.killedThisStep = 1; d.update(r, STEP_MS / 1000); }
  check("Margin Monster can be erased piece by piece", d.finished(r) === "won");
}

// A bottom-player flick must send the ball through the top edge.
{
  const r = new Round(21);
  r.volleyRules = true;
  r.player.hearts = r.ghost.hearts = VOLLEY.hearts;
  const d = new VolleyDirector();
  r.volleyHit("player", summarize([{ x: 0.45, y: 0.7 }, { x: 0.52, y: 0.58 }], 0.14));
  const before = r.ghost.hearts;
  for (let i = 0; i < 200 && r.ghost.hearts === before; i++) { d.update(r); r.step(STEP_MS); }
  check("Doodle Volley scores through the opponent edge", r.ghost.hearts < before);
}

// A line attached to a tear should still count when the tear reaches the runner.
{
  const r = new Round(31);
  r.duelRules = false;
  r.glideRules = true;
  r.bridgeRules = true;
  r.player.pos = { x: GLIDE.runnerX, y: GLIDE.groundY };
  r.bridgeGaps.push({ x: 0.42, width: 0.15, checked: false, bridged: false });
  const d = new BridgeDirector(32);
  r.play("player", "line", summarize([{ x: 0.34, y: 0.88 }, { x: 0.50, y: 0.88 }], 0.16), false);
  const attached = r.bridgeGaps[0].bridged;
  const before = r.player.hearts;
  for (let i = 0; i < 100 && !r.bridgeGaps[0]?.checked; i++) { d.update(r, STEP_MS / 1000); r.step(STEP_MS); }
  check("Drawbridge carries an early bridge with its tear", attached && r.player.hearts === before && r.kills === 1);
}

// Copying a complete sequence advances the chain.
{
  const r = new Round(41);
  r.duelRules = false;
  r.copycatRules = true;
  const d = new CopycatDirector(42);
  d.update(r, STEP_MS / 1000);
  r.copyShowing = 0;
  const sequence = [...r.copySequence];
  const accepted = sequence.every((mark) => r.copycatMark(mark));
  d.update(r, STEP_MS / 1000);
  check("Copycat advances after the exact mark sequence", accepted && r.copyScore === 1);
}

// Ink Hunt is explicitly reveal-then-catch, never a blind tap.
{
  const r = new Round(51);
  r.duelRules = false;
  r.huntRules = true;
  const d = new HuntDirector(52);
  d.update(r, STEP_MS / 1000);
  const target = r.huntTargets[0];
  const atTarget = summarize([
    { x: target.x - 0.04, y: target.y - 0.02 },
    { x: target.x + 0.04, y: target.y + 0.02 },
  ], 0.09);
  const revealed = r.huntMark("cross", atTarget);
  const caught = r.huntMark("line", atTarget);
  check("Ink Hunt requires reveal before catch", revealed === "revealed" && caught === "caught" && r.huntScore === 100);
}

if (failed) process.exit(1);
console.log("\n  all new mode checks passed\n");
