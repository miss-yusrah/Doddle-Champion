/**
 * Every tunable in one place. Numbers come straight from the design spec —
 * change them here, never inline at the call site.
 */

/** Fixed simulation step. Never varies, regardless of display refresh rate. */
export const STEP_MS = 1000 / 60;

/** Play area is a fixed 9:19.5 rectangle, letterboxed into whatever screen we get. */
export const PLAY_W = 9;
export const PLAY_H = 19.5;
/** Height of the play area expressed in width-units. Used for aspect-correct distance. */
export const ASPECT = PLAY_H / PLAY_W;

export const INK = {
  max: 100,
  regenPerSec: 18,
  roundStart: 50,
} as const;

export const COST = {
  line: 15,
  circle: 30,
  zigzag: 25,
  arrow: 20,
  cross: 35,
} as const;

export const ROUND = {
  hearts: 3,
  lengthSec: 75,
  /** The Eraser arrives here and starts rubbing the page inward. */
  eraserStartSec: 60,
  /** Fraction of the page eaten per second, per edge. */
  eraserBitePerSec: 0.04,
  /** How far in each edge can eat. Must exceed 0.5 - DOODLE.radius so the
   *  last corridor is narrower than a doodle and nobody can wait it out. */
  eraserMax: 0.47,
  /** Damage per second to a doodle caught inside the erasure. */
  eraserDps: 1.4,
  bestOf: 3,
} as const;

export const MARK = {
  /** A stroke longer than this (in width-units) is clamped — keeps the finger from hiding the page. */
  maxTravel: 0.62,
  /**
   * Below this we refuse to guess, and the mark costs nothing.
   *
   * The score now blends template distance with shape features, so this is not
   * the old pure-$1 number. Swept against realistic thumb input
   * (tools/thumbcheck.ts): higher values trade correct reads for retries, and
   * at 0.70 a quarter of strokes do nothing, which feels broken to play. 0.55
   * lands near 80% correct, 8% misread, 12% retry — and a retry costs no ink,
   * while a misread costs ink and hands you the wrong object.
   */
  minScore: 0.55,
  /** A second crossing line inside this window promotes a Wall into an Erase. */
  crossWindowMs: 300,
  /** Ignore taps and specks. */
  minTravel: 0.05,
} as const;

export const WALL = {
  lifeSec: 8,
  hits: 1,
  /** Half-length of the wall segment, in width-units. */
  halfLen: 0.13,
  thickness: 0.012,
} as const;

export const TANGLE = {
  lifeSec: 7,
  radius: 0.115,
  slow: 0.4,      // multiplier applied to a projectile crossing it
  eats: 1,        // projectiles absorbed outright before it thins out
} as const;

export const SHIELD = {
  lifeSec: 3,
  radius: 0.085,
  absorbs: 1,
} as const;

export const BOMB = {
  travelSec: 0.95,
  splash: 0.115,
  damage: 1,
  radius: 0.026,
  /** Peak of the lob arc, in width-units, perpendicular to travel. */
  arc: 0.16,
} as const;

export const SLASH = {
  /**
   * Deliberately short — the gap between two doodles at home is 1.127
   * width-units, so a slash cannot reach across the page. You have to dash in
   * (about three of them), which is what gives Arrow an offensive purpose and
   * makes closing distance a real risk. Raising this to a full-page snipe
   * would make the cheapest mark the best one.
   */
  reach: 0.85,
  damage: 1,
  lifeSec: 0.22,
  /** Half-width of the blade's hit corridor. */
  corridor: 0.03,
} as const;

export const DASH = {
  distance: 0.2,
  durSec: 0.22,
} as const;

export const ERASE = {
  radius: 0.22,
} as const;

export const DOODLE = {
  radius: 0.052,
  /** Resting Y for the player; the opponent mirrors it. */
  homeY: 0.76,
  /** How far from home a doodle may drift. */
  roam: 0.34,
  bobAmp: 0.006,
  bobHz: 0.7,
  hitFlashSec: 0.5,
  /** Invulnerability after taking a hit, so one bomb can't chain. */
  iframesSec: 0.7,
} as const;

/**
 * Scribble foes. Speeds are normalized page-heights per second; the run from
 * the top edge to your baseline is about 0.94 of a page.
 */
export const FOE = {
  blot:   { hp: 1, speed: 0.058, radius: 0.036, score: 100 },
  smudge: { hp: 3, speed: 0.034, radius: 0.052, score: 250 },
  dart:   { hp: 1, speed: 0.115, radius: 0.028, score: 180 },
  /** Reaching here costs you a heart. */
  baseline: 0.95,
  spawnY: 0.04,
  /** Side-to-side wander. */
  wanderAmp: 0.055,
  wanderHz: 0.35,
  tangleSlow: 0.4,
  tangleSlowSec: 2.2,
} as const;

export const SIEGE = {
  waves: 8,
  hearts: 3,
  /** Gap between waves — a breather, and time for ink to come back. */
  breatherSec: 3.5,
} as const;

export const ENDLESS = {
  hearts: 3,
  /** Seconds until spawn pressure doubles. */
  rampSec: 42,
  baseSpawnSec: 2.6,
  minSpawnSec: 0.42,
  timeScorePerSec: 12,
  /** Kills in a row without taking a hit lift the multiplier. */
  comboStep: 6,
  maxCombo: 8,
} as const;

/** Auto-scrolling Paper Glide mode. Values are in normalized page units. */
export const GLIDE = {
  hearts: 3,
  gravity: 0.42,
  flapVelocity: -0.31,
  groundY: 0.84,
  runnerX: 0.22,
  baseSpawnSec: 1.9,
  minSpawnSec: 0.62,
  rampSec: 55,
  distancePerSec: 12,
} as const;

/** Two-player tabletop puppet fight inspired by loose wooden joint toys. */
export const PUPPET = {
  hearts: 4,
  roundSec: 35,
  suddenSec: 8,
  /**
   * Home spacing sits just outside reach, so a lunge closes it and a retreat
   * opens it. Further apart and the two only ever touch mid-lunge, which makes
   * every exchange a matter of who happened to be swinging.
   */
  leftHomeX: 0.38,
  rightHomeX: 0.62,
  floorY: 0.76,
  impulse: 1.15,
  /** Swept for pacing: harder knockback lengthens bouts but lets one style
   *  run away with a matchup, because separation favours whoever reaches
   *  further. 0.20 is where both stay in range. */
  knockback: 0.20,

  /**
   * Jab, swing, and guard.
   *
   * Heavy beats guard, guard beats jab, and jab beats heavy — a jab lands
   * inside a heavy's long wind-up. Every one of those is decided by the phase
   * timings below, so they are the balance knobs for the whole mode.
   */
  heavyAbove: 0.5,          // force above this reads as a committed swing

  lightWindup: 0.09,
  lightActive: 0.11,
  lightRecover: 0.17,
  /** Close to the heavy's reach on purpose: the triangle should resolve on
   *  timing, which two people on a phone can read, not on spacing, which they
   *  cannot. */
  lightReach: 0.19,

  heavyWindup: 0.24,        // the telegraph a jab punishes
  heavyActive: 0.13,
  heavyRecover: 0.44,
  heavyReach: 0.21,

  guardHold: 0.34,
  guardLag: 0.30,

  /** A jab that runs into a guard leaves the attacker wide open. */
  blockedStagger: 0.38,
  /** Breaking a guard with a heavy costs the attacker almost nothing. */
  guardBreakRecover: 0.14,
  /** Two active swings meeting: rods clack, nobody scores. */
  clashRecover: 0.22,
  clashBounce: 0.09,
  /**
   * Taking a hit cancels whatever you were doing.
   *
   * Without this, jabbing someone during their wind-up still eats the swing a
   * moment later, so punishing a telegraph gains nothing and there is no reason
   * ever to jab. Hitstun is what makes the read pay.
   */
  hitstun: 0.34,
} as const;

export const MONSTER = {
  hearts: 3,
  hp: 18,
  baseSpawnSec: 1.65,
  minSpawnSec: 0.58,
} as const;

export const VOLLEY = {
  hearts: 3,
  roundSec: 45,
} as const;

export const BRIDGE = {
  hearts: 3,
  baseGapSec: 2.25,
  minGapSec: 0.82,
  distancePerSec: 10,
} as const;

export const COPYCAT = {
  hearts: 3,
  showSec: 2.1,
  answerSec: 6.5,
} as const;

export const HUNT = {
  hearts: 3,
  lengthSec: 50,
  targetCount: 4,
} as const;

/** Line boil: every stroke is drawn three ways and swapped at 10fps. */
export const BOIL = {
  variants: 3,
  hz: 10,
  jitter: 0.004,
} as const;

export const COLOR = {
  paper:   0xf0efe9,
  ink:     0x22262b,
  /** The opponent is a replay, so it is drawn lighter — you are the solid one. */
  ghost:   0x9298a0,
  ghostScarf: 0xc4a2ac,
  /** Faint washes so each half of the page has a permanent identity. */
  yourHalf: 0xd8a02a,
  theirHalf: 0x5b8dd6,
  soft:    0x9aa0a6,
  gold:    0xd8a02a,
  eraser:  0xd2597a,
  rule:    0xc9d4e0,
  shield:  0x5b8dd6,
  foe:     0x3d4249,
  foeHurt: 0xd2597a,
} as const;
