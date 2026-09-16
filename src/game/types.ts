import type { Vec } from "../core/viewport";
import type { MarkId } from "../input/recognizer";

export type Side = "player" | "ghost";

export function other(s: Side): Side { return s === "player" ? "ghost" : "player"; }

/** One entry in a recorded bout. This is the entire wire format. */
export interface MarkRecord {
  /** Milliseconds from round start. */
  t: number;
  /** Which of the five marks. */
  g: MarkId;
  /** Normalized position, always written from the recorder's own perspective. */
  x: number;
  y: number;
  /** Half-extent, in width-units. */
  s: number;
  /** Rotation, radians. */
  r: number;
}

export interface Bout {
  v: 1;
  seed: number;
  runner: string;
  page: string;
  marks: MarkRecord[];
}

export interface Doodle {
  side: Side;
  pos: Vec;
  home: Vec;
  hearts: number;
  /** Remaining shield absorbs, and how long the bubble has left. */
  shield: number;
  shieldLife: number;
  /** Seconds of invulnerability left after a hit. */
  iframes: number;
  /** Seconds of hit-flash left, for rendering. */
  flash: number;
  /** Dash in progress. */
  dashFrom: Vec | null;
  dashTo: Vec | null;
  dashT: number;
  /** Stun from dashing into a tangle. */
  stun: number;
  ink: number;
  bob: number;
}

export type Entity = Wall | Tangle | Bomb | Slash | Puff | Foe;

export type FoeType = "blot" | "smudge" | "dart";

interface Base {
  id: number;
  side: Side;
  born: number;
  life: number;
  dead: boolean;
}

export interface Wall extends Base {
  kind: "wall";
  a: Vec;
  b: Vec;
  hits: number;
}

export interface Tangle extends Base {
  kind: "tangle";
  pos: Vec;
  radius: number;
  eats: number;
}

export interface Bomb extends Base {
  kind: "bomb";
  from: Vec;
  to: Vec;
  /** 0..1 progress along the lob. */
  t: number;
  dur: number;
  arcSign: number;
}

export interface Slash extends Base {
  kind: "slash";
  from: Vec;
  to: Vec;
  blocked: boolean;
}

/**
 * A scribble crawling down the page toward your baseline. Siege and Endless
 * are built out of these; every one of the five marks answers them somehow.
 */
export interface Foe extends Base {
  kind: "foe";
  type: FoeType;
  pos: Vec;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  /** Seconds of tangle-slow remaining. */
  slowed: number;
  /** Drives the side-to-side wander so they don't march in a straight line. */
  phase: number;
  flash: number;
}

/** Purely cosmetic — splashes, erasures, blocked marks. */
export interface Puff extends Base {
  kind: "puff";
  pos: Vec;
  radius: number;
  tone: "ink" | "eraser" | "gold";
}
