import { MODES, PLAY_MODES, type ModeId, type ModeInfo } from "../game/modes";
import { missionHtml } from "../game/progress";
import { $ } from "./hud";

/**
 * The home carousel. One card per mode, swipeable, with the mode's own best
 * result on it — so the front door is a menu of things to do rather than a
 * single Play button.
 */
export class Home {
  index = 0;

  constructor(private readonly onChange: (m: ModeInfo) => void) {
    const dots = $("modeDots");
    dots.innerHTML = PLAY_MODES.map(() => "<i></i>").join("");

    $("modePrev").addEventListener("click", () => this.step(-1));
    $("modeNext").addEventListener("click", () => this.step(1));

    // Swipe the card itself — it is the obvious thing to try on a phone.
    const card = $("modeCard");
    let x0 = 0;
    card.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
    card.addEventListener("pointerup", (e) => {
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 40) this.step(dx < 0 ? 1 : -1);
    });

    this.paint();
  }

  get mode(): ModeInfo { return PLAY_MODES[this.index]; }

  step(dir: number): void {
    this.index = (this.index + dir + PLAY_MODES.length) % PLAY_MODES.length;
    this.paint();
    this.onChange(this.mode);
  }

  select(id: ModeId): void {
    const i = PLAY_MODES.findIndex((m) => m.id === id);
    if (i >= 0) { this.index = i; this.paint(); }
  }

  paint(): void {
    const m = this.mode;
    const card = $("modeCard");
    card.className = `modecard ${m.accent}`;
    $("mcName").textContent = m.name;
    $("mcTag").textContent = m.tagline;
    $("mcBlurb").textContent = m.blurb;
    $("mcBest").textContent = bestLine(m);

    const dots = $("modeDots").children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle("on", i === this.index);
  }
}

export function bestOf(m: ModeInfo): number {
  if (!m.bestKey) return 0;
  return Number(localStorage.getItem(m.bestKey) ?? 0);
}

export function recordBest(m: ModeInfo, score: number): boolean {
  if (!m.bestKey || score <= bestOf(m)) return false;
  localStorage.setItem(m.bestKey, String(score));
  return true;
}

function bestLine(m: ModeInfo): string {
  if (!m.bestKey) return "pass and play";
  const v = bestOf(m);
  if (!v) return "not played yet";
  if (m.id === "duel") return `${m.bestLabel.toUpperCase()} · ${v} CLEARED`;
  if (m.id === "siege") return `${m.bestLabel.toUpperCase()} · ${v}`;
  if (m.id === "glide" || m.id === "bridge") return `${m.bestLabel.toUpperCase()} · ${v.toLocaleString()}m`;
  return `${m.bestLabel.toUpperCase()} · ${v.toLocaleString()}`;
}

/** The board screen: every mode's best, in one place. */
export function paintBoard(): void {
  $("missionList").innerHTML = missionHtml();
  $("boardList").innerHTML = MODES.map((m) => {
    const v = bestOf(m);
    const val = !m.bestKey ? '<b class="none">local play</b>'
      : !v ? '<b class="none">—</b>'
      : `<b>${v.toLocaleString()}${m.id === "glide" || m.id === "bridge" ? "m" : ""}</b>`;
    const label = m.experimental ? "EXPERIMENTAL LAB" : (m.bestLabel || "local play").toUpperCase();
    return `<div class="brow"><span>${m.name}<em>${label}</em></span>${val}</div>`;
  }).join("");
}
