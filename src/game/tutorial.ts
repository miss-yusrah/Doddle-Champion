import type { MarkId } from "../input/recognizer";
import type { Resolved } from "./round";

/**
 * The guided first run.
 *
 * The one thing a new player cannot guess is that the *same* mark does
 * different things depending on which half of the page it lands in. So the
 * script teaches the circle twice — once in each half — and puts those two
 * steps back to back, where the difference is impossible to miss.
 */
export interface Step {
  /** Which half the coach highlights, and requires. */
  half: "own" | "theirs";
  want: MarkId;
  /** What the mark must resolve into for the step to count. */
  becomes: Resolved;
  prompt: string;
  hint: string;
  done: string;
}

export const STEPS: Step[] = [
  {
    half: "own",
    want: "line",
    becomes: "wall",
    prompt: "Draw a straight line down in your half",
    hint: "one quick flick, side to side — the glowing half is yours",
    done: "That's a WALL. It stops one incoming hit, then shatters.",
  },
  {
    half: "theirs",
    want: "circle",
    becomes: "bomb",
    prompt: "Now draw a circle up in their half",
    hint: "past the dashed fold — a loop, roughly closed",
    done: "An INK BOMB. It lobs over walls and splashes where it lands.",
  },
  {
    half: "own",
    want: "circle",
    becomes: "shield",
    prompt: "Draw that same circle — but around yourself",
    hint: "same mark, your half. Where you draw is what you get.",
    done: "A SHIELD instead. One mark, two jobs, decided by the fold.",
  },
  {
    half: "own",
    want: "arrow",
    becomes: "dash",
    prompt: "Draw a tick in your half",
    hint: "out, then a good way back — like a check mark. It points where you go.",
    done: "A DASH. Dodge bombs with it, or close in far enough to slash.",
  },
  {
    half: "own",
    want: "zigzag",
    becomes: "tangle",
    prompt: "Now draw a zigzag in your half",
    hint: "three or more sharp turns, like a scribble",
    done: "A TANGLE. It catches a dash and eats a bomb.",
  },
  {
    half: "own",
    want: "cross",
    becomes: "erase",
    prompt: "Erase the blot — draw one line, then cross it",
    hint: "make the second line within a beat, right over the target",
    done: "ERASE answers anything nearby, so it costs the most ink.",
  },
];

export class Tutorial {
  index = 0;
  /** Set while the "done" line is showing, before the next prompt. */
  celebrating = false;

  get step(): Step | null {
    return this.index < STEPS.length ? STEPS[this.index] : null;
  }

  get finished(): boolean {
    return this.index >= STEPS.length;
  }

  /** Did this mark satisfy the current step? */
  accepts(id: MarkId, became: Resolved | null): boolean {
    const s = this.step;
    return !!s && !this.celebrating && s.want === id && became === s.becomes;
  }

  /** Is the player drawing in the wrong half for this step? */
  wrongHalf(id: MarkId, became: Resolved | null): boolean {
    const s = this.step;
    if (!s || this.celebrating || became === null) return false;
    return s.want === id && became !== s.becomes;
  }

  advance(): void {
    this.index++;
    this.celebrating = false;
  }
}
