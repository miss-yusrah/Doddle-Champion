import { BRIDGE, COPYCAT, ENDLESS, GLIDE, HUNT, MONSTER, PUPPET, SIEGE, VOLLEY } from "../config";
import { Rng } from "../core/rng";
import type { MarkId } from "../input/recognizer";
import { GhostDriver } from "./ghost";
import type { Round } from "./round";
import type { FoeType } from "./types";

export type ModeId =
  | "duel" | "siege" | "endless" | "glide" | "samepage" | "puppet"
  | "monster" | "volley" | "bridge" | "copycat" | "hunt";

export interface ModeInfo {
  id: ModeId;
  name: string;
  tagline: string;
  blurb: string;
  /** Shown on the home carousel card. */
  accent: "gold" | "eraser" | "shield" | "ink";
  /** Local-storage key for this mode's best result, or null if it has none. */
  bestKey: string | null;
  bestLabel: string;
  experimental?: boolean;
}

export const MODES: ModeInfo[] = [
  {
    id: "duel",
    name: "Duel",
    tagline: "one page, two pencils",
    blurb: "Best of three against a recorded opponent. Climb the ladder from Scribbles to Inkja.",
    accent: "ink",
    bestKey: "dc.best.duel",
    bestLabel: "ladder",
  },
  {
    id: "siege",
    name: "Siege",
    tagline: "hold the bottom of the page",
    blurb: "Eight waves of scribbles crawl down at you. Wall them, tangle them, blow them up.",
    accent: "shield",
    bestKey: "dc.best.siege",
    bestLabel: "best wave",
  },
  {
    id: "endless",
    name: "Scribble Storm",
    tagline: "it never stops coming",
    blurb: "No waves, no mercy. Survive as long as you can and keep the combo alive.",
    accent: "eraser",
    bestKey: "dc.best.endless",
    bestLabel: "best score",
  },
  {
    id: "glide",
    name: "Paper Glide",
    tagline: "run, flap, draw the way through",
    blurb: "A pencil sketches obstacles into your path. Shoot with a line, flap to dodge, or circle-bomb the course clear.",
    accent: "gold",
    bestKey: "dc.best.glide",
    bestLabel: "best distance",
  },
  {
    id: "samepage",
    name: "Same Page",
    tagline: "two players, one phone",
    blurb: "Pass-and-play. Top half is theirs, bottom is yours, both drawing at once.",
    accent: "gold",
    bestKey: null,
    bestLabel: "",
  },
  {
    id: "monster",
    name: "Margin Monster",
    tagline: "erase it piece by piece",
    blurb: "A giant notebook beast draws attacks into the page. Counter its minions and tear down its ink meter.",
    accent: "eraser",
    bestKey: "dc.best.monster",
    bestLabel: "best clear",
  },
  {
    id: "volley",
    name: "Doodle Volley",
    tagline: "flick it across the fold",
    blurb: "Two players, one bouncing inkball. Swipe from your half to return it before it leaves the page.",
    accent: "shield",
    bestKey: null,
    bestLabel: "",
  },
  {
    id: "bridge",
    name: "Drawbridge",
    tagline: "build the road while running",
    blurb: "The paper tears ahead. Draw lines over gaps or flap the cape and clear them in the air.",
    accent: "gold",
    bestKey: "dc.best.bridge",
    bestLabel: "best distance",
  },
  {
    id: "copycat",
    name: "Copycat",
    tagline: "watch the marks, draw them back",
    blurb: "Memorise an expanding mark sequence, then reproduce it before the notebook forgets.",
    accent: "ink",
    bestKey: "dc.best.copycat",
    bestLabel: "best chain",
  },
  {
    id: "hunt",
    name: "Ink Hunt",
    tagline: "find what the paper is hiding",
    blurb: "Cross suspicious wrinkles to reveal hidden inklings, then catch them with a line or circle.",
    accent: "shield",
    bestKey: "dc.best.hunt",
    bestLabel: "best score",
  },
  {
    id: "puppet",
    name: "Puppet Brawl",
    tagline: "two rods, two balloons, no balance",
    blurb: "Two players swipe from opposite sides to lunge, flail wooden limbs, and pop the rival balloon head.",
    accent: "eraser",
    bestKey: null,
    bestLabel: "",
    experimental: true,
  },
];

/** Experimental modes stay available to code/tests without crowding the front door. */
export const PLAY_MODES = MODES.filter((m) => !m.experimental);

export function modeInfo(id: ModeId): ModeInfo {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/** What the HUD shows in place of the duel clock. */
export interface Readout {
  label: string;
  value: string;
  urgent: boolean;
}

export interface Director {
  readonly id: ModeId;
  update(round: Round, dt: number): void;
  readout(round: Round): Readout;
  /** Non-null once the mode itself decides the run is over. */
  finished(round: Round): "won" | "lost" | "draw" | null;
  /** Score or progress worth remembering. */
  result(round: Round): { score: number; headline: string; detail: string };
}

// ---------------------------------------------------------------------------
// Duel — the original. A ghost draws back at you.
// ---------------------------------------------------------------------------

export class DuelDirector implements Director {
  readonly id = "duel" as const;
  constructor(private readonly ghost: GhostDriver) {}

  update(round: Round): void {
    this.ghost.update(round);
  }

  readout(round: Round): Readout {
    const erasing = round.erasure > 0;
    return {
      label: erasing ? "" : "",
      value: erasing ? "ERASING" : String(Math.ceil(round.secondsLeft)),
      urgent: erasing || round.secondsLeft <= 10,
    };
  }

  finished(round: Round): "won" | "lost" | "draw" | null {
    if (round.outcome === "playing") return null;
    return round.outcome === "playerWon" ? "won" : round.outcome === "draw" ? "draw" : "lost";
  }

  result(round: Round): { score: number; headline: string; detail: string } {
    return {
      score: Math.max(0, Math.ceil(round.player.hearts)),
      headline: round.outcome === "playerWon" ? "Erased them!" : "Erased!",
      detail: "",
    };
  }
}

// ---------------------------------------------------------------------------
// Same Page — both halves driven by a human on the same device.
// ---------------------------------------------------------------------------

export class SamePageDirector implements Director {
  readonly id = "samepage" as const;

  update(): void { /* both sides are human; nothing to drive */ }

  readout(round: Round): Readout {
    const erasing = round.erasure > 0;
    return {
      label: "",
      value: erasing ? "ERASING" : String(Math.ceil(round.secondsLeft)),
      urgent: erasing || round.secondsLeft <= 10,
    };
  }

  finished(round: Round): "won" | "lost" | "draw" | null {
    if (round.outcome === "playing") return null;
    return round.outcome === "playerWon" ? "won" : round.outcome === "draw" ? "draw" : "lost";
  }

  result(round: Round): { score: number; headline: string; detail: string } {
    return {
      score: 0,
      headline: round.outcome === "playerWon" ? "Bottom wins!" : "Top wins!",
      detail: "swap ends and go again",
    };
  }
}

// ---------------------------------------------------------------------------
// Puppet Brawl — two local players control loose tabletop fighters.
// ---------------------------------------------------------------------------

export class PuppetDirector implements Director {
  readonly id = "puppet" as const;
  private sudden = false;

  update(round: Round): void {
    if (round.time < PUPPET.roundSec || round.outcome !== "playing") return;
    if (round.player.hearts > round.ghost.hearts) { round.outcome = "playerWon"; return; }
    if (round.ghost.hearts > round.player.hearts) { round.outcome = "ghostWon"; return; }

    // Level on time. Rather than let the clock call it even, both balloons go
    // down to a single breath — the next clean hit ends it.
    if (!this.sudden) {
      this.sudden = true;
      round.player.hearts = 1;
      round.ghost.hearts = 1;
      return;
    }
    if (round.time >= PUPPET.roundSec + PUPPET.suddenSec) round.outcome = "draw";
  }

  get inSuddenDeath(): boolean { return this.sudden; }

  readout(round: Round): Readout {
    const left = PUPPET.roundSec - round.time;
    return {
      label: left <= 0 ? "sudden pop" : "balloon brawl",
      value: left <= 0 ? "POP!" : String(Math.ceil(left)),
      urgent: left <= 5,
    };
  }

  finished(round: Round): "won" | "lost" | "draw" | null {
    if (round.outcome === "playerWon") return "won";
    if (round.outcome === "ghostWon") return "lost";
    if (round.outcome === "draw") return "draw";
    return null;
  }

  result(round: Round): { score: number; headline: string; detail: string } {
    return {
      score: 0,
      headline: round.outcome === "playerWon" ? "Left pops it!" : "Right pops it!",
      detail: "Swap sides, grab the rods, and flail again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Siege — eight waves crawling down the page.
// ---------------------------------------------------------------------------

interface Spawn { at: number; type: FoeType; x: number; }

export class SiegeDirector implements Director {
  readonly id = "siege" as const;
  wave = 0;
  private queue: Spawn[] = [];
  private clock = 0;
  private waveStarted = false;
  private breather = 1.2;
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  /**
   * Wave composition. Blots are the bread and butter, darts punish a slow
   * hand, and smudges need real damage rather than a single wall.
   */
  private build(wave: number): Spawn[] {
    const blots = 3 + Math.floor(wave * 1.4);
    const darts = wave >= 2 ? Math.floor((wave - 1) * 0.9) : 0;
    const smudges = wave >= 4 ? Math.floor((wave - 3) * 0.7) : 0;
    const out: Spawn[] = [];
    const gap = Math.max(0.42, 1.5 - wave * 0.11);
    let t = 0;
    const push = (type: FoeType, n: number) => {
      for (let i = 0; i < n; i++) {
        out.push({ at: t, type, x: this.rng.range(0.12, 0.88) });
        t += this.rng.range(gap * 0.6, gap * 1.4);
      }
    };
    push("blot", blots);
    push("dart", darts);
    push("smudge", smudges);
    out.sort((a, b) => a.at - b.at);
    return out;
  }

  update(round: Round, dt: number): void {
    if (!this.waveStarted) {
      this.breather -= dt;
      if (this.breather > 0) return;
      this.wave++;
      if (this.wave > SIEGE.waves) return;
      this.queue = this.build(this.wave);
      this.clock = 0;
      this.waveStarted = true;
    }

    this.clock += dt;
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const s = this.queue.shift()!;
      round.spawnFoe(s.type, s.x);
    }

    // Wave clears once the queue is empty and the page is too.
    if (this.queue.length === 0 && round.foes.length === 0) {
      this.waveStarted = false;
      this.breather = SIEGE.breatherSec;
    }
  }

  readout(): Readout {
    const w = Math.min(this.wave, SIEGE.waves);
    return {
      label: "wave",
      value: `${Math.max(1, w)}/${SIEGE.waves}`,
      urgent: w >= SIEGE.waves,
    };
  }

  finished(round: Round): "won" | "lost" | null {
    if (round.player.hearts <= 0) return "lost";
    if (this.wave > SIEGE.waves && round.foes.length === 0) return "won";
    return null;
  }

  result(round: Round): { score: number; headline: string; detail: string } {
    const cleared = Math.min(this.wave - (this.waveStarted ? 1 : 0), SIEGE.waves);
    const won = round.player.hearts > 0 && this.wave > SIEGE.waves;
    return {
      score: won ? SIEGE.waves : Math.max(0, cleared),
      headline: won ? "Page held!" : "Overrun!",
      detail: won
        ? `All ${SIEGE.waves} waves, ${round.kills} scribbles erased.`
        : `Wave ${Math.max(1, this.wave)} of ${SIEGE.waves} · ${round.kills} erased.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Scribble Storm — endless, ramping, score-chasing.
// ---------------------------------------------------------------------------

export class EndlessDirector implements Director {
  readonly id = "endless" as const;
  score = 0;
  combo = 1;
  maxCombo = 1;
  private streak = 0;
  private nextSpawn = 1.1;
  private lastHearts: number = ENDLESS.hearts;
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  private spawnGap(t: number): number {
    // Halves roughly every rampSec, floored so it stays playable.
    const k = Math.pow(0.5, t / ENDLESS.rampSec);
    return Math.max(ENDLESS.minSpawnSec, ENDLESS.baseSpawnSec * k);
  }

  update(round: Round, dt: number): void {
    this.score += ENDLESS.timeScorePerSec * this.combo * dt;

    if (round.killedThisStep > 0) {
      this.streak += round.killedThisStep;
      this.combo = Math.min(ENDLESS.maxCombo, 1 + Math.floor(this.streak / ENDLESS.comboStep));
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += round.killScoreThisStep * this.combo;
    }

    // Taking a hit resets the combo — that's the whole tension of the mode.
    if (round.player.hearts < this.lastHearts) {
      this.lastHearts = round.player.hearts;
      this.streak = 0;
      this.combo = 1;
    }

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.nextSpawn = this.spawnGap(round.time) * this.rng.range(0.75, 1.25);
      const roll = this.rng.next();
      const t = round.time;
      const type: FoeType =
        roll < 0.62 ? "blot"
        : roll < (t > 25 ? 0.86 : 0.92) ? "dart"
        : t > 18 ? "smudge" : "blot";
      round.spawnFoe(type, this.rng.range(0.1, 0.9));
    }
  }

  readout(): Readout {
    return {
      label: this.combo > 1 ? `x${this.combo}` : "",
      value: Math.floor(this.score).toLocaleString(),
      urgent: false,
    };
  }

  finished(round: Round): "won" | "lost" | null {
    return round.player.hearts <= 0 ? "lost" : null;
  }

  result(round: Round): { score: number; headline: string; detail: string } {
    return {
      score: Math.floor(this.score),
      headline: "Erased!",
      detail: `${round.kills} scribbles · ${round.time.toFixed(0)}s · best combo x${this.maxCombo}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Paper Glide — an auto-runner where the tick is a cape flap.
// ---------------------------------------------------------------------------

export class GlideDirector implements Director {
  readonly id = "glide" as const;
  score = 0;
  private nextSpawn = 1.4;
  private rng: Rng;

  constructor(seed: number) { this.rng = new Rng(seed); }

  update(round: Round, dt: number): void {
    this.score += GLIDE.distancePerSec * dt;

    this.nextSpawn -= dt;
    if (this.nextSpawn > 0) return;
    const ramp = Math.pow(0.5, round.time / GLIDE.rampSec);
    this.nextSpawn = Math.max(
      GLIDE.minSpawnSec,
      GLIDE.baseSpawnSec * ramp * this.rng.range(0.82, 1.2),
    );

    const roll = this.rng.next();
    const type: FoeType = roll < 0.58 ? "blot" : roll < 0.84 ? "dart" : "smudge";
    // Alternating air and ground hazards require choosing when to flap.
    const y = this.rng.next() < 0.48
      ? this.rng.range(0.3, 0.58)
      : this.rng.range(0.72, GLIDE.groundY);
    round.spawnGlideHazard(type, y);
  }

  readout(): Readout {
    return { label: "distance", value: `${Math.floor(this.score)}m`, urgent: false };
  }

  finished(round: Round): "won" | "lost" | null {
    return round.player.hearts <= 0 ? "lost" : null;
  }

  result(round: Round): { score: number; headline: string; detail: string } {
    return {
      score: Math.floor(this.score),
      headline: "Cape down!",
      detail: `${Math.floor(this.score)}m · ${round.kills} obstacles cleared · ${round.time.toFixed(0)}s on the run`,
    };
  }
}

// ---------------------------------------------------------------------------
// Margin Monster — a solo boss assembled from the same descending threats.
// ---------------------------------------------------------------------------

export class MonsterDirector implements Director {
  readonly id = "monster" as const;
  private nextSpawn = 0.8;
  private rng: Rng;

  constructor(seed: number) { this.rng = new Rng(seed); }

  update(round: Round, dt: number): void {
    if (round.killedThisStep) round.bossHp = Math.max(0, round.bossHp - round.killedThisStep);
    if (round.bossHp <= 0) { round.outcome = "playerWon"; return; }
    this.nextSpawn -= dt;
    if (this.nextSpawn > 0) return;
    const rage = 1 - round.bossHp / round.bossMaxHp;
    this.nextSpawn = Math.max(MONSTER.minSpawnSec, MONSTER.baseSpawnSec - rage * 0.85) * this.rng.range(0.82, 1.2);
    const roll = this.rng.next();
    const type: FoeType = roll < 0.58 ? "blot" : roll < 0.82 ? "dart" : "smudge";
    round.spawnFoe(type, this.rng.range(0.1, 0.9));
  }

  readout(round: Round): Readout {
    return { label: "monster ink", value: `${round.bossHp}/${round.bossMaxHp}`, urgent: round.bossHp <= 5 };
  }

  finished(round: Round): "won" | "lost" | null {
    if (round.bossHp <= 0) return "won";
    if (round.player.hearts <= 0) return "lost";
    return null;
  }

  result(round: Round) {
    const won = round.bossHp <= 0;
    return {
      score: won ? Math.max(1, Math.round(3000 + round.player.hearts * 800 - round.time * 10)) : round.kills,
      headline: won ? "Margin cleared!" : "Monster wins!",
      detail: won ? `${round.time.toFixed(0)}s · ${Math.ceil(round.player.hearts)} hearts left` : `${round.kills} pieces erased`,
    };
  }
}

// ---------------------------------------------------------------------------
// Doodle Volley — simultaneous local swipes return one inkball.
// ---------------------------------------------------------------------------

export class VolleyDirector implements Director {
  readonly id = "volley" as const;
  update(round: Round): void {
    if (round.time < VOLLEY.roundSec || round.outcome !== "playing") return;
    round.outcome = round.player.hearts > round.ghost.hearts ? "playerWon"
      : round.ghost.hearts > round.player.hearts ? "ghostWon" : "draw";
  }
  readout(round: Round): Readout {
    return { label: "inkball", value: String(Math.max(0, Math.ceil(VOLLEY.roundSec - round.time))), urgent: round.time > VOLLEY.roundSec - 6 };
  }
  finished(round: Round): "won" | "lost" | "draw" | null {
    if (round.outcome === "playing") return null;
    return round.outcome === "playerWon" ? "won" : round.outcome === "ghostWon" ? "lost" : "draw";
  }
  result(round: Round) {
    return { score: 0, headline: round.outcome === "playerWon" ? "Bottom scores!" : "Top scores!", detail: "Flick the inkball back across the fold." };
  }
}

// ---------------------------------------------------------------------------
// Drawbridge — Paper Glide's planning sibling: bridge or jump each tear.
// ---------------------------------------------------------------------------

export class BridgeDirector implements Director {
  readonly id = "bridge" as const;
  score = 0;
  private nextGap = 1.25;
  private rng: Rng;
  constructor(seed: number) { this.rng = new Rng(seed); }
  update(round: Round, dt: number): void {
    this.score += BRIDGE.distancePerSec * dt;
    this.nextGap -= dt;
    if (this.nextGap <= 0) {
      const ramp = Math.min(1.2, round.time / 70);
      this.nextGap = Math.max(BRIDGE.minGapSec, BRIDGE.baseGapSec - ramp) * this.rng.range(0.85, 1.2);
      round.bridgeGaps.push({ x: 1.02, width: this.rng.range(0.11, 0.19), checked: false, bridged: false });
    }
  }
  readout(): Readout { return { label: "distance", value: `${Math.floor(this.score)}m`, urgent: false }; }
  finished(round: Round): "won" | "lost" | null { return round.player.hearts <= 0 ? "lost" : null; }
  result(round: Round) {
    return { score: Math.floor(this.score), headline: "Torn page!", detail: `${Math.floor(this.score)}m · ${round.kills} gaps cleared` };
  }
}

// ---------------------------------------------------------------------------
// Copycat — an expanding mark-memory chain.
// ---------------------------------------------------------------------------

const COPY_MARKS: Exclude<MarkId, "cross">[] = ["line", "circle", "zigzag", "arrow"];
const COPY_GLYPH: Record<Exclude<MarkId, "cross">, string> = {
  line: "—", circle: "◯", zigzag: "⌇", arrow: "✓",
};

export class CopycatDirector implements Director {
  readonly id = "copycat" as const;
  private rng: Rng;
  private answerLeft: number = COPYCAT.answerSec;
  constructor(seed: number) { this.rng = new Rng(seed); }

  private begin(round: Round): void {
    const len = Math.min(8, 2 + Math.floor(round.copyScore / 2));
    round.copySequence = Array.from({ length: len }, () => this.rng.pick(COPY_MARKS));
    round.copyIndex = 0;
    round.copyShowing = COPYCAT.showSec + len * 0.18;
    this.answerLeft = COPYCAT.answerSec + len * 0.35;
  }

  update(round: Round, dt: number): void {
    if (!round.copySequence.length) this.begin(round);
    if (round.copyShowing > 0) { round.copyShowing = Math.max(0, round.copyShowing - dt); return; }
    if (round.copyIndex >= round.copySequence.length) {
      round.copyScore++;
      this.begin(round);
      return;
    }
    this.answerLeft -= dt;
    if (this.answerLeft <= 0) {
      round.player.hearts--;
      this.begin(round);
    }
  }

  readout(round: Round): Readout {
    if (round.copyShowing > 0) {
      const value = round.copySequence.map((m) => COPY_GLYPH[m as Exclude<MarkId, "cross">]).join(" ");
      return { label: "remember", value, urgent: false };
    }
    return { label: "your turn", value: `${round.copyIndex + 1}/${round.copySequence.length}`, urgent: this.answerLeft < 2 };
  }
  finished(round: Round): "won" | "lost" | null { return round.player.hearts <= 0 ? "lost" : null; }
  result(round: Round) {
    return { score: round.copyScore, headline: "Chain broken!", detail: `${round.copyScore} sequences · ${round.copyMistakes} wrong marks` };
  }
}

// ---------------------------------------------------------------------------
// Ink Hunt — reveal hidden targets with Cross, then catch them.
// ---------------------------------------------------------------------------

export class HuntDirector implements Director {
  readonly id = "hunt" as const;
  private rng: Rng;
  constructor(seed: number) { this.rng = new Rng(seed); }

  private spawn(round: Round): void {
    round.huntTargets.push({
      x: this.rng.range(0.13, 0.87), y: this.rng.range(0.2, 0.84),
      revealed: false, dead: false, pulse: 0,
    });
  }

  update(round: Round, dt: number): void {
    while (round.huntTargets.filter((t) => !t.dead).length < HUNT.targetCount) this.spawn(round);
    for (const target of round.huntTargets) {
      if (target.dead) continue;
      target.pulse += dt;
      if (target.pulse > 9) {
        target.dead = true;
        round.player.hearts--;
      }
    }
    if (round.time >= HUNT.lengthSec && round.outcome === "playing") round.outcome = "playerWon";
  }
  readout(round: Round): Readout {
    return { label: "caught", value: `${round.huntScore}`, urgent: HUNT.lengthSec - round.time < 8 };
  }
  finished(round: Round): "won" | "lost" | null {
    if (round.player.hearts <= 0) return "lost";
    if (round.time >= HUNT.lengthSec) return "won";
    return null;
  }
  result(round: Round) {
    return { score: round.huntScore, headline: round.player.hearts > 0 ? "Hunt complete!" : "They escaped!", detail: `${round.huntScore} ink points found` };
  }
}
