/**
 * A tiny synth. No audio files — every sound is a couple of oscillators, which
 * keeps the bundle honest and means the pencil noises can be tuned in code.
 *
 * iOS keeps the audio context suspended until a real user gesture, so nothing
 * is created until the first tap and every call is a no-op before then.
 */
export type Cue =
  | "mark" | "wall" | "bomb" | "slash" | "tangle" | "dash"
  | "erase" | "kill" | "hurt" | "wave" | "win" | "lose" | "reject";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  buzz = true;

  /** Call from a real user gesture — a click or the first stroke. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.24;
    this.master.connect(this.ctx.destination);
  }

  play(cue: Cue): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    switch (cue) {
      // Marks: short pencil-ish blips, pitched by what they made.
      case "mark":   this.blip(t, 420, 0.05, "triangle", 0.5); break;
      case "wall":   this.blip(t, 190, 0.09, "square", 0.55); break;
      case "tangle": this.noise(t, 0.13, 1400, 0.4); break;
      case "dash":   this.sweep(t, 320, 720, 0.11, 0.4); break;
      case "slash":  this.noise(t, 0.09, 3200, 0.5); break;
      case "bomb":   this.sweep(t, 620, 180, 0.16, 0.5); break;
      case "erase":  this.noise(t, 0.2, 900, 0.45); break;

      case "kill":   this.blip(t, 660, 0.06, "square", 0.4); this.noise(t + 0.02, 0.08, 2200, 0.3); break;
      case "hurt":   this.sweep(t, 300, 90, 0.28, 0.75); break;
      case "reject": this.blip(t, 150, 0.07, "sawtooth", 0.3); break;

      case "wave":   this.arp(t, [523, 659], 0.09); break;
      case "win":    this.arp(t, [523, 659, 784, 1047], 0.11); break;
      case "lose":   this.arp(t, [392, 330, 262], 0.17, "triangle"); break;
    }
  }

  /** Haptics are a bonus layer — Android web only, and never load-bearing. */
  vibrate(ms: number | number[]): void {
    if (!this.buzz) return;
    navigator.vibrate?.(ms);
  }

  // -------------------------------------------------------------------------

  private blip(at: number, freq: number, dur: number, type: OscillatorType, vol: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private sweep(at: number, from: number, to: number, dur: number, vol: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** Filtered noise — the scratchy, papery half of the palette. */
  private noise(at: number, dur: number, cutoff: number, vol: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master);
    src.start(at);
  }

  private arp(at: number, notes: number[], step: number, type: OscillatorType = "square"): void {
    notes.forEach((f, i) => this.blip(at + i * step, f, step * 1.5, type, 0.4));
  }
}

/** Which cue a resolved mark should make. */
export function cueForMark(became: string): Cue {
  switch (became) {
    case "wall": return "wall";
    case "bomb": return "bomb";
    case "slash": return "slash";
    case "shot": return "slash";
    case "tangle": return "tangle";
    case "dash":
    case "glide": return "dash";
    case "shield": return "mark";
    case "erase": return "erase";
    default: return "mark";
  }
}
