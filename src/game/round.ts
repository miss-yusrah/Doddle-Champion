import {
  BOMB, COST, DASH, DOODLE, ERASE, FOE, GLIDE, INK, MARK, PUPPET, ROUND, SHIELD, SLASH, TANGLE, WALL,
} from "../config";
import { Rng } from "../core/rng";
import { clamp, dist, dist2, distToSegment, lerp, type Vec } from "../core/viewport";
import type { MarkId } from "../input/recognizer";
import type { Stroke } from "../input/strokes";
import {
  type Bomb, type Doodle, type Entity, type Foe, type FoeType, type MarkRecord,
  type Side, type Slash, type Tangle, type Wall,
} from "./types";

export type RoundOutcome = "playing" | "playerWon" | "ghostWon" | "draw";

export interface MarkFeedback {
  text: string;
  tone: "ink" | "eraser" | "gold";
}

/** What the last player mark resolved into — the coach reads this. */
export type Resolved =
  | "wall" | "slash" | "shot" | "shield" | "bomb" | "tangle" | "dash" | "glide" | "erase";

/**
 * Where a puppet is in its swing. A strike is not instant: it rears back,
 * lands, then leaves you open. That gap is the whole game — without it there is
 * nothing to read and nothing to punish.
 */
export type PuppetPhase =
  | "idle" | "windup" | "active" | "recover" | "guard" | "guardLag";

export interface PuppetMotion {
  vx: number;
  lean: number;
  swing: number;
  swingV: number;
  /** Seconds left in the active window — the renderer reads this. */
  attack: number;
  power: number;
  phase: PuppetPhase;
  /** Seconds left in the current phase. */
  phaseT: number;
  /** A committed swing, as opposed to a jab. */
  heavy: boolean;
}

export interface BridgeGap { x: number; width: number; checked: boolean; bridged: boolean; }
export interface HuntTarget { x: number; y: number; revealed: boolean; dead: boolean; pulse: number; }

/**
 * One 75-second bout. Everything here runs on the fixed step and reads only
 * from the seeded RNG, so the same seed plus the same mark log always produces
 * the same round — which is what makes recorded ghosts work.
 */
export class Round {
  readonly rng: Rng;
  time = 0;                 // seconds since the round started
  outcome: RoundOutcome = "playing";
  entities: Entity[] = [];
  player: Doodle;
  ghost: Doodle;
  /** How far the Eraser has eaten in from each side, 0..0.5. */
  erasure = 0;
  /** Marks the player actually committed, for the replay log. */
  log: MarkRecord[] = [];
  /** Transient message for the HUD ("no ink", "?"). */
  feedback: MarkFeedback | null = null;
  /** What the player's last mark became. */
  lastResolved: Resolved | null = null;

  /** Practice rounds run without the Eraser, the clock or any way to lose. */
  practice = false;
  /** Duel and Same Page decide the winner on hearts; the foe modes don't. */
  duelRules = true;
  /** Paper Glide gives the player gravity and scrolls hazards right-to-left. */
  glideRules = false;
  glideVelocityY = 0;
  /** Side-by-side, swipe-driven wooden puppets with balloon heads. */
  puppetRules = false;
  puppetMotion: Record<Side, PuppetMotion> = {
    player: { vx: 0, lean: 0, swing: 0, swingV: 0, attack: 0, power: 0, phase: "idle", phaseT: 0, heavy: false },
    ghost: { vx: 0, lean: 0, swing: 0, swingV: 0, attack: 0, power: 0, phase: "idle", phaseT: 0, heavy: false },
  };
  bossRules = false;
  bossHp = 18;
  bossMaxHp = 18;
  volleyRules = false;
  volleyBall = { pos: { x: 0.5, y: 0.5 }, vel: { x: 0.12, y: 0.34 }, flash: 0 };
  bridgeRules = false;
  bridgeGaps: BridgeGap[] = [];
  copycatRules = false;
  copySequence: MarkId[] = [];
  copyIndex = 0;
  copyShowing = 0;
  copyScore = 0;
  copyMistakes = 0;
  huntRules = false;
  huntTargets: HuntTarget[] = [];
  huntScore = 0;
  /** Puppet Brawl tallies, for the readout and the balance harness. */
  puppetHit = 0;
  puppetBlock = 0;
  puppetBreak = 0;
  puppetClash = 0;
  /** Kills this round, and foes that got past you — the directors read these. */
  kills = 0;
  leaked = 0;
  /** Set when a kill lands, so a director can bump a combo. */
  killedThisStep = 0;
  /** Score value of those kills; hard foes are worth more than blots. */
  killScoreThisStep = 0;

  private nextId = 1;
  /** The most recent player wall, eligible for promotion into an Erase. */
  private lastWall: Partial<Record<Side, { wall: Wall; at: number; stroke: Stroke }>> = {};

  /** Kept so a finished round can be published as a shareable bout. */
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new Rng(seed);
    this.player = makeDoodle("player", { x: 0.5, y: DOODLE.homeY });
    this.ghost = makeDoodle("ghost", { x: 0.5, y: 1 - DOODLE.homeY });
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  step(dtMs: number): void {
    if (this.outcome !== "playing") return;
    const dt = dtMs / 1000;
    this.time += dt;
    this.killedThisStep = 0;
    this.killScoreThisStep = 0;

    this.stepDoodle(this.player, dt);
    this.stepDoodle(this.ghost, dt);
    if (this.puppetRules) this.stepPuppets(dt);
    if (this.volleyRules) this.stepVolley(dt);
    if (this.bridgeRules) this.stepBridge(dt);
    this.stepEntities(dt);
    this.stepFoes(dt);
    if (this.practice) return;
    if (!this.duelRules) {
      if (this.player.hearts <= 0) this.outcome = "ghostWon";
      return;
    }
    if (!this.puppetRules) this.stepEraser(dt);

    if (this.player.hearts <= 0 || this.ghost.hearts <= 0) {
      if (this.player.hearts <= 0 && this.ghost.hearts <= 0) this.outcome = "draw";
      else if (this.ghost.hearts <= 0) this.outcome = "playerWon";
      else this.outcome = "ghostWon";
    } else if (this.time >= ROUND.lengthSec) {
      // Time never actually expires — the Eraser closes long before — but if it
      // somehow does, more hearts wins it.
      this.outcome =
        this.player.hearts > this.ghost.hearts ? "playerWon"
        : this.ghost.hearts > this.player.hearts ? "ghostWon"
        : "draw";
    }
  }

  private stepDoodle(d: Doodle, dt: number): void {
    d.ink = Math.min(INK.max, d.ink + INK.regenPerSec * dt);
    d.iframes = Math.max(0, d.iframes - dt);
    d.flash = Math.max(0, d.flash - dt);
    d.stun = Math.max(0, d.stun - dt);
    d.bob += dt;

    if (this.glideRules && d.side === "player") {
      this.glideVelocityY += GLIDE.gravity * dt;
      d.pos.y += this.glideVelocityY * dt;
      if (d.pos.y >= GLIDE.groundY) {
        d.pos.y = GLIDE.groundY;
        this.glideVelocityY = 0;
      } else if (d.pos.y <= 0.12) {
        d.pos.y = 0.12;
        this.glideVelocityY = Math.max(0, this.glideVelocityY);
      }
      d.pos.x = GLIDE.runnerX;
    }

    if (d.shield > 0) {
      d.shieldLife -= dt;
      if (d.shieldLife <= 0) d.shield = 0;
    }

    if (d.dashFrom && d.dashTo) {
      d.dashT += dt / DASH.durSec;
      if (d.dashT >= 1) {
        d.pos = { ...d.dashTo };
        d.dashFrom = null;
        d.dashTo = null;
        d.dashT = 0;
      } else {
        // Ease out, so a dash reads as a snap rather than a glide.
        const e = 1 - Math.pow(1 - d.dashT, 3);
        d.pos = {
          x: lerp(d.dashFrom.x, d.dashTo.x, e),
          y: lerp(d.dashFrom.y, d.dashTo.y, e),
        };
        // Tangle catches Dash: run into one and you stop short, briefly stuck.
        for (const e2 of this.entities) {
          if (e2.kind !== "tangle" || e2.dead || e2.side === d.side) continue;
          if (dist2(d.pos, e2.pos) < e2.radius) {
            d.dashFrom = null;
            d.dashTo = null;
            d.dashT = 0;
            d.stun = 0.55;
            this.puff(d.pos, e2.radius * 0.7, "eraser");
            break;
          }
        }
      }
    }
    this.confine(d);
  }

  /** Keep a doodle inside its own half and inside whatever page is left. */
  private confine(d: Doodle): void {
    const lo = this.erasure + DOODLE.radius;
    const hi = 1 - this.erasure - DOODLE.radius;
    d.pos.x = clamp(d.pos.x, Math.min(lo, 0.5), Math.max(hi, 0.5));
    if (this.glideRules && d.side === "player") {
      d.pos.x = GLIDE.runnerX;
      d.pos.y = clamp(d.pos.y, 0.12, GLIDE.groundY);
      return;
    }
    if (this.puppetRules) {
      d.pos.x = clamp(d.pos.x, d.side === "player" ? 0.1 : 0.42, d.side === "player" ? 0.58 : 0.9);
      d.pos.y = PUPPET.floorY;
      return;
    }
    const half = d.side === "player"
      ? { lo: 0.5 + DOODLE.radius * 0.6, hi: 0.97 }
      : { lo: 0.03, hi: 0.5 - DOODLE.radius * 0.6 };
    d.pos.y = clamp(d.pos.y, half.lo, half.hi);
  }

  /**
   * A swipe is the control rod: toward the rival strikes, away raises a guard.
   *
   * How far you swipe decides jab or swing. Nothing happens instantly — the
   * strike is queued as a wind-up, and until the whole swing finishes you
   * cannot start another. That lock-out is what stops the mode being a
   * swipe-rate contest.
   */
  puppetStrike(side: Side, stroke: Stroke): void {
    if (!this.puppetRules || this.outcome !== "playing") return;
    const m = this.puppetMotion[side];
    if (m.phase !== "idle") return;          // still committed to the last one

    const dx = stroke.to.x - stroke.from.x;
    const toward = side === "player" ? dx : -dx;
    const force = Math.min(1, Math.max(0.25, stroke.travel / 0.24));
    const facing = side === "player" ? 1 : -1;
    m.power = force;

    if (toward < -0.01) {
      // Pulled away: guard up.
      m.phase = "guard";
      m.phaseT = PUPPET.guardHold;
      m.heavy = false;
      m.vx -= facing * PUPPET.impulse * 0.5;
      m.swingV -= facing * 3.5;
      return;
    }

    m.heavy = force >= PUPPET.heavyAbove;
    m.phase = "windup";
    m.phaseT = m.heavy ? PUPPET.heavyWindup : PUPPET.lightWindup;
    // Rear back during the wind-up, so the swing is readable before it lands.
    m.swingV -= facing * (m.heavy ? 5.5 : 2.5);
    m.vx += facing * PUPPET.impulse * force * 0.35;
  }

  /** Move a puppet to its next phase. */
  private advancePhase(side: Side): void {
    const m = this.puppetMotion[side];
    const facing = side === "player" ? 1 : -1;
    switch (m.phase) {
      case "windup":
        m.phase = "active";
        m.phaseT = m.heavy ? PUPPET.heavyActive : PUPPET.lightActive;
        // The swing itself, and the lunge that carries it.
        m.swingV += facing * (m.heavy ? 13 : 7);
        m.vx += facing * PUPPET.impulse * m.power;
        break;
      case "active":
        m.phase = "recover";
        m.phaseT = m.heavy ? PUPPET.heavyRecover : PUPPET.lightRecover;
        break;
      case "guard":
        m.phase = "guardLag";
        m.phaseT = PUPPET.guardLag;
        break;
      default:
        m.phase = "idle";
        m.phaseT = 0;
        m.heavy = false;
        break;
    }
  }

  /** A hit cancels whatever the victim was doing, wind-up included. */
  private stun(m: PuppetMotion): void {
    m.phase = "recover";
    m.phaseT = PUPPET.hitstun;
    m.attack = 0;
    m.heavy = false;
  }

  /** Open to being hit: anything but an active swing or a raised guard. */
  private exposed(m: PuppetMotion): boolean {
    return m.phase !== "active" && m.phase !== "guard";
  }

  private stepPuppets(dt: number): void {
    for (const side of ["player", "ghost"] as const) {
      const d = side === "player" ? this.player : this.ghost;
      const m = this.puppetMotion[side];
      const home = side === "player" ? PUPPET.leftHomeX : PUPPET.rightHomeX;

      if (m.phase !== "idle") {
        m.phaseT -= dt;
        if (m.phaseT <= 0) this.advancePhase(side);
      }
      m.attack = m.phase === "active" ? m.phaseT : 0;

      m.vx += (home - d.pos.x) * 2.1 * dt;
      m.vx *= Math.exp(-4.2 * dt);
      d.pos.x += m.vx * dt;
      m.lean += ((m.vx * 0.42) - m.lean) * Math.min(1, dt * 10);
      m.swingV += -m.swing * 25 * dt;
      m.swingV *= Math.exp(-5.5 * dt);
      m.swing += m.swingV * dt;
      m.swing = clamp(m.swing, -1.15, 1.15);
      this.confine(d);
    }

    this.resolvePuppetClash();
  }

  volleyHit(side: Side, stroke: Stroke): boolean {
    if (!this.volleyRules || this.outcome !== "playing") return false;
    const onSide = side === "player" ? this.volleyBall.pos.y >= 0.46 : this.volleyBall.pos.y <= 0.54;
    const nearBall = dist2(this.volleyBall.pos, stroke.centre) <= 0.36;
    if (!onSide || !nearBall) return false;
    const toward = side === "player" ? -1 : 1;
    const dx = clamp((stroke.to.x - stroke.from.x) * 2.2, -0.34, 0.34);
    this.volleyBall.vel.x = dx;
    this.volleyBall.vel.y = toward * (0.48 + Math.min(0.28, stroke.travel));
    this.volleyBall.pos.x = clamp(stroke.centre.x, 0.08, 0.92);
    this.volleyBall.flash = 0.16;
    return true;
  }

  private stepVolley(dt: number): void {
    const b = this.volleyBall;
    b.flash = Math.max(0, b.flash - dt);
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    if (b.pos.x < 0.045 || b.pos.x > 0.955) {
      b.pos.x = clamp(b.pos.x, 0.045, 0.955);
      b.vel.x *= -1;
    }
    if (b.pos.y < 0.035) {
      this.damage(this.ghost, 1);
      this.resetVolley(1);
    } else if (b.pos.y > 0.965) {
      this.damage(this.player, 1);
      this.resetVolley(-1);
    }
  }

  private resetVolley(toward: 1 | -1): void {
    this.volleyBall.pos = { x: 0.5, y: 0.5 };
    this.volleyBall.vel = { x: this.rng.range(-0.16, 0.16), y: toward * 0.32 };
    this.volleyBall.flash = 0.25;
  }

  private stepBridge(dt: number): void {
    for (const gap of this.bridgeGaps) {
      gap.x -= 0.19 * dt;
      if (gap.checked || gap.x > GLIDE.runnerX + 0.02) continue;
      gap.checked = true;
      const airborne = this.player.pos.y < GLIDE.groundY - 0.075;
      if (!gap.bridged && !airborne) this.damage(this.player, 1);
      else {
        this.kills++;
        this.killedThisStep++;
      }
    }
    this.bridgeGaps = this.bridgeGaps.filter((gap) => gap.x > -0.15);
  }

  copycatMark(id: MarkId): boolean {
    if (!this.copycatRules || this.copyShowing > 0 || !this.copySequence.length) return false;
    if (id === this.copySequence[this.copyIndex]) {
      this.copyIndex++;
      return true;
    }
    this.copyMistakes++;
    this.copyIndex = 0;
    this.damage(this.player, 1);
    return false;
  }

  huntMark(id: MarkId, stroke: Stroke): "revealed" | "caught" | "miss" {
    if (!this.huntRules) return "miss";
    let nearest: HuntTarget | null = null;
    let best = 0.2;
    for (const t of this.huntTargets) {
      if (t.dead) continue;
      const d = dist2({ x: t.x, y: t.y }, stroke.centre);
      if (d < best) { best = d; nearest = t; }
    }
    if (!nearest) return "miss";
    if (id === "cross") {
      nearest.revealed = true;
      return "revealed";
    }
    if (nearest.revealed && (id === "line" || id === "circle")) {
      nearest.dead = true;
      this.huntScore += id === "line" ? 100 : 75;
      return "caught";
    }
    return "miss";
  }

  /**
   * Who connects, and what it costs.
   *
   * Heavy breaks a guard and walks away clean. A jab into a guard is punished
   * hard. Two live swings meeting is a clack of rods and no score — which is
   * what stops mirrored play ending every round in a mutual knockout.
   */
  private resolvePuppetClash(): void {
    const pm = this.puppetMotion.player;
    const gm = this.puppetMotion.ghost;
    const gap = this.ghost.pos.x - this.player.pos.x;

    const reachOf = (m: PuppetMotion) =>
      m.heavy ? PUPPET.heavyReach : PUPPET.lightReach;

    const pLive = pm.phase === "active" && gap <= reachOf(pm);
    const gLive = gm.phase === "active" && gap <= reachOf(gm);
    if (!pLive && !gLive) return;

    // Both swinging: the rods meet.
    if (pLive && gLive) {
      pm.phase = "recover"; pm.phaseT = PUPPET.clashRecover; pm.attack = 0;
      gm.phase = "recover"; gm.phaseT = PUPPET.clashRecover; gm.attack = 0;
      pm.vx -= PUPPET.clashBounce * 5;
      gm.vx += PUPPET.clashBounce * 5;
      this.puff({ x: (this.player.pos.x + this.ghost.pos.x) / 2, y: PUPPET.floorY - 0.09 }, 0.07, "ink");
      this.puppetClash++;
      return;
    }

    const attacker: Side = pLive ? "player" : "ghost";
    const am = pLive ? pm : gm;
    const dm = pLive ? gm : pm;
    const victim = pLive ? this.ghost : this.player;
    const victimPos = victim.pos.x;
    const facing = attacker === "player" ? 1 : -1;

    if (dm.phase === "guard") {
      if (am.heavy) {
        // Guard broken.
        this.damage(victim, 1);
        this.stun(dm);
        am.phase = "recover"; am.phaseT = PUPPET.guardBreakRecover; am.attack = 0;
        dm.vx += facing * PUPPET.knockback * 5;
        this.puff({ x: victimPos, y: PUPPET.floorY - 0.075 }, 0.09, "eraser");
        this.puppetBreak++;
      } else {
        // Jab turned aside, and the attacker is left hanging.
        am.phase = "recover"; am.phaseT = PUPPET.blockedStagger; am.attack = 0;
        am.vx -= facing * PUPPET.knockback * 4;
        this.puff({ x: (this.player.pos.x + this.ghost.pos.x) / 2, y: PUPPET.floorY - 0.09 }, 0.06, "gold");
        this.puppetBlock++;
      }
      return;
    }

    if (this.exposed(dm) && victim.iframes <= 0) {
      this.damage(victim, 1);
      this.stun(dm);
      dm.vx += facing * PUPPET.knockback * 5;
      am.phase = "recover";
      am.phaseT = am.heavy ? PUPPET.heavyRecover : PUPPET.lightRecover;
      am.attack = 0;
      this.puff({ x: victimPos, y: PUPPET.floorY - 0.075 },
        0.08, attacker === "player" ? "gold" : "eraser");
      this.puppetHit++;
    }
  }

  private stepEntities(dt: number): void {
    for (const e of this.entities) {
      if (e.dead) continue;
      e.life -= dt;
      if (e.life <= 0) { e.dead = true; continue; }

      if (e.kind === "bomb") this.stepBomb(e, dt);
    }
    this.entities = this.entities.filter((e) => !e.dead);
  }

  private stepBomb(b: Bomb, dt: number): void {
    b.t += dt / b.dur;
    if (b.t < 1) return;
    b.dead = true;

    const target = b.to;
    const foe = b.side === "player" ? this.ghost : this.player;

    // Tangle eats a bomb outright if it comes down inside one.
    for (const e of this.entities) {
      if (e.kind !== "tangle" || e.dead || e.side === b.side) continue;
      if (dist2(target, e.pos) < e.radius) {
        e.eats -= 1;
        if (e.eats <= 0) e.dead = true;
        this.puff(target, e.radius * 0.8, "ink");
        return;
      }
    }

    this.puff(target, BOMB.splash, "eraser");

    // Bomb breaks Wall — it lobs over, and the splash takes the wall with it.
    for (const e of this.entities) {
      if (e.kind !== "wall" || e.dead || e.side === b.side) continue;
      if (distToSegment(target, e.a, e.b) < BOMB.splash) {
        e.dead = true;
        this.puff({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, 0.05, "ink");
      }
    }

    // Splash catches any scribbles standing in it.
    for (const e of this.entities) {
      if (e.kind !== "foe" || e.dead || b.side !== "player") continue;
      if (dist2(e.pos, target) < BOMB.splash + e.radius) this.hurtFoe(e, 2);
    }

    // Dash dodges Bomb — if the doodle left the splash in time, nothing lands.
    if (dist2(foe.pos, target) < BOMB.splash + DOODLE.radius * 0.5) {
      this.damage(foe, BOMB.damage);
    }
  }

  spawnFoe(type: FoeType, x: number): void {
    const spec = FOE[type];
    this.entities.push({
      kind: "foe", id: this.nextId++, side: "ghost", born: this.time,
      life: 999, dead: false,
      type, pos: { x, y: FOE.spawnY },
      hp: spec.hp, maxHp: spec.hp, speed: spec.speed, radius: spec.radius,
      slowed: 0, phase: this.rng.range(0, Math.PI * 2), flash: 0,
    } satisfies Foe);
  }

  spawnGlideHazard(type: FoeType, y: number): void {
    const spec = FOE[type];
    this.entities.push({
      kind: "foe", id: this.nextId++, side: "ghost", born: this.time,
      life: 20, dead: false,
      type, pos: { x: 0.98, y },
      hp: spec.hp, maxHp: spec.hp,
      speed: type === "dart" ? 0.27 : type === "smudge" ? 0.14 : 0.19,
      radius: spec.radius, slowed: 0,
      phase: this.rng.range(0, Math.PI * 2), flash: 0,
    } satisfies Foe);
  }

  get foes(): Foe[] {
    return this.entities.filter((e): e is Foe => e.kind === "foe" && !e.dead);
  }

  private stepFoes(dt: number): void {
    if (this.glideRules) {
      this.stepGlideFoes(dt);
      return;
    }
    for (const f of this.entities) {
      if (f.kind !== "foe" || f.dead) continue;
      f.flash = Math.max(0, f.flash - dt);
      f.slowed = Math.max(0, f.slowed - dt);

      let speed = f.speed;

      // Tangle slows anything crossing it, and eats one outright.
      for (const t of this.entities) {
        if (t.kind !== "tangle" || t.dead || t.side !== "player") continue;
        if (dist2(f.pos, t.pos) < t.radius + f.radius) {
          if (t.eats > 0) {
            t.eats -= 1;
            f.dead = true;
            this.awardFoe(f);
            this.puff(f.pos, f.radius * 1.6, "ink");
            if (t.eats <= 0) t.dead = true;
            break;
          }
          f.slowed = FOE.tangleSlowSec;
        }
      }
      if (f.dead) continue;
      if (f.slowed > 0) speed *= FOE.tangleSlow;

      const nextY = f.pos.y + speed * dt;

      // A wall stops one foe, and both go with it.
      let stopped = false;
      for (const w of this.entities) {
        if (w.kind !== "wall" || w.dead || w.side !== "player") continue;
        if (distToSegment({ x: f.pos.x, y: nextY }, w.a, w.b) < f.radius + WALL.thickness) {
          w.dead = true;
          f.dead = true;
          this.awardFoe(f);
          this.puff(f.pos, f.radius * 1.8, "ink");
          stopped = true;
          break;
        }
      }
      if (stopped) continue;

      f.pos.y = nextY;
      f.pos.x = clamp(
        f.pos.x + Math.sin(this.time * Math.PI * 2 * FOE.wanderHz + f.phase) * FOE.wanderAmp * dt,
        0.06, 0.94,
      );

      // Reaching your baseline costs a heart.
      if (f.pos.y >= FOE.baseline) {
        f.dead = true;
        this.leaked++;
        this.puff({ x: f.pos.x, y: FOE.baseline }, 0.09, "eraser");
        this.damage(this.player, 1);
      }
    }
  }

  private stepGlideFoes(dt: number): void {
    for (const f of this.entities) {
      if (f.kind !== "foe" || f.dead) continue;
      f.flash = Math.max(0, f.flash - dt);
      f.slowed = Math.max(0, f.slowed - dt);

      // A visible pencil gets a beat to finish sketching the obstacle before
      // it joins the scrolling course.
      if (this.time - f.born < 0.58) continue;

      for (const t of this.entities) {
        if (t.kind !== "tangle" || t.dead || t.side !== "player") continue;
        if (dist2(f.pos, t.pos) < t.radius + f.radius) {
          if (t.eats > 0) {
            t.eats--;
            f.dead = true;
            this.awardFoe(f);
            this.puff(f.pos, f.radius * 1.6, "ink");
            if (t.eats <= 0) t.dead = true;
          } else {
            f.slowed = FOE.tangleSlowSec;
          }
          break;
        }
      }
      if (f.dead) continue;

      const speed = f.speed * (f.slowed > 0 ? FOE.tangleSlow : 1);
      const next = { x: f.pos.x - speed * dt, y: f.pos.y };
      for (const w of this.entities) {
        if (w.kind !== "wall" || w.dead || w.side !== "player") continue;
        if (distToSegment(next, w.a, w.b) < f.radius + WALL.thickness) {
          w.dead = true;
          f.dead = true;
          this.awardFoe(f);
          this.puff(f.pos, f.radius * 1.7, "ink");
          break;
        }
      }
      if (f.dead) continue;
      f.pos = next;

      if (dist2(f.pos, this.player.pos) < f.radius + DOODLE.radius * 0.7) {
        f.dead = true;
        this.leaked++;
        this.damage(this.player, 1);
        this.puff(f.pos, f.radius * 1.7, "eraser");
      } else if (f.pos.x < -0.08) {
        // Getting cleanly past an obstacle is worth a small clear bonus.
        f.dead = true;
        this.awardFoe(f);
      }
    }
  }

  /** Damage a foe. Returns true if it died. */
  private hurtFoe(f: Foe, amount: number): boolean {
    f.hp -= amount;
    f.flash = 0.22;
    if (f.hp > 0) return false;
    f.dead = true;
    this.awardFoe(f);
    this.puff(f.pos, f.radius * 1.8, "eraser");
    return true;
  }

  private awardFoe(f: Foe): void {
    this.kills++;
    this.killedThisStep++;
    this.killScoreThisStep += FOE[f.type].score;
  }

  private stepEraser(dt: number): void {
    if (this.time < ROUND.eraserStartSec) return;
    this.erasure = Math.min(ROUND.eraserMax, this.erasure + ROUND.eraserBitePerSec * dt);

    // Anything caught in the rubbed-out margin is gone.
    for (const e of this.entities) {
      if (e.dead) continue;
      const x = e.kind === "wall" ? (e.a.x + e.b.x) / 2
        : e.kind === "bomb" || e.kind === "slash" ? e.to.x
        : e.pos.x;
      if (x < this.erasure || x > 1 - this.erasure) e.dead = true;
    }

    for (const d of [this.player, this.ghost]) {
      if (d.pos.x < this.erasure + DOODLE.radius * 0.4 || d.pos.x > 1 - this.erasure - DOODLE.radius * 0.4) {
        d.hearts -= ROUND.eraserDps * dt;
        d.flash = 0.12;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Marks
  // -------------------------------------------------------------------------

  /**
   * Turn a recognised gesture into an object. Returns true if ink was spent.
   *
   * `record` is false for ghost marks, which are already in a log.
   */
  play(side: Side, id: MarkId, stroke: Stroke, record: boolean): boolean {
    this.lastResolved = null;
    const d = side === "player" ? this.player : this.ghost;
    const cost = COST[id];
    if (d.ink < cost) {
      if (side === "player") this.feedback = { text: "no ink", tone: "eraser" };
      return false;
    }

    /**
     * In a duel the fold decides everything: your half defends, theirs attacks.
     *
     * The foe modes suspend that rule. There is no opponent to slash, and
     * scribbles spend most of their descent in the top half — so if the fold
     * still applied, the cheapest mark would be dead weight for two thirds of
     * the page. Instead you barricade anywhere, and a circle is a shield only
     * when you draw it around yourself.
     */
    const foeMode = !this.duelRules;
    const ownHalf = foeMode
      ? true
      : side === "player" ? stroke.centre.y > 0.5 : stroke.centre.y < 0.5;
    const shieldNotBomb = foeMode
      ? dist2(stroke.centre, d.pos) < SHIELD.radius * 1.9
      : ownHalf;

    // A second crossing line inside the window promotes the last wall into an
    // Erase. Only walls are promotable — a slash has already resolved.
    if (id === "cross") {
      this.retractWall(side);
    }

    d.ink -= cost;
    if (record) {
      this.log.push({
        t: Math.round(this.time * 1000),
        g: id,
        x: stroke.centre.x,
        y: stroke.centre.y,
        s: stroke.size,
        r: stroke.rot,
      });
    }

    let became: Resolved;
    switch (id) {
      case "line":
        if (this.glideRules && !this.bridgeRules && side === "player") {
          this.makeSlash(side, stroke);
          became = "shot";
        } else {
          ownHalf ? this.makeWall(side, stroke) : this.makeSlash(side, stroke);
          became = ownHalf ? "wall" : "slash";
          // A bridge is attached to the tear when it is drawn. The page then
          // carries both left together, so a good early line stays useful.
          if (this.bridgeRules && side === "player" && became === "wall") {
            const nearest = this.bridgeGaps
              .filter((gap) => !gap.checked)
              .sort((a, b) => Math.abs(a.x - stroke.centre.x) - Math.abs(b.x - stroke.centre.x))[0];
            if (nearest && Math.abs(nearest.x - stroke.centre.x) < nearest.width * 1.25) nearest.bridged = true;
          }
        }
        break;
      case "circle":
        shieldNotBomb ? this.makeShield(d) : this.makeBomb(side, stroke);
        became = shieldNotBomb ? "shield" : "bomb";
        break;
      case "zigzag": this.makeTangle(side, stroke); became = "tangle"; break;
      case "arrow":  this.makeDash(d, stroke); became = this.glideRules ? "glide" : "dash"; break;
      case "cross":  this.makeErase(side, stroke); became = "erase"; break;
    }
    this.lastResolved = became;
    return true;
  }

  /** Give back a wall that is being upgraded into an Erase. */
  private retractWall(side: Side): void {
    const l = this.lastWall[side];
    this.lastWall[side] = undefined;
    if (!l) return;
    if (performance.now() - l.at > MARK.crossWindowMs) return;
    l.wall.dead = true;
    const d = side === "player" ? this.player : this.ghost;
    d.ink = Math.min(INK.max, d.ink + COST.line);
    // Drop the wall from the log too, so the replay stays truthful.
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (side === "player" && this.log[i].g === "line") { this.log.splice(i, 1); break; }
    }
  }

  /** Was a wall drawn recently enough that a crossing line should promote it? */
  wallPromotable(side: Side, now: number): boolean {
    const l = this.lastWall[side];
    return !!l && now - l.at <= MARK.crossWindowMs;
  }

  private makeWall(side: Side, s: Stroke): void {
    const len = Math.min(WALL.halfLen, Math.max(0.05, s.size));
    const a = { x: s.centre.x - Math.cos(s.rot) * len, y: s.centre.y - (Math.sin(s.rot) * len) / 2.1667 };
    const b = { x: s.centre.x + Math.cos(s.rot) * len, y: s.centre.y + (Math.sin(s.rot) * len) / 2.1667 };
    const wall: Wall = {
      kind: "wall", id: this.nextId++, side, born: this.time,
      life: WALL.lifeSec, dead: false, a, b, hits: WALL.hits,
    };
    this.entities.push(wall);
    this.lastWall[side] = { wall, at: performance.now(), stroke: s };
  }

  private makeSlash(side: Side, s: Stroke): void {
    const d = side === "player" ? this.player : this.ghost;
    const foe = side === "player" ? this.ghost : this.player;
    const from = { ...d.pos };
    const aim = s.centre;
    const reach = Math.min(SLASH.reach, dist2(from, aim) + 0.06);
    const ang = Math.atan2((aim.y - from.y) * 2.1667, aim.x - from.x);
    const to = { x: from.x + Math.cos(ang) * reach, y: from.y + (Math.sin(ang) * reach) / 2.1667 };

    // Wall stops Slash — the nearest enemy wall in the corridor cuts it short.
    let blocked = false;
    for (const e of this.entities) {
      if (e.kind !== "wall" || e.dead || e.side === side) continue;
      if (segmentsCross(from, to, e.a, e.b)) {
        e.hits -= 1;
        if (e.hits <= 0) e.dead = true;
        blocked = true;
        this.puff({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, 0.045, "ink");
        break;
      }
    }

    // Slash cuts Tangle — it passes straight through and clears it.
    if (!blocked) {
      for (const e of this.entities) {
        if (e.kind !== "tangle" || e.dead || e.side === side) continue;
        if (distToSegment(e.pos, from, to) < e.radius) {
          e.dead = true;
          this.puff(e.pos, e.radius * 0.8, "ink");
        }
      }
      // A slash cuts every scribble along its corridor.
      let cut = 0;
      for (const e of this.entities) {
        if (e.kind !== "foe" || e.dead || side !== "player") continue;
        if (distToSegment(e.pos, from, to) < SLASH.corridor + e.radius) {
          if (this.hurtFoe(e, 1)) cut++;
        }
      }

      if (distToSegment(foe.pos, from, to) < SLASH.corridor + DOODLE.radius * 0.55) {
        this.damage(foe, SLASH.damage);
      } else if (!this.glideRules && cut === 0 && side === "player" && dist2(foe.pos, from) > SLASH.reach) {
        // A slash that stops in mid-air looks broken. Say what happened.
        this.feedback = { text: "too far — dash in", tone: "eraser" };
      }
    }

    this.entities.push({
      kind: "slash", id: this.nextId++, side, born: this.time,
      life: SLASH.lifeSec, dead: false, from, to, blocked,
    } satisfies Slash);
  }

  private makeShield(d: Doodle): void {
    d.shield = SHIELD.absorbs;
    d.shieldLife = SHIELD.lifeSec;
  }

  private makeBomb(side: Side, s: Stroke): void {
    const d = side === "player" ? this.player : this.ghost;
    this.entities.push({
      kind: "bomb", id: this.nextId++, side, born: this.time,
      life: BOMB.travelSec + 0.2, dead: false,
      from: { ...d.pos }, to: { ...s.centre },
      t: 0, dur: BOMB.travelSec,
      arcSign: this.rng.next() < 0.5 ? -1 : 1,
    } satisfies Bomb);
  }

  private makeTangle(side: Side, s: Stroke): void {
    this.entities.push({
      kind: "tangle", id: this.nextId++, side, born: this.time,
      life: TANGLE.lifeSec, dead: false,
      pos: { ...s.centre }, radius: TANGLE.radius, eats: TANGLE.eats,
    } satisfies Tangle);
  }

  private makeDash(d: Doodle, s: Stroke): void {
    if (d.stun > 0) return;
    if (this.glideRules && d.side === "player") {
      this.glideVelocityY = GLIDE.flapVelocity;
      return;
    }
    const ang = s.rot;
    d.dashFrom = { ...d.pos };
    d.dashTo = {
      x: d.pos.x + Math.cos(ang) * DASH.distance,
      y: d.pos.y + (Math.sin(ang) * DASH.distance) / 2.1667,
    };
    d.dashT = 0;
  }

  private makeErase(side: Side, s: Stroke): void {
    // Newest enemy object within reach — newest, so it answers what just landed.
    let best: Entity | null = null;
    for (const e of this.entities) {
      if (e.dead || e.side === side || e.kind === "puff" || e.kind === "slash") continue;
      const p = e.kind === "wall" ? { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }
        : e.kind === "bomb" ? e.to
        : e.pos;
      if (dist2(p, s.centre) > ERASE.radius) continue;
      if (!best || e.born > best.born) best = e;
    }
    if (best) {
      if (best.kind === "foe") { this.hurtFoe(best, 99); return; }
      best.dead = true;
      const p = best.kind === "wall" ? { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 }
        : best.kind === "bomb" ? best.to
        : (best as Tangle).pos;
      this.puff(p, 0.075, "eraser");
    } else {
      this.puff(s.centre, 0.05, "ink");
    }
  }

  private damage(d: Doodle, amount: number): void {
    if (d.iframes > 0) return;
    if (d.shield > 0) {
      d.shield -= 1;
      if (d.shield <= 0) d.shieldLife = 0;
      d.iframes = DOODLE.iframesSec * 0.6;
      this.puff(d.pos, SHIELD.radius, "gold");
      return;
    }
    d.hearts -= amount;
    d.iframes = DOODLE.iframesSec;
    d.flash = DOODLE.hitFlashSec;
  }

  private puff(pos: Vec, radius: number, tone: "ink" | "eraser" | "gold"): void {
    this.entities.push({
      kind: "puff", id: this.nextId++, side: "player", born: this.time,
      life: 0.42, dead: false, pos: { ...pos }, radius, tone,
    });
  }

  /** Seconds until the Eraser arrives, for the HUD. */
  get secondsLeft(): number {
    return Math.max(0, ROUND.eraserStartSec - this.time);
  }
}

function makeDoodle(side: Side, home: Vec): Doodle {
  return {
    side,
    pos: { ...home },
    home: { ...home },
    hearts: ROUND.hearts,
    shield: 0,
    shieldLife: 0,
    iframes: 0,
    flash: 0,
    dashFrom: null,
    dashTo: null,
    dashT: 0,
    stun: 0,
    ink: INK.roundStart,
    bob: Math.random() * 10,
  };
}

/** Do two segments cross? Aspect-corrected so the test matches what's drawn. */
function segmentsCross(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const A = 2.1667;
  const x1 = p1.x, y1 = p1.y * A, x2 = p2.x, y2 = p2.y * A;
  const x3 = p3.x, y3 = p3.y * A, x4 = p4.x, y4 = p4.y * A;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export { dist };
