import { COST, INK, ROUND } from "../config";
import type { ModeId, Readout } from "../game/modes";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/** The five marks, for the how-to screen. Each icon is the gesture itself. */
const MARK_ICONS: Array<{ path: string; name: string; blurb: string; ink: number }> = [
  { path: "M4 22 L30 10", name: "Line", blurb: "wall at home &middot; slash up close", ink: COST.line },
  { path: "M17 5 a11 11 0 1 0 .1 0", name: "Circle", blurb: "shield at home &middot; bomb across", ink: COST.circle },
  { path: "M3 24 L10 8 L17 24 L24 8 L31 24", name: "Zigzag", blurb: "tangle &mdash; catches dashes", ink: COST.zigzag },
  { path: "M5 8 L17 25 L30 6", name: "Tick", blurb: "dash &mdash; points where the second leg goes", ink: COST.arrow },
  { path: "M6 6 L28 26 M28 6 L6 26", name: "Cross", blurb: "erase &mdash; answers anything", ink: COST.cross },
];

export class Hud {
  private hud = $("hud");
  private myHearts = $("myHearts");
  private oppHearts = $("oppHearts");
  private clock = $("clock");
  private pips = $("roundpips");
  private inkbar = $("inkbar");
  private inkfill = $<HTMLElement>("inkfill");
  private inklabel = $("inklabel");
  private toast = $("toast");
  private oppTag = $("oppHearts").parentElement as HTMLElement;
  private clocklabel = $("clocklabel");
  private inkTop = $("inkwrapTop");
  private inkTopFill = $<HTMLElement>("inkfillTop");
  private afford = $("afford");
  private inkWrap = $("inkwrap");

  private toastTimer = 0;

  constructor() {
    const list = $("markList");
    list.innerHTML = MARK_ICONS.map((m) => `
      <svg width="34" height="32" viewBox="0 0 34 32" aria-hidden="true">
        <path d="${m.path}" fill="none" stroke="currentColor" stroke-width="3"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div><b>${m.name}</b> &middot; ${m.ink} ink<br><span>${m.blurb}</span></div>
    `).join("");
    this.afford.innerHTML = MARK_ICONS.map((m) => `
      <span data-ink="${m.ink}" title="${m.name}: ${m.ink} ink">
        <svg viewBox="0 0 34 32" aria-hidden="true"><path d="${m.path}"/></svg>
        <i>${m.ink}</i>
      </span>
    `).join("");
  }

  show(on: boolean): void { this.hud.classList.toggle("on", on); }

  /** Practice has no clock and no score, so neither should be on screen. */
  setScored(on: boolean): void {
    this.clock.style.visibility = on ? "" : "hidden";
    this.pips.style.visibility = on ? "" : "hidden";
  }

  setHearts(mine: number, theirs: number): void {
    render(this.myHearts, Math.max(0, Math.ceil(mine)));
    render(this.oppHearts, Math.max(0, Math.ceil(theirs)));
  }

  /** Foe modes replace the round pips with nothing and the clock with a score. */
  setMode(mode: ModeId): void {
    const versus = mode === "duel" || mode === "samepage" || mode === "puppet" || mode === "volley";
    this.pips.style.visibility = versus ? "" : "hidden";
    this.oppTag.style.visibility = versus ? "" : "hidden";
    this.inkTop.classList.toggle("on", mode === "samepage");
    const noInk = mode === "puppet" || mode === "volley" || mode === "copycat" || mode === "hunt";
    this.inkWrap.hidden = noInk;
    this.afford.hidden = noInk;
    const top = this.oppTag.querySelector("span");
    const bottom = $("myHearts").parentElement?.querySelector("span");
    if (top) top.textContent = mode === "puppet" ? "RIGHT" : mode === "volley" ? "TOP" : "THEM";
    if (bottom) bottom.textContent = mode === "puppet" ? "LEFT" : mode === "volley" ? "BOTTOM" : "YOU";
  }

  /** Whatever the mode wants where the clock normally sits. */
  setReadout(r: Readout): void {
    this.clocklabel.textContent = r.label;
    this.clock.textContent = r.value;
    this.clock.classList.toggle("urgent", r.urgent);
    this.clock.style.fontSize = r.value.length > 5 ? "19px" : "";
  }

  /** Second ink meter, for the player at the top of the page. */
  setGhostInk(ink: number | null): void {
    if (ink === null) return;
    this.inkTopFill.style.width = `${(ink / INK.max) * 100}%`;
  }

  setClock(secondsLeft: number, erasing: boolean): void {
    this.clock.textContent = erasing ? "ERASING" : String(Math.ceil(secondsLeft));
    this.clock.classList.toggle("urgent", erasing || secondsLeft <= 10);
    if (erasing) this.clock.style.fontSize = "17px";
    else this.clock.style.fontSize = "";
  }

  setInk(ink: number): void {
    const pct = (ink / INK.max) * 100;
    this.inkfill.style.width = `${pct}%`;
    this.inklabel.textContent = String(Math.floor(ink));
    // Cheapest mark is a line; below that you cannot do anything at all.
    this.inkbar.classList.toggle("broke", ink < COST.line);
    for (const el of this.afford.children) {
      const cost = Number((el as HTMLElement).dataset.ink ?? 0);
      el.classList.toggle("off", ink < cost);
    }
  }

  setRounds(won: number, lost: number): void {
    const need = Math.ceil(ROUND.bestOf / 2);
    let html = "";
    for (let i = 0; i < need; i++) html += `<i class="${i < won ? "won" : ""}"></i>`;
    html += `<i style="border:none;width:5px"></i>`;
    for (let i = 0; i < need; i++) html += `<i class="${i < lost ? "lost" : ""}"></i>`;
    this.pips.innerHTML = html;
  }

  say(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove("show");
    void this.toast.offsetWidth;  // restart the animation
    this.toast.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 900);
  }
}

function render(host: HTMLElement, n: number): void {
  const total = ROUND.hearts;
  let html = "";
  for (let i = 0; i < total; i++) html += `<div class="heart${i < n ? "" : " gone"}"></div>`;
  host.innerHTML = html;
}

/** Simple screen stack — the menus are plain DOM sitting over the canvas. */
export class Screens {
  private ids = ["titleScreen", "howScreen", "vsScreen", "endScreen", "boardScreen", "challengeScreen", "pauseScreen"];

  show(id: string | null): void {
    for (const s of this.ids) $(s).classList.toggle("on", s === id);
  }
}

export { $ };
