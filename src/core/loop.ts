import { STEP_MS } from "../config";

/**
 * Fixed-timestep loop with an interpolated render.
 *
 * The simulation only ever advances in STEP_MS chunks, so a 120Hz ProMotion
 * phone, a 60Hz phone and a thermally throttled one all run the same game —
 * and a recorded mark log stays deterministic across all three.
 */
export class Loop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;

  constructor(
    private readonly step: (dtMs: number) => void,
    private readonly draw: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      // Clamp so a backgrounded tab doesn't come back and simulate 400 steps.
      const frame = Math.min(now - this.last, 250);
      this.last = now;
      this.acc += frame;
      while (this.acc >= STEP_MS) {
        this.step(STEP_MS);
        this.acc -= STEP_MS;
      }
      this.draw(this.acc / STEP_MS);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
