export interface DailyProgress {
  marks: number;
  clears: number;
  metres: number;
}

export interface ProgressDelta {
  marks?: number;
  clears?: number;
  metres?: number;
}

const MISSIONS = [
  { key: "marks" as const, target: 20, label: "Draw 20 marks" },
  { key: "clears" as const, target: 10, label: "Clear 10 threats" },
  { key: "metres" as const, target: 300, label: "Travel 300m" },
];

/** Local calendar date, so the page changes at the player's midnight. */
export function todayId(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** FNV-1a gives everyone the same deterministic challenge for a date. */
export function dailySeed(day = todayId()): number {
  let h = 0x811c9dc5;
  for (const ch of `doodle-champion:${day}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function progressKey(day = todayId()): string { return `dc.daily.progress.${day}`; }
function bestKey(day = todayId()): string { return `dc.daily.best.${day}`; }

export function readDailyProgress(day = todayId()): DailyProgress {
  try {
    const raw = localStorage.getItem(progressKey(day));
    if (!raw) return { marks: 0, clears: 0, metres: 0 };
    const value = JSON.parse(raw) as Partial<DailyProgress>;
    return {
      marks: Math.max(0, Number(value.marks) || 0),
      clears: Math.max(0, Number(value.clears) || 0),
      metres: Math.max(0, Number(value.metres) || 0),
    };
  } catch {
    return { marks: 0, clears: 0, metres: 0 };
  }
}

export function addDailyProgress(delta: ProgressDelta): DailyProgress {
  const value = readDailyProgress();
  value.marks += Math.max(0, Math.floor(delta.marks ?? 0));
  value.clears += Math.max(0, Math.floor(delta.clears ?? 0));
  value.metres += Math.max(0, Math.floor(delta.metres ?? 0));
  localStorage.setItem(progressKey(), JSON.stringify(value));
  return value;
}

export function dailyBest(): number {
  return Number(localStorage.getItem(bestKey()) ?? 0);
}

export function recordDailyBest(score: number): boolean {
  if (score <= dailyBest()) return false;
  localStorage.setItem(bestKey(), String(score));
  return true;
}

export function missionHtml(): string {
  const value = readDailyProgress();
  const stars = MISSIONS.filter((m) => value[m.key] >= m.target).length;
  const rows = MISSIONS.map((m) => {
    const progress = Math.min(m.target, Math.floor(value[m.key]));
    const done = progress >= m.target;
    return `<div class="brow mission ${done ? "done" : ""}"><span>${done ? "★" : "☆"} ${m.label}<em>DAILY MISSION</em></span><b>${progress}/${m.target}</b></div>`;
  }).join("");
  return `<div class="brow mission ${stars === MISSIONS.length ? "done" : ""}"><span>Pencil stars<em>REFRESHES EACH DAY</em></span><b>${stars}/${MISSIONS.length}</b></div>${rows}`;
}
