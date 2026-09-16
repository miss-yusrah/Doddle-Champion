import { Container, Graphics } from "pixi.js";
import { BOMB, COLOR, DOODLE, FOE, GLIDE, PUPPET, SHIELD, TANGLE } from "../config";
import type { Viewport } from "../core/viewport";
import type { Pt } from "../input/recognizer";
import type { Round } from "../game/round";
import type { Doodle, Entity } from "../game/types";

export type Half = "own" | "theirs" | null;
import { boilFrame, wobX, wobY } from "./boil";

/**
 * Draws the whole page. Two layers: the paper, which only changes on resize,
 * and everything else, rebuilt each frame — bombs move, so there is nothing to
 * gain by caching them.
 */
export class Scene {
  readonly root = new Container();
  private paper = new Graphics();
  private dyn = new Graphics();

  constructor(private readonly vp: Viewport) {
    this.root.addChild(this.paper, this.dyn);
  }

  /** Paper, ruled lines and the fold. Called on resize only. */
  drawPage(): void {
    const g = this.paper;
    const { left, top, width, height } = this.vp;
    g.clear();

    g.rect(left, top, width, height).fill({ color: COLOR.paper });

    // Feint ruling, the way a notebook actually is.
    const lines = 26;
    for (let i = 1; i < lines; i++) {
      const y = top + (i / lines) * height;
      g.moveTo(left + width * 0.06, y).lineTo(left + width * 0.96, y);
    }
    g.stroke({ width: 1, color: COLOR.rule, alpha: 0.5 });

    // Margin.
    const mx = left + width * 0.1;
    g.moveTo(mx, top).lineTo(mx, top + height);
    g.stroke({ width: 1.5, color: COLOR.eraser, alpha: 0.28 });

    // Each half gets a permanent wash. It is the cheapest possible answer to
    // "which one am I?" and it never has to be dismissed.
    g.rect(left, top, width, height / 2).fill({ color: COLOR.theirHalf, alpha: 0.05 });
    g.rect(left, top + height / 2, width, height / 2).fill({ color: COLOR.yourHalf, alpha: 0.07 });

    // The fold — nothing but projectiles crosses it.
    this.dash(g, left + width * 0.04, top + height / 2, left + width * 0.96, top + height / 2, 10, 8);
    g.stroke({ width: 1.5, color: COLOR.ink, alpha: 0.22 });
  }

  /** Dim everything except the half the coach is asking the player to use. */
  private drawHighlight(g: Graphics, half: Half, nowMs: number): void {
    const { left, top, width, height } = this.vp;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 380);
    const y = half === "own" ? top + height / 2 : top;
    g.rect(left, y, width, height / 2)
      .fill({ color: half === "own" ? COLOR.yourHalf : COLOR.theirHalf, alpha: 0.07 + 0.05 * pulse });
    g.rect(left, y, width, height / 2)
      .stroke({ width: 3, color: half === "own" ? COLOR.gold : COLOR.shield, alpha: 0.35 + 0.25 * pulse });
  }

  draw(round: Round, wet: Pt[][], nowMs: number, highlight: Half = null): void {
    const g = this.dyn;
    const f = boilFrame(nowMs);
    g.clear();

    if (highlight) this.drawHighlight(g, highlight, nowMs);
    if (round.glideRules) this.drawGlideTrack(g, round);
    else if (round.puppetRules) this.drawPuppetArena(g);
    else if (!round.duelRules && !round.copycatRules && !round.huntRules) this.drawBaseline(g, round, nowMs);
    if (round.bossRules) this.drawMarginMonster(g, round);
    if (round.volleyRules) this.drawVolley(g, round);
    if (round.bridgeRules) this.drawBridgeGaps(g, round);
    if (round.huntRules) this.drawHunt(g, round);
    this.drawErasure(g, round.erasure);

    for (const e of round.entities) this.drawEntity(g, e, f, round);
    if (round.glideRules) this.drawCoursePencil(g, round);

    if (round.puppetRules) {
      this.drawPuppet(g, round.player, round);
      this.drawPuppet(g, round.ghost, round);
    } else {
      // Siege and Scribble Storm have no opponent — only the scribbles.
      if (round.duelRules) this.drawDoodle(g, round.ghost, f, round);
      this.drawDoodle(g, round.player, f, round);
    }

    for (const trail of wet) if (trail.length > 1) this.drawWet(g, trail);
  }

  /** Moving ruled-paper scraps sell forward speed while the doodle stays readable. */
  private drawGlideTrack(g: Graphics, round: Round): void {
    const { left, width } = this.vp;
    const ground = this.sy(0.9);

    // Three parallax bands make the paper travel instead of leaving the
    // runner looking as if they are sliding in place.
    for (const band of [
      { y: 0.2, speed: 0.17, gap: 0.34, len: 0.09, alpha: 0.12 },
      { y: 0.47, speed: 0.29, gap: 0.27, len: 0.12, alpha: 0.17 },
      { y: 0.72, speed: 0.43, gap: 0.22, len: 0.08, alpha: 0.22 },
    ]) {
      const offset = (round.time * band.speed) % band.gap;
      for (let x = -offset; x < 1.1; x += band.gap) {
        const wave = Math.sin((x + round.time * 0.7) * 8) * 0.012;
        g.moveTo(this.sx(x), this.sy(band.y + wave))
          .lineTo(this.sx(x + band.len), this.sy(band.y + wave));
      }
      g.stroke({ width: 2, color: COLOR.shield, alpha: band.alpha, cap: "round" });
    }

    // Page-edge streaks flash by at speed near the floor.
    const streakOffset = (round.time * 0.7) % 0.18;
    for (let x = -streakOffset; x < 1.1; x += 0.18) {
      g.moveTo(this.sx(x), ground - 4).lineTo(this.sx(x + 0.08), ground - 4);
    }
    g.stroke({ width: 2.5, color: COLOR.ink, alpha: 0.18, cap: "round" });

    g.moveTo(left, ground).lineTo(left + width, ground);
    g.stroke({ width: 4, color: COLOR.ink, alpha: 0.5 });
    const offset = (round.time * 0.42) % 0.22;
    for (let x = -offset; x < 1.15; x += 0.22) {
      const sx = this.sx(x);
      g.moveTo(sx, ground + 8).lineTo(sx + this.px(0.1), ground + 8);
    }
    g.stroke({ width: 3, color: COLOR.gold, alpha: 0.6, cap: "round" });
  }

  /** Exactly one pencil draws the newest obstacle, then leaves the course. */
  private drawCoursePencil(g: Graphics, round: Round): void {
    const target = round.foes
      .filter((foe) => round.time - foe.born < 0.58)
      .sort((a, b) => b.born - a.born)[0];
    if (!target) return;

    const t = Math.max(0, Math.min(1, (round.time - target.born) / 0.58));
    const r = this.vp.toScreenLen(target.radius);
    const cx = this.sx(target.pos.x), cy = this.sy(target.pos.y);
    const angle = t * Math.PI * 3.7;
    const tipX = cx + Math.cos(angle) * r * (0.45 + t * 0.65);
    const tipY = cy + Math.sin(angle) * r * (0.45 + t * 0.65);
    const arrive = 1 - Math.pow(1 - Math.min(1, t * 3), 3);
    const leave = t > 0.82 ? (t - 0.82) / 0.18 : 0;
    const drift = (1 - arrive) * 34 + leave * 42;

    const x1 = tipX + 5 + drift, y1 = tipY - 5 - drift;
    const x2 = x1 + 25, y2 = y1 - 25;
    g.moveTo(x2, y2).lineTo(x1, y1);
    g.stroke({ width: 8, color: COLOR.gold, alpha: 0.96, cap: "square" });
    g.moveTo(x2 + 1, y2 - 1).lineTo(x2 - 5, y2 + 5);
    g.stroke({ width: 9, color: COLOR.eraser, alpha: 0.96, cap: "square" });
    g.moveTo(x1, y1).lineTo(tipX, tipY);
    g.stroke({ width: 5, color: 0xe5c59a, alpha: 0.98, cap: "round" });
    g.circle(tipX, tipY, 2.4).fill({ color: COLOR.ink, alpha: 0.98 });
  }

  private drawPuppetArena(g: Graphics): void {
    const ground = this.sy(PUPPET.floorY + 0.075);
    g.moveTo(this.sx(0.05), ground).lineTo(this.sx(0.95), ground);
    g.stroke({ width: 4, color: 0x8f6039, alpha: 0.5, cap: "round" });
    this.dash(g, this.sx(0.5), this.sy(0.18), this.sx(0.5), ground, 9, 10);
    g.stroke({ width: 2, color: COLOR.eraser, alpha: 0.25 });
  }

  private drawMarginMonster(g: Graphics, round: Round): void {
    const hurt = 1 - round.bossHp / round.bossMaxHp;
    const cx = this.sx(0.5), cy = this.sy(0.16);
    const r = this.vp.toScreenLen(0.105 + Math.sin(round.time * 3) * 0.004);
    const col = hurt > 0.72 ? COLOR.eraser : COLOR.ink;

    // Notebook dragon/octopus hybrid: every lost hit removes an outer loop.
    const loops = Math.max(2, Math.ceil((round.bossHp / round.bossMaxHp) * 8));
    for (let arm = 0; arm < loops; arm++) {
      const a = (arm / loops) * Math.PI * 2 + round.time * 0.12;
      const x1 = cx + Math.cos(a) * r * 0.65;
      const y1 = cy + Math.sin(a) * r * 0.45;
      const x2 = cx + Math.cos(a + Math.sin(round.time * 2 + arm) * 0.2) * r * 1.55;
      const y2 = cy + Math.sin(a) * r * 1.2;
      g.moveTo(x1, y1).quadraticCurveTo((x1 + x2) / 2 + Math.sin(arm) * 9, (y1 + y2) / 2, x2, y2);
    }
    g.stroke({ width: 5, color: col, alpha: 0.72, cap: "round" });
    g.circle(cx, cy, r).fill({ color: COLOR.paper, alpha: 0.92 });
    g.circle(cx, cy, r).stroke({ width: 5, color: col, alpha: 0.9 });
    g.circle(cx - r * 0.35, cy - r * 0.08, 5).fill({ color: col });
    g.circle(cx + r * 0.35, cy - r * 0.08, 5).fill({ color: col });
    g.moveTo(cx - r * 0.38, cy + r * 0.32).quadraticCurveTo(cx, cy + r * (0.55 - hurt * 0.45), cx + r * 0.38, cy + r * 0.32);
    g.stroke({ width: 4, color: col, cap: "round" });

    const barW = this.vp.toScreenLen(0.3);
    const barY = cy + r * 1.45;
    g.rect(cx - barW / 2, barY, barW, 9).fill({ color: COLOR.paper }).stroke({ width: 2, color: COLOR.ink });
    g.rect(cx - barW / 2 + 2, barY + 2, (barW - 4) * Math.max(0, round.bossHp / round.bossMaxHp), 5)
      .fill({ color: COLOR.eraser });
  }

  private drawVolley(g: Graphics, round: Round): void {
    const foldY = this.sy(0.5);
    const cx = this.sx(0.5);
    g.moveTo(cx - 18, foldY - 12).lineTo(cx - 18, foldY + 12);
    g.moveTo(cx + 18, foldY - 12).lineTo(cx + 18, foldY + 12);
    for (let x = -14; x <= 14; x += 7) g.moveTo(cx + x, foldY - 10).lineTo(cx + x, foldY + 10);
    g.stroke({ width: 2, color: COLOR.ink, alpha: 0.42 });
    const b = round.volleyBall;
    const x = this.sx(b.pos.x), y = this.sy(b.pos.y);
    const r = this.vp.toScreenLen(0.035) * (b.flash > 0 ? 1.2 : 1);
    g.circle(x + 5, y + 7, r).fill({ color: COLOR.ink, alpha: 0.12 });
    g.circle(x, y, r).fill({ color: COLOR.gold, alpha: 0.95 }).stroke({ width: 3, color: COLOR.ink });
    g.moveTo(x - r * 0.45, y).lineTo(x + r * 0.45, y);
    g.moveTo(x, y - r * 0.45).lineTo(x, y + r * 0.45);
    g.stroke({ width: 2, color: COLOR.ink, alpha: 0.65 });
  }

  private drawBridgeGaps(g: Graphics, round: Round): void {
    const groundY = this.sy(0.9);
    for (const gap of round.bridgeGaps) {
      const x = this.sx(gap.x);
      const w = this.vp.toScreenLen(gap.width);
      if (gap.bridged && !gap.checked) {
        g.moveTo(x - w * 0.62, groundY - 7).lineTo(x + w * 0.62, groundY - 7);
        g.stroke({ width: 7, color: COLOR.gold, alpha: 0.92, cap: "round" });
        g.moveTo(x - w * 0.58, groundY - 10).lineTo(x + w * 0.56, groundY - 5);
        g.stroke({ width: 2.5, color: COLOR.ink, alpha: 0.85, cap: "round" });
      }
      g.moveTo(x - w / 2, groundY - 7)
        .lineTo(x - w * 0.25, groundY + 10)
        .lineTo(x, groundY - 2)
        .lineTo(x + w * 0.22, groundY + 12)
        .lineTo(x + w / 2, groundY - 7)
        .lineTo(x + w / 2, groundY + 28)
        .lineTo(x - w / 2, groundY + 28)
        .closePath();
      g.fill({ color: COLOR.ink, alpha: gap.checked ? 0.18 : gap.bridged ? 0.35 : 0.72 });
    }
  }

  private drawHunt(g: Graphics, round: Round): void {
    for (const target of round.huntTargets) {
      if (target.dead) continue;
      const x = this.sx(target.x), y = this.sy(target.y);
      const pulse = 0.75 + Math.sin(round.time * 5 + target.x * 11) * 0.25;
      if (!target.revealed) {
        g.moveTo(x - 14, y).quadraticCurveTo(x - 6, y - 5 * pulse, x, y)
          .quadraticCurveTo(x + 7, y + 5 * pulse, x + 15, y);
        g.stroke({ width: 2, color: COLOR.soft, alpha: 0.2 + target.pulse / 30, cap: "round" });
        continue;
      }
      const r = this.vp.toScreenLen(0.035);
      g.circle(x, y, r).fill({ color: COLOR.ink, alpha: 0.85 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + round.time;
        g.moveTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7)
          .lineTo(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35);
      }
      g.stroke({ width: 2.5, color: COLOR.eraser, alpha: 0.8, cap: "round" });
      g.circle(x - r * 0.3, y - 2, 2).fill({ color: COLOR.paper });
      g.circle(x + r * 0.3, y - 2, 2).fill({ color: COLOR.paper });
    }
  }

  /** Loose jointed fighter with a control rod and a balloon for a head. */
  private drawPuppet(g: Graphics, d: Doodle, round: Round): void {
    const left = d.side === "player";
    const dir = left ? 1 : -1;
    const m = round.puppetMotion[d.side];
    const s = this.vp.toScreenLen(DOODLE.radius * 1.18);
    const fallen = d.hearts <= 0;
    const fall = fallen ? dir * 1.15 : 0;
    const cx = this.sx(d.pos.x);
    const floor = this.sy(PUPPET.floorY + 0.06);
    const run = Math.sin(round.time * 17 + (left ? 0 : Math.PI)) * Math.min(1, Math.abs(m.vx) * 2.8);
    const lean = fallen ? Math.sin(fall) * s * 1.7 : m.lean * s * 2.2;
    const hip = { x: cx, y: floor - s * 0.72 };
    const shoulder = {
      x: hip.x + lean,
      y: hip.y - (fallen ? s * 0.2 : s * 1.12),
    };
    const head = {
      x: shoulder.x + lean * 0.22,
      y: shoulder.y - (fallen ? s * 0.2 : s * 1.08),
    };
    const wood = 0xb77a45;
    const darkWood = 0x734522;
    const joint = COLOR.eraser;

    // The long side rod is the physical control shown in the reference.
    const rodX = left ? this.sx(0.01) : this.sx(0.99);
    const rodY = this.sy(0.63);
    g.moveTo(rodX, rodY).lineTo(shoulder.x, shoulder.y + s * 0.3);
    g.stroke({ width: 4, color: darkWood, alpha: 0.72, cap: "round" });

    // Torso and hinged legs.
    g.moveTo(shoulder.x, shoulder.y).lineTo(hip.x, hip.y);
    const rearFoot = { x: hip.x - dir * s * (0.75 + run * 0.3), y: floor };
    const frontFoot = { x: hip.x + dir * s * (0.85 + run * 0.35), y: floor };
    const rearKnee = { x: (hip.x + rearFoot.x) / 2 - dir * s * 0.15, y: hip.y + s * 0.42 };
    const frontKnee = { x: (hip.x + frontFoot.x) / 2 + dir * s * 0.2, y: hip.y + s * 0.38 };
    g.moveTo(hip.x, hip.y).lineTo(rearKnee.x, rearKnee.y).lineTo(rearFoot.x, rearFoot.y);
    g.moveTo(hip.x, hip.y).lineTo(frontKnee.x, frontKnee.y).lineTo(frontFoot.x, frontFoot.y);
    g.stroke({ width: 7, color: wood, alpha: 1, cap: "round", join: "round" });

    // One arm flails toward the rival; the other counterbalances behind.
    const swing = m.swing + (m.attack > 0 ? dir * 0.65 : 0);
    const handFront = {
      x: shoulder.x + dir * s * (1.25 + Math.cos(swing) * 0.45),
      y: shoulder.y + Math.sin(swing) * s * 0.85,
    };
    const elbowFront = {
      x: (shoulder.x + handFront.x) / 2,
      y: (shoulder.y + handFront.y) / 2 - s * 0.18,
    };
    const handBack = {
      x: shoulder.x - dir * s * (0.75 + Math.cos(swing) * 0.25),
      y: shoulder.y + s * (0.55 - Math.sin(swing) * 0.25),
    };
    g.moveTo(shoulder.x, shoulder.y).lineTo(elbowFront.x, elbowFront.y).lineTo(handFront.x, handFront.y);
    g.moveTo(shoulder.x, shoulder.y).lineTo(handBack.x, handBack.y);
    g.stroke({ width: 6, color: wood, alpha: 1, cap: "round", join: "round" });

    for (const p of [shoulder, hip, rearKnee, frontKnee, elbowFront]) {
      g.circle(p.x, p.y, 4.3).fill({ color: joint, alpha: 0.95 });
      g.circle(p.x, p.y, 2).fill({ color: darkWood, alpha: 0.9 });
    }

    // The two states the other player has to be able to read across the table.
    if (!fallen) {
      const face = left ? 0 : Math.PI;
      // arc() continues the current path, so each one starts with an explicit
      // moveTo to its own first point — otherwise a stray line runs in from
      // wherever the previous shape ended.
      const arcAt = (cxx: number, cyy: number, r: number, a0: number, a1: number) => {
        g.moveTo(cxx + Math.cos(a0) * r, cyy + Math.sin(a0) * r);
        g.arc(cxx, cyy, r, a0, a1);
      };

      if (m.phase === "guard") {
        // A braced arc in front: jabs bounce off this, swings break it.
        arcAt(shoulder.x, shoulder.y + s * 0.2, s * 1.35, face - 0.85, face + 0.85);
        g.stroke({ width: 5, color: COLOR.shield, alpha: 0.85, cap: "round" });
        arcAt(shoulder.x, shoulder.y + s * 0.2, s * 1.55, face - 0.5, face + 0.5);
        g.stroke({ width: 2.5, color: COLOR.shield, alpha: 0.4, cap: "round" });
      } else if (m.phase === "windup" && m.heavy) {
        // The telegraph. A big swing announces itself, and that window is the
        // whole reason a jab exists.
        const pulse = 0.6 + 0.4 * Math.sin(round.time * 30);
        arcAt(shoulder.x, shoulder.y, s * 1.5, face + Math.PI - 1.0, face + Math.PI + 0.35);
        g.stroke({ width: 4.5, color: COLOR.eraser, alpha: 0.55 + 0.35 * pulse, cap: "round" });
        g.circle(head.x + dir * s * 0.1, head.y - s * 1.15, 3.4)
          .fill({ color: COLOR.eraser, alpha: 0.8 * pulse });
      }
    }

    // String and balloon head. Each lost heart visibly softens the balloon.
    const balloonScale = fallen ? 0.28 : 0.72 + Math.max(0, d.hearts) * 0.08;
    const balloonR = s * balloonScale;
    g.moveTo(shoulder.x, shoulder.y - s * 0.15).lineTo(head.x, head.y + balloonR * 0.65);
    g.stroke({ width: 2, color: darkWood, alpha: 0.75 });
    g.ellipse(head.x, head.y, balloonR, balloonR * 1.12)
      .fill({ color: left ? 0x9edfc8 : 0xee91aa, alpha: d.iframes > 0 ? 0.55 : 0.88 });
    g.circle(head.x - dir * balloonR * 0.22, head.y - balloonR * 0.15, 2.2)
      .fill({ color: COLOR.ink, alpha: 0.8 });
    g.moveTo(head.x - balloonR * 0.2, head.y + balloonR * 0.2)
      .lineTo(head.x + balloonR * 0.2, head.y + balloonR * 0.2);
    g.stroke({ width: 1.8, color: COLOR.ink, alpha: 0.65, cap: "round" });
  }

  // -------------------------------------------------------------------------

  /** In the foe modes this is the line you are defending. */
  private drawBaseline(g: Graphics, round: Round, nowMs: number): void {
    const y = this.sy(FOE.baseline);
    const { left, width } = this.vp;
    // Closest foe drives the urgency, so the line reacts to real danger.
    let near = 1;
    for (const f of round.foes) near = Math.min(near, (FOE.baseline - f.pos.y) / FOE.baseline);
    const heat = 1 - Math.min(1, Math.max(0, near) * 2.2);
    const pulse = 0.6 + 0.4 * Math.sin(nowMs / 220);
    this.dash(g, left + width * 0.03, y, left + width * 0.97, y, 13, 9);
    g.stroke({
      width: 3 + heat * 2,
      color: COLOR.eraser,
      alpha: 0.3 + heat * 0.55 * pulse,
    });
  }

  private drawErasure(g: Graphics, erasure: number): void {
    if (erasure <= 0) return;
    const { top, height } = this.vp;
    const w = this.vp.toScreenLen(erasure);
    for (const x0 of [this.vp.left, this.vp.left + this.vp.width - w]) {
      g.rect(x0, top, w, height).fill({ color: COLOR.paper, alpha: 0.92 });
      // Rubbed-out hatching, so it reads as erased rather than merely masked.
      for (let y = top - w; y < top + height; y += 11) {
        g.moveTo(x0, y + w).lineTo(x0 + w, y);
      }
      g.stroke({ width: 2, color: COLOR.eraser, alpha: 0.3 });
      g.moveTo(x0 === this.vp.left ? x0 + w : x0, top)
        .lineTo(x0 === this.vp.left ? x0 + w : x0, top + height);
      g.stroke({ width: 2.5, color: COLOR.eraser, alpha: 0.75 });
    }
  }

  private drawEntity(g: Graphics, e: Entity, f: number, round: Round): void {
    const mine = e.side === "player";
    const alpha = mine ? 1 : 0.82;

    switch (e.kind) {
      case "wall": {
        const ax = this.sx(e.a.x) + this.px(wobX(e.id, 0, f));
        const ay = this.sy(e.a.y) + this.px(wobY(e.id, 0, f));
        const bx = this.sx(e.b.x) + this.px(wobX(e.id, 1, f));
        const by = this.sy(e.b.y) + this.px(wobY(e.id, 1, f));
        const fade = Math.min(1, e.life / 1.2);
        g.moveTo(ax, ay).lineTo(bx, by);
        g.stroke({ width: 7, color: COLOR.ink, alpha: alpha * fade, cap: "round" });
        break;
      }

      case "tangle": {
        const cx = this.sx(e.pos.x), cy = this.sy(e.pos.y);
        const r = this.vp.toScreenLen(e.radius);
        const fade = Math.min(1, e.life / 1.5);
        // A knot of scribble, drawn as one continuous wandering loop.
        const turns = 26;
        for (let i = 0; i <= turns; i++) {
          const t = (i / turns) * Math.PI * 6;
          const rad = r * (0.32 + 0.62 * (i / turns)) * (1 + wobX(e.id, i, f, 0.1));
          const x = cx + Math.cos(t) * rad;
          const y = cy + Math.sin(t) * rad * 0.85;
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke({ width: 2.6, color: COLOR.ink, alpha: alpha * fade * 0.85, cap: "round", join: "round" });
        break;
      }

      case "bomb": {
        // A lob: straight-line travel with a parabolic lift, so it reads as air.
        const t = Math.min(1, e.t);
        const x = e.from.x + (e.to.x - e.from.x) * t;
        const y = e.from.y + (e.to.y - e.from.y) * t;
        const lift = Math.sin(t * Math.PI) * BOMB.arc * e.arcSign;
        const px = this.sx(x) + this.vp.toScreenLen(lift * 0.35);
        const py = this.sy(y) - this.vp.toScreenLen(Math.sin(t * Math.PI) * BOMB.arc);
        const r = this.vp.toScreenLen(BOMB.radius);

        // Shadow on the paper, so the player can read where it will land.
        const tx = this.sx(e.to.x), ty = this.sy(e.to.y);
        g.circle(tx, ty, this.vp.toScreenLen(BOMB.splash) * (0.55 + 0.45 * t))
          .stroke({ width: 2, color: COLOR.eraser, alpha: 0.25 + 0.4 * t });

        g.circle(px, py, r).fill({ color: COLOR.ink, alpha });
        g.circle(px - r * 0.3, py - r * 0.3, r * 0.3).fill({ color: COLOR.paper, alpha: alpha * 0.7 });
        break;
      }

      case "slash": {
        const fade = Math.max(0, e.life / 0.22);
        const ax = this.sx(e.from.x), ay = this.sy(e.from.y);
        const bx = this.sx(e.to.x), by = this.sy(e.to.y);
        g.moveTo(ax, ay).lineTo(bx, by);
        g.stroke({
          width: 5 * fade + 1,
          color: e.blocked ? COLOR.soft : COLOR.ink,
          alpha: fade * alpha,
          cap: "round",
        });
        break;
      }

      case "foe": {
        const cx = this.sx(e.pos.x), cy = this.sy(e.pos.y);
        const forming = round.glideRules
          ? Math.max(0.08, Math.min(1, (round.time - e.born) / 0.58))
          : 1;
        const r = this.vp.toScreenLen(e.radius);
        const col = e.flash > 0 ? COLOR.foeHurt : COLOR.foe;
        const a = (e.slowed > 0 ? 0.55 : 1) * forming;

        if (e.type === "dart") {
          // A dart: sharp, arrow-like, obviously the fast one.
          const s = 0.2 + forming * 0.8;
          g.moveTo(cx, cy + r * 1.15 * s)
            .lineTo(cx - r * 0.85 * s, cy - r * 0.7 * s)
            .lineTo(cx, cy - r * 0.25 * s)
            .lineTo(cx + r * 0.85 * s, cy - r * 0.7 * s)
            .closePath();
          g.fill({ color: col, alpha: a });
        } else if (e.type === "smudge") {
          // A smudge: a heavy blob, drawn with a ring per remaining hit point.
          const sr = r * (0.18 + forming * 0.82);
          g.circle(cx, cy, sr).fill({ color: col, alpha: a * 0.9 });
          for (let i = 0; i < e.hp; i++) {
            g.circle(cx, cy, sr + 3 + i * 4 * forming)
              .stroke({ width: 2, color: col, alpha: a * 0.45 });
          }
        } else {
          // A blot: a scribbled ball of ink.
          const turns = 14;
          const drawn = Math.max(2, Math.ceil(turns * forming));
          for (let i = 0; i <= drawn; i++) {
            const t = (i / turns) * Math.PI * 4;
            const rad = r * (0.35 + 0.65 * (i / turns)) * (1 + wobX(e.id, i, f, 0.16));
            const x = cx + Math.cos(t) * rad;
            const y = cy + Math.sin(t) * rad;
            i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
          }
          g.stroke({ width: 3, color: col, alpha: a, cap: "round", join: "round" });
        }

        // Two cross eyes, so they read as a character and not a rock.
        if (forming > 0.72) {
          const eyeIn = (forming - 0.72) / 0.28;
          const ey = cy - r * 0.15, ex = r * 0.34;
          g.moveTo(cx - ex - 2, ey - 2).lineTo(cx - ex + 2, ey + 2);
          g.moveTo(cx - ex + 2, ey - 2).lineTo(cx - ex - 2, ey + 2);
          g.moveTo(cx + ex - 2, ey - 2).lineTo(cx + ex + 2, ey + 2);
          g.moveTo(cx + ex + 2, ey - 2).lineTo(cx + ex - 2, ey + 2);
          g.stroke({ width: 1.8, color: COLOR.paper, alpha: a * 0.9 * eyeIn, cap: "round" });
        }
        break;
      }

      case "puff": {
        const t = 1 - e.life / 0.42;
        const r = this.vp.toScreenLen(e.radius) * (0.4 + t * 0.9);
        const col = e.tone === "eraser" ? COLOR.eraser : e.tone === "gold" ? COLOR.gold : COLOR.ink;
        g.circle(this.sx(e.pos.x), this.sy(e.pos.y), r)
          .stroke({ width: 3 * (1 - t) + 0.5, color: col, alpha: (1 - t) * 0.8 });
        break;
      }
    }

    void round;
  }

  private drawDoodle(g: Graphics, d: Doodle, f: number, round: Round): void {
    // Both doodles stand upright. Inverting the far one reads as a reflection
    // rather than an opponent, which is exactly the wrong read across a fold.
    const up = -1;
    const runner = round.glideRules && d.side === "player";
    const bob = runner
      ? Math.abs(Math.sin(round.time * 18)) * 0.005
      : Math.sin(d.bob * Math.PI * 2 * DOODLE.bobHz) * DOODLE.bobAmp;
    const cx = this.sx(d.pos.x);
    const cy = this.sy(d.pos.y + bob);
    const s = this.vp.toScreenLen(DOODLE.radius);
    const id = d.side === "player" ? 9001 : 9002;
    const w = (i: number) => this.px(wobX(id, i, f, 0.0035));
    const h = (i: number) => this.px(wobY(id, i, f, 0.0035));

    const you = d.side === "player";
    const hit = d.flash > 0;
    // You are solid ink. The opponent is a replay, and is drawn like one.
    const col = hit ? COLOR.eraser : you ? COLOR.ink : COLOR.ghost;
    const lw = you ? 4.5 : 3.2;
    const alpha = d.iframes > 0 && !hit ? 0.55 : 1;
    const neckY = cy + up * s * 0.5;
    const hipY = cy - up * s * 0.15;

    if (runner) {
      const air = Math.max(0, GLIDE.groundY - d.pos.y);
      const shadowY = this.sy(0.895);
      const shadowW = s * Math.max(0.35, 1.05 - air * 1.7);
      g.ellipse(cx, shadowY, shadowW, s * 0.18)
        .fill({ color: COLOR.ink, alpha: Math.max(0.06, 0.2 - air * 0.16) });

      // Dust and speed scratches cycle behind the feet only while grounded.
      if (air < 0.025) {
        for (let i = 0; i < 3; i++) {
          const t = (round.time * 4.5 + i / 3) % 1;
          g.circle(cx - s * (0.55 + t * 1.8), shadowY - t * 5, 3.2 * (1 - t))
            .stroke({ width: 1.6, color: COLOR.soft, alpha: (1 - t) * 0.38 });
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const dy = (i - 1) * s * 0.42;
          g.moveTo(cx - s * 0.8, cy + dy).lineTo(cx - s * (1.55 + i * 0.2), cy + dy);
        }
        g.stroke({ width: 2, color: COLOR.gold, alpha: 0.26, cap: "round" });
      }
    }

    // The cape snaps upward on a flap, then stretches into a long glide.
    if (runner && you) {
      const lift = Math.max(0, 0.82 - d.pos.y);
      const flap = Math.max(0, Math.min(1, -round.glideVelocityY / Math.abs(GLIDE.flapVelocity)));
      const flutter = Math.sin(round.time * 18) * s * 0.12;
      g.moveTo(cx - s * 0.12, neckY)
        .lineTo(cx - s * (1.25 + lift + flap * 0.45), neckY + s * (0.25 - flap * 1.15) + flutter)
        .lineTo(cx - s * (0.72 + flap * 0.2), cy + s * (0.7 - flap * 0.35))
        .closePath();
      g.fill({ color: COLOR.gold, alpha: 0.72 });
      g.stroke({ width: 2.5, color: COLOR.ink, alpha: 0.8, join: "round" });
    }

    // Head
    g.circle(cx + w(0), cy + up * s * 0.95 + h(0), s * 0.42)
      .stroke({ width: lw, color: col, alpha });

    // Spine
    g.moveTo(cx + w(1), neckY + h(1)).lineTo(cx + w(2), hipY + h(2));

    // Arms
    const armY = cy + up * s * 0.3;
    const air = runner ? Math.max(0, GLIDE.groundY - d.pos.y) : 0;
    const reach = air > 0.03 ? s * 0.24 : 0;
    g.moveTo(cx + w(3), armY + h(3)).lineTo(cx - s * 0.62 + reach + w(4), armY + up * s * 0.28 - reach + h(4));
    g.moveTo(cx + w(5), armY + h(5)).lineTo(cx + s * 0.62 + reach + w(6), armY - up * s * 0.1 - reach + h(6));

    // Legs
    const run = runner && air < 0.03 ? Math.sin(round.time * 18) * s * 0.42 : 0;
    const tuck = runner && air >= 0.03 ? s * 0.34 : 0;
    g.moveTo(cx + w(7), hipY + h(7)).lineTo(cx - s * 0.42 + run + tuck + w(8), cy - up * s * 0.95 - tuck + h(8));
    g.moveTo(cx + w(9), hipY + h(9)).lineTo(cx + s * 0.45 - run - tuck + w(10), cy - up * s * 0.95 - tuck + h(10));
    g.stroke({ width: lw, color: col, alpha, cap: "round" });

    // The scarf — the one bit of colour on the figure.
    g.moveTo(cx - s * 0.28, neckY + up * s * 0.05)
      .lineTo(cx + s * 0.5 + w(11), neckY + up * s * 0.3 + h(11));
    g.stroke({
      width: you ? 5 : 3.5,
      color: you ? COLOR.eraser : COLOR.ghostScarf,
      alpha: alpha * 0.9, cap: "round",
    });

    // A caret under your own doodle. Small, permanent, and unambiguous.
    if (you && !runner) {
      const ty = cy + s * 1.5;
      g.moveTo(cx - s * 0.3, ty + s * 0.3).lineTo(cx, ty).lineTo(cx + s * 0.3, ty + s * 0.3);
      g.stroke({ width: 3.5, color: COLOR.gold, alpha: 0.9, cap: "round", join: "round" });
    }

    if (d.shield > 0) {
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 110);
      g.circle(cx, cy, this.vp.toScreenLen(SHIELD.radius))
        .stroke({ width: 3.5, color: COLOR.shield, alpha: 0.75 * pulse });
    }

    if (d.stun > 0) {
      const r = this.vp.toScreenLen(TANGLE.radius * 0.4);
      g.circle(cx, cy + up * s * 1.5, r).stroke({ width: 2.5, color: COLOR.eraser, alpha: 0.7 });
    }
  }

  /** The wet trail under the finger — what you are drawing, before it resolves. */
  private drawWet(g: Graphics, pts: Pt[]): void {
    g.moveTo(this.sx(pts[0].x), this.sy(pts[0].y));
    for (let i = 1; i < pts.length; i++) g.lineTo(this.sx(pts[i].x), this.sy(pts[i].y));
    g.stroke({ width: 6, color: COLOR.ink, alpha: 0.32, cap: "round", join: "round" });
  }

  private dash(g: Graphics, x1: number, y1: number, x2: number, y2: number, on: number, off: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    let t = 0;
    while (t < len) {
      const e = Math.min(t + on, len);
      g.moveTo(x1 + ux * t, y1 + uy * t).lineTo(x1 + ux * e, y1 + uy * e);
      t = e + off;
    }
  }

  private sx(n: number): number { return this.vp.toScreenX(n); }
  private sy(n: number): number { return this.vp.toScreenY(n); }
  private px(n: number): number { return this.vp.toScreenLen(n); }
}
