import { DOODLE } from "../config";
import { Rng } from "../core/rng";
import { clamp } from "../core/viewport";
import type { MarkId } from "../input/recognizer";
import type { Stroke } from "../input/strokes";
import type { Round } from "./round";
import type { Bout, MarkRecord } from "./types";

/**
 * Ghost opponents.
 *
 * A ghost is nothing but a recorded mark log played back on the fixed step.
 * Authored opponents are written as a personality and expanded into a concrete
 * log at round start — so they travel through exactly the same replay path a
 * real player's bout will, and harvesting real bouts later needs no new code.
 */

export interface Personality {
  id: string;
  name: string;
  tagline: string;
  /** Gap between marks, milliseconds. */
  tempo: [number, number];
  /** Relative likelihood of each mark. */
  weights: Partial<Record<MarkId, number>>;
  /** How often an ambiguous mark is aimed at the opponent rather than kept home. */
  aggression: number;
}

export const LADDER: Personality[] = [
  {
    id: "scribbles",
    name: "Scribbles",
    tagline: "still working out which end of the pencil draws",
    tempo: [1500, 2400],
    weights: { line: 3, circle: 2, zigzag: 1, arrow: 1 },
    aggression: 0.35,
  },
  {
    id: "spacer",
    name: "Spacer",
    tagline: "sits behind the tangle and lobs",
    tempo: [800, 1400],
    weights: { zigzag: 4, circle: 4, line: 2, arrow: 1, cross: 2 },
    aggression: 0.6,
  },
  {
    id: "capkid",
    name: "Cap Kid",
    tagline: "walls up, waits, and makes you come to him",
    tempo: [950, 1600],
    weights: { line: 5, circle: 3, zigzag: 2, arrow: 1, cross: 1 },
    aggression: 0.4,
  },
  {
    id: "inkja",
    name: "Inkja",
    tagline: "all slash, no patience",
    tempo: [620, 1050],
    weights: { line: 6, arrow: 3, circle: 2, cross: 1 },
    aggression: 0.78,
  },
];

/**
 * Expand a personality into a concrete mark log.
 *
 * Positions are written from the recorder's own perspective — own half is the
 * bottom of the page — which is the same convention a real recorded bout uses.
 */
export function authorBout(p: Personality, seed: number, lengthSec = 75): Bout {
  const rng = new Rng(seed);
  const marks: MarkRecord[] = [];
  const pool: MarkId[] = [];
  for (const [id, w] of Object.entries(p.weights)) {
    for (let i = 0; i < (w ?? 0); i++) pool.push(id as MarkId);
  }

  let t = rng.range(500, 1400);
  while (t < lengthSec * 1000) {
    const g = rng.pick(pool);
    const attacking = rng.next() < p.aggression;
    marks.push(placeMark(g, attacking, rng, t));
    t += rng.range(p.tempo[0], p.tempo[1]);
  }

  return { v: 1, seed, runner: p.id, page: "notebook", marks };
}

function placeMark(g: MarkId, attacking: boolean, rng: Rng, t: number): MarkRecord {
  // "Own half" is the bottom of the page in recorder-space.
  const ownY = () => rng.range(0.58, 0.88);
  const foeY = () => rng.range(0.12, 0.42);

  let x = rng.range(0.18, 0.82);
  let y: number;
  let s = rng.range(0.07, 0.13);
  let r = rng.range(-Math.PI, Math.PI);

  switch (g) {
    case "line":
      y = attacking ? foeY() : ownY();
      if (!attacking) r = rng.range(-0.4, 0.4); // walls sit roughly flat
      break;
    case "circle":
      y = attacking ? foeY() : ownY();
      s = rng.range(0.06, 0.1);
      break;
    case "zigzag":
      y = rng.range(0.55, 0.72);   // tangles guard the approach, not the back line
      break;
    case "arrow":
      y = ownY();
      r = rng.next() < 0.5 ? rng.range(-0.5, 0.5) : rng.range(Math.PI - 0.5, Math.PI + 0.5);
      break;
    case "cross":
      y = rng.range(0.5, 0.8);     // clear whatever just landed in front
      break;
  }

  x = clamp(x, 0.1, 0.9);
  return { t: Math.round(t), g, x, y: y!, s, r };
}

/**
 * Plays a recorded bout back as the opponent.
 *
 * Marks are mirrored into the top half. Bombs are the one place we let the
 * recording bend: a lob is re-aimed at wherever the player actually is, using
 * the recorded position as an offset. A ghost that always threw at empty paper
 * would read as a recording rather than an opponent.
 */
export class GhostDriver {
  private i = 0;

  constructor(readonly bout: Bout) {}

  reset(): void { this.i = 0; }

  /** How many marks have been dispatched so far. */
  get played(): number { return this.i; }

  update(round: Round): void {
    const now = round.time * 1000;
    while (this.i < this.bout.marks.length && this.bout.marks[this.i].t <= now) {
      const m = this.bout.marks[this.i++];
      round.play("ghost", m.g, this.toStroke(m, round), false);
    }
  }

  private toStroke(m: MarkRecord, round: Round): Stroke {
    // Mirror vertically: the recorder's bottom half is the ghost's top half.
    let cx = m.x;
    let cy = 1 - m.y;
    const rot = -m.r;

    const attacking = cy > 0.5;
    if (attacking && m.g === "circle") {
      // Re-aim the lob at the player, keeping the recorded scatter.
      const px = round.player.pos.x;
      const py = round.player.pos.y;
      cx = clamp(px + (m.x - 0.5) * 0.34, 0.08, 0.92);
      cy = clamp(py + ((1 - m.y) - 0.75) * 0.5, 0.55, 0.95);
    }

    const half = Math.max(0.03, m.s);
    const from = { x: cx - Math.cos(rot) * half, y: cy - Math.sin(rot) * half * 0.46 };
    const to = { x: cx + Math.cos(rot) * half, y: cy + Math.sin(rot) * half * 0.46 };

    return {
      pts: [from, to],
      travel: half * 2,
      from,
      to,
      centre: { x: cx, y: cy },
      size: half,
      rot,
      endedAt: 0,
    };
  }
}

/** Where a fresh ghost starts the round. */
export function ghostHome(): { x: number; y: number } {
  return { x: 0.5, y: 1 - DOODLE.homeY };
}
