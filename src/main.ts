import { Application } from "pixi.js";
import { COST, ENDLESS, GLIDE, HUNT, MARK, MONSTER, PUPPET, ROUND, SIEGE, VOLLEY } from "./config";
import { Loop } from "./core/loop";
import { Viewport } from "./core/viewport";
import { authorBout, GhostDriver, LADDER, type Personality } from "./game/ghost";
import {
  BridgeDirector, CopycatDirector, DuelDirector, EndlessDirector, GlideDirector, HuntDirector,
  MonsterDirector, PuppetDirector, SamePageDirector, SiegeDirector, VolleyDirector,
  modeInfo, type Director, type ModeId,
} from "./game/modes";
import { Home, bestOf, paintBoard, recordBest } from "./ui/home";
import { Sfx, cueForMark } from "./ui/sfx";
import { Round, type Resolved } from "./game/round";
import {
  addDailyProgress, dailyBest, dailySeed, recordDailyBest,
} from "./game/progress";
import {
  MAX_MARKS, challengeUrl, clearChallenge, readChallenge,
} from "./game/share";
import type { Bout, Side } from "./game/types";
import { STEPS, Tutorial } from "./game/tutorial";
import { isCross, recognize, type MarkId, type Pt } from "./input/recognizer";
import { StrokeInput, summarize, type Stroke } from "./input/strokes";
import { Scene, type Half } from "./render/scene";
import { $, Hud, Screens } from "./ui/hud";
import { MODE_CHAIN_ID, Wallet } from "./wallet";

type Phase = "menu" | "vs" | "playing" | "over" | "learning" | "paused";

const SEEN_GUIDE = "dc.seenGuide";

/**
 * What to say when a stroke nearly matched. Naming the closest mark turns a
 * dead "?" into a correction the player can act on.
 */
const NEAR_MISS: Record<MarkId, string> = {
  line: "straighter?",
  circle: "close the loop",
  zigzag: "more zigs",
  arrow: "bring it back further",
  cross: "cross them over",
};

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#f0efe9",
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2.5),
    autoDensity: true,
    resizeTo: window,
    // We drive rendering ourselves off the fixed-step loop.
    autoStart: false,
  });
  app.ticker.stop();
  $("stage").appendChild(app.canvas);

  const vp = new Viewport();
  const scene = new Scene(vp);
  app.stage.addChild(scene.root);

  const hud = new Hud();
  const screens = new Screens();
  const wallet = new Wallet();

  let phase: Phase = "menu";
  let pauseFrom: "playing" | "learning" = "playing";
  let round: Round | null = null;
  let ghost: GhostDriver | null = null;
  let opponent: Personality = LADDER[0];
  const sfx = new Sfx();
  /** A bout someone sent us, and the one we just played. */
  let challengeBout: Bout | null = null;
  let capturedBout: Bout | null = null;
  let director: Director | null = null;
  let mode: ModeId = "duel";
  let ladderIndex = 0;
  let roundsWon = 0;
  let roundsLost = 0;
  let dailyRun = false;
  let marksAttempted = 0;
  let marksRejected = 0;
  let progressCommitted = false;

  /** A completed line that might still be promoted into an Erase. */
  let pendingLines: Partial<Record<Side, { pts: Pt[]; at: number }>> = {};

  let tutorial: Tutorial | null = null;
  const coach = $("coach");

  const resize = () => {
    vp.resize(app.screen.width, app.screen.height);
    scene.drawPage();
    // Pin the DOM overlay to the paper column so the HUD never drifts off it.
    const root = document.documentElement.style;
    root.setProperty("--play-l", `${vp.left}px`);
    root.setProperty("--play-t", `${vp.top}px`);
    root.setProperty("--play-w", `${vp.width}px`);
    root.setProperty("--play-h", `${vp.height}px`);
  };
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 120));
  resize();

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  // ?debug logs every stroke — points captured, travel, and what it matched.
  const DEBUG = new URLSearchParams(location.search).has("debug");

  const onStroke = (s: Stroke): void => {
    const live = phase === "playing" || phase === "learning";
    if (DEBUG) {
      console.log("[stroke]", {
        phase, live, pts: s.pts.length, travel: +s.travel.toFixed(3),
        centre: [+s.centre.x.toFixed(2), +s.centre.y.toFixed(2)],
        match: recognize(s.pts),
      });
    }
    if (!live || !round) return;
    marksAttempted++;

    // Same Page: the half you start your stroke in decides who you are.
    const actor: "player" | "ghost" = mode === "puppet"
      ? s.from.x < 0.5 ? "player" : "ghost"
      : (mode === "samepage" || mode === "volley") && s.from.y < 0.5 ? "ghost" : "player";

    if (mode === "puppet") {
      round.puppetStrike(actor, s);
      hud.say(actor === "player" ? "LEFT FLAILS!" : "RIGHT FLAILS!");
      sfx.play("slash");
      sfx.vibrate(10);
      return;
    }
    if (mode === "volley") {
      const returned = round.volleyHit(actor, s);
      hud.say(returned ? actor === "player" ? "BOTTOM RETURN!" : "TOP RETURN!" : "meet the inkball");
      sfx.play(returned ? "dash" : "reject");
      if (!returned) marksRejected++;
      return;
    }

    const res = recognize(s.pts);

    // Two crossing lines inside the window are an X. Only a wall can be
    // promoted — a slash has already resolved and cannot be taken back.
    const pending = pendingLines[actor];
    if (pending && performance.now() - pending.at <= MARK.crossWindowMs) {
      if (res && res.id === "line" && isCross(pending.pts, s.pts)) {
        const merged = summarize([...pending.pts, ...s.pts], s.travel * 2);
        pendingLines[actor] = undefined;
        if (mode === "hunt") {
          const found = round.huntMark("cross", merged);
          hud.say(found === "revealed" ? "INKLING FOUND!" : "nothing there");
          sfx.play(found === "revealed" ? "wave" : "reject");
          return;
        }
        if (round.play(actor, "cross", merged, actor === "player")) {
          hud.say(`${actor === "ghost" ? "TOP · " : ""}ERASE · −${COST.cross}`);
          sfx.play("erase");
        }
        return;
      }
    }
    pendingLines[actor] = undefined;

    if (!res || res.score < MARK.minScore) {
      // A no-match costs nothing but time. Say what nearly landed, so the next
      // attempt is an adjustment rather than another guess.
      hud.say(res ? NEAR_MISS[res.id] : "not sure");
      sfx.play("reject");
      marksRejected++;
      return;
    }

    if (mode === "copycat") {
      const correct = round.copycatMark(res.id);
      hud.say(round.copyShowing > 0 ? "watch first" : correct ? "YES!" : "chain broken");
      sfx.play(correct ? "mark" : "reject");
      if (!correct && round.copyShowing <= 0) marksRejected++;
      return;
    }

    if (mode === "hunt") {
      if (res.id === "line") {
        pendingLines.player = { pts: s.pts, at: performance.now() };
        const caught = round.huntMark("line", s);
        if (caught === "caught") {
          pendingLines.player = undefined;
          hud.say("CAUGHT · +100");
          sfx.play("kill");
        } else hud.say("cross a wrinkle to reveal it");
        return;
      }
      const found = round.huntMark(res.id, s);
      hud.say(found === "caught" ? "CAUGHT!" : "not revealed");
      sfx.play(found === "caught" ? "kill" : "reject");
      return;
    }

    const played = round.play(actor, res.id, s, actor === "player");
    if (!played) {
      hud.say(actor === "ghost" ? "top: no ink" : "no ink");
      return;
    }

    if (round.lastResolved) {
      // Name what it became. The where-you-draw rule is invisible otherwise —
      // seeing "SHIELD" after a circle teaches more than any menu.
      const action = round.lastResolved === "glide" ? "CAPE FLAP" : round.lastResolved.toUpperCase();
      hud.say(`${actor === "ghost" ? "TOP · " : ""}${action} · −${COST[res.id]}`);
      sfx.play(cueForMark(round.lastResolved));
      sfx.vibrate(12);
    }

    if (res.id === "line" && round.wallPromotable(actor, performance.now())) {
      pendingLines[actor] = { pts: s.pts, at: performance.now() };
    }

    if (tutorial) gradeTutorialMark(res.id, round.lastResolved);
  };

  // ---------------------------------------------------------------------------
  // Guided first run
  // ---------------------------------------------------------------------------

  function paintCoach(): void {
    const t = tutorial;
    if (!t) { coach.classList.remove("on"); return; }
    coach.classList.add("on");
    const prompt = $("coachPrompt");
    if (t.finished) {
      $("coachStep").textContent = "";
      prompt.textContent = "That's all five marks. Go and draw on someone.";
      prompt.classList.add("win");
      $("coachHint").textContent = "";
      $<HTMLButtonElement>("coachSkip").textContent = "Start duelling";
      return;
    }
    const step = t.step!;
    if (step.want === "cross" && round && round.foes.length === 0) {
      round.spawnFoe("blot", 0.5);
      const target = round.foes[0];
      target.pos.y = 0.7;
      target.speed = 0;
    }
    $("coachStep").textContent = `STEP ${t.index + 1} OF ${STEPS.length}`;
    prompt.classList.remove("win");
    prompt.textContent = t.celebrating ? step.done : step.prompt;
    $("coachHint").textContent = t.celebrating ? "" : step.hint;
    $<HTMLButtonElement>("coachSkip").textContent = "Skip the guide";
  }

  function gradeTutorialMark(id: MarkId, became: Resolved | null): void {
    const t = tutorial;
    if (!t || t.finished) return;
    if (t.accepts(id, became)) {
      t.celebrating = true;
      hud.say("nice");
      paintCoach();
      window.setTimeout(() => {
        if (!tutorial) return;
        tutorial.advance();
        if (tutorial.finished) localStorage.setItem(SEEN_GUIDE, "1");
        paintCoach();
      }, 1750);
    } else if (t.wrongHalf(id, became)) {
      const step = t.step!;
      hud.say(step.half === "own" ? "your half — lower down" : "their half — up top");
    }
  }

  function startTutorial(): void {
    tutorial = new Tutorial();
    round = new Round(1);
    round.practice = true;
    ghost = null;
    pendingLines = {};
    phase = "learning";
    input.enabled = true;
    screens.show(null);
    hud.show(true);
    hud.setScored(false);
    hud.setMode("duel");
    paintCoach();
  }

  function endTutorial(): void {
    localStorage.setItem(SEEN_GUIDE, "1");
    tutorial = null;
    coach.classList.remove("on");
    input.enabled = false;
    startMatch(0);
  }

  const input = new StrokeInput(app.canvas as unknown as HTMLElement, vp, onStroke);

  // ---------------------------------------------------------------------------
  // Match flow
  // ---------------------------------------------------------------------------

  function startMatch(index: number): void {
    dailyRun = false;
    marksAttempted = 0;
    marksRejected = 0;
    progressCommitted = false;
    mode = "duel";
    ladderIndex = Math.min(index, LADDER.length - 1);
    opponent = LADDER[ladderIndex];
    roundsWon = 0;
    roundsLost = 0;
    toVs();
  }

  function toVs(): void {
    phase = "vs";
    input.enabled = false;
    hud.show(false);
    const info = modeInfo(mode);
    if (dailyRun) {
      $("oppname").textContent = "TODAY'S PAGE";
      $("oppTitle").textContent = info.name;
      $("oppTag").textContent = "the same notebook monster for everyone today";
    } else if (mode === "duel" && challengeBout) {
      $("oppname").textContent = `Round ${roundsWon + roundsLost + 1}`;
      $("oppTitle").textContent = "The Challenger";
      $("oppTag").textContent = "a round someone actually played";
    } else if (mode === "duel") {
      $("oppname").textContent = `Round ${roundsWon + roundsLost + 1}`;
      $("oppTitle").textContent = opponent.name;
      $("oppTag").textContent = opponent.tagline;
    } else if (mode === "samepage") {
      $("oppname").textContent = `Round ${roundsWon + roundsLost + 1}`;
      $("oppTitle").textContent = "Same Page";
      $("oppTag").textContent = "bottom player vs top player";
    } else if (mode === "puppet") {
      $("oppname").textContent = `Round ${roundsWon + roundsLost + 1}`;
      $("oppTitle").textContent = "Puppet Brawl";
      $("oppTag").textContent = "left player vs right player";
    } else if (mode === "volley") {
      $("oppname").textContent = `Round ${roundsWon + roundsLost + 1}`;
      $("oppTitle").textContent = "Doodle Volley";
      $("oppTag").textContent = "bottom player vs top player";
    } else {
      $("oppname").textContent = info.tagline.toUpperCase();
      $("oppTitle").textContent = info.name;
      $("oppTag").textContent = info.blurb;
    }
    $("oppRule").textContent =
      mode === "siege" || mode === "endless"
        ? "No fold here — build anywhere on the page. Line makes a wall, zigzag a tangle, and a circle is a bomb unless you draw it around yourself."
        : mode === "glide"
          ? "A pencil draws each obstacle. Draw a LINE at it to shoot, a TICK to flap and dodge, or a CIRCLE on it to bomb it."
        : mode === "samepage"
          ? "Whichever half you start your stroke in is the player you are. Both of you draw at once."
          : mode === "puppet"
            ? "Swipe toward the middle to lunge and swing. Swipe back to dodge. Pop the other balloon three times."
          : mode === "volley"
            ? "Swipe anywhere in your half to return the inkball. Let it leave your edge and you lose a heart."
          : mode === "monster"
            ? "Erase the monster's falling attacks. Every defeated scribble removes one piece of the boss."
          : mode === "bridge"
            ? "Draw a LINE across each tear, or draw a TICK to flap over it. Build while the page scrolls."
          : mode === "copycat"
            ? "Watch the mark sequence, then draw it back in the same order before time runs out."
          : mode === "hunt"
            ? "Draw a CROSS over suspicious wrinkles to reveal an inkling, then catch it with a LINE or CIRCLE."
          : "";
    screens.show("vsScreen");
  }

  function startRound(): void {
    const seed = dailyRun ? dailySeed() : (Math.random() * 0xffffffff) >>> 0;
    round = new Round(seed);
    pendingLines = {};

    switch (mode) {
      case "duel": {
        // A challenge link replaces the authored ladder opponent.
        ghost = new GhostDriver(
          challengeBout ?? authorBout(opponent, seed ^ 0x9e3779b9, ROUND.lengthSec),
        );
        director = new DuelDirector(ghost);
        break;
      }
      case "samepage": {
        ghost = null;
        director = new SamePageDirector();
        break;
      }
      case "siege": {
        ghost = null;
        round.duelRules = false;
        round.player.hearts = SIEGE.hearts;
        director = new SiegeDirector(seed ^ 0x5bf03635);
        break;
      }
      case "endless": {
        ghost = null;
        round.duelRules = false;
        round.player.hearts = ENDLESS.hearts;
        director = new EndlessDirector(seed ^ 0x27d4eb2d);
        break;
      }
      case "glide": {
        ghost = null;
        round.duelRules = false;
        round.glideRules = true;
        round.player.hearts = GLIDE.hearts;
        round.player.pos = { x: GLIDE.runnerX, y: GLIDE.groundY };
        director = new GlideDirector(seed ^ 0x6d2b79f5);
        break;
      }
      case "puppet": {
        ghost = null;
        round.puppetRules = true;
        round.player.hearts = PUPPET.hearts;
        round.ghost.hearts = PUPPET.hearts;
        round.player.pos = { x: PUPPET.leftHomeX, y: PUPPET.floorY };
        round.ghost.pos = { x: PUPPET.rightHomeX, y: PUPPET.floorY };
        round.player.home = { ...round.player.pos };
        round.ghost.home = { ...round.ghost.pos };
        director = new PuppetDirector();
        break;
      }
      case "monster": {
        ghost = null;
        round.duelRules = false;
        round.bossRules = true;
        round.bossHp = MONSTER.hp;
        round.bossMaxHp = MONSTER.hp;
        round.player.hearts = MONSTER.hearts;
        director = new MonsterDirector(seed ^ 0xa341316c);
        break;
      }
      case "volley": {
        ghost = null;
        round.volleyRules = true;
        round.player.hearts = VOLLEY.hearts;
        round.ghost.hearts = VOLLEY.hearts;
        director = new VolleyDirector();
        break;
      }
      case "bridge": {
        ghost = null;
        round.duelRules = false;
        round.glideRules = true;
        round.bridgeRules = true;
        round.player.pos = { x: GLIDE.runnerX, y: GLIDE.groundY };
        director = new BridgeDirector(seed ^ 0xc8013ea4);
        break;
      }
      case "copycat": {
        ghost = null;
        round.duelRules = false;
        round.copycatRules = true;
        director = new CopycatDirector(seed ^ 0xad90777d);
        break;
      }
      case "hunt": {
        ghost = null;
        round.duelRules = false;
        round.huntRules = true;
        round.player.hearts = HUNT.hearts;
        director = new HuntDirector(seed ^ 0x7e95761e);
        break;
      }
    }

    // The foe modes have no opponent doodle to fight — hide it off-page.
    if (["siege", "endless", "glide", "monster", "bridge", "copycat", "hunt"].includes(mode)) round.ghost.hearts = 99;

    heartsSeen = round.player.hearts;
    ghostHeartsSeen = round.ghost.hearts;
    waveSeen = 0;
    phase = "playing";
    input.enabled = true;
    screens.show(null);
    hud.show(true);
    hud.setScored(true);
    hud.setMode(mode);
    hud.setRounds(roundsWon, roundsLost);
    hud.say(mode === "samepage" || mode === "volley" ? "both draw!" : mode === "puppet" ? "grab a side!" : "draw!");
    const labels = $("halflabels");
    const topLabel = labels.querySelector(".hl.top");
    const bottomLabel = labels.querySelector(".hl.bot");
    if (topLabel) topLabel.textContent = mode === "volley" ? "TOP PLAYER — swipe to return" : "THEIR HALF — draw here to attack";
    if (bottomLabel) bottomLabel.textContent = mode === "volley" ? "BOTTOM PLAYER — swipe to return" : "YOUR HALF — draw here to defend";
    labels.classList.remove("on");
    void labels.offsetWidth;
    if (mode === "duel" || mode === "samepage" || mode === "volley") labels.classList.add("on");
  }

  function endRound(): void {
    if (!round || !director) return;
    input.enabled = false;
    input.cancel();

    // Keep the round as a shareable bout. Only duels make sense to send —
    // there is nobody on the other side of a Siege to replay it against.
    if (mode === "duel" && round.log.length >= 4) {
      capturedBout = {
        v: 1, seed: round.seed, runner: "you", page: "notebook",
        marks: round.log.slice(0, MAX_MARKS),
      };
    }

    // Foe modes are a single run, not a best-of-three.
    if (["siege", "endless", "glide", "monster", "bridge", "copycat", "hunt"].includes(mode)) {
      showRunEnd();
      return;
    }

    const won = round.outcome === "playerWon";
    const drew = round.outcome === "draw";
    if (won) roundsWon++;
    else if (!drew) roundsLost++;
    hud.setRounds(roundsWon, roundsLost);

    const need = Math.ceil(ROUND.bestOf / 2);
    if (roundsWon >= need || roundsLost >= need) showMatchEnd(roundsWon >= need);
    else window.setTimeout(toVs, 900);
  }

  function prepareShare(): void {
    const recordedDuel = mode === "duel" && !!capturedBout;
    const scoreRun = !!round && !!director && !["samepage", "puppet", "volley"].includes(mode);
    const can = recordedDuel || scoreRun;
    shareBtn.hidden = !can;
    shareBtn.textContent = recordedDuel ? "\u279A Challenge a friend" : "\u279A Share this score";
    shareField.hidden = true;
  }

  /** Fire-and-forget on-chain write. Never blocks play or the results screen. */
  function pushOnChain(score: number, place: number): void {
    const note = $("chainNote");
    if (!wallet.trackingOn) {
      note.hidden = true;
      return;
    }
    if (!wallet.address) {
      note.hidden = !wallet.isMiniPay;
      note.textContent = wallet.isMiniPay ? "Open in MiniPay to save this bout on Celo." : "";
      return;
    }
    note.hidden = false;
    note.textContent = "Saving bout on Celo…";
    const modeId = MODE_CHAIN_ID[mode] ?? 0;
    void wallet.recordMatch({ score, place, modeId }).then((hash) => {
      note.textContent = hash
        ? "Bout saved on Celo."
        : "Couldn’t save this bout — play still counts locally.";
    });
  }

  function paintWalletChip(): void {
    const chip = $("walletChip");
    // MiniPay rule: no Connect button. Chip only appears inside MiniPay (or after a quiet connect).
    const show = wallet.isMiniPay || !!wallet.address;
    chip.hidden = !show;
    chip.textContent = wallet.alias();
  }

  async function autoConnectMiniPay(): Promise<void> {
    if (!wallet.isMiniPay) {
      paintWalletChip();
      return;
    }
    const addr = await wallet.connect();
    paintWalletChip();
    if (addr && wallet.trackingOn) void wallet.signUp();
  }

  function commitProgress(score: number): void {
    if (!round || progressCommitted) return;
    progressCommitted = true;
    addDailyProgress({
      marks: marksAttempted,
      clears: round.kills,
      metres: mode === "glide" || mode === "bridge" ? score : 0,
    });
  }

  function renderEndStats(score: number): void {
    if (!round) return;
    const accepted = Math.max(0, marksAttempted - marksRejected);
    const accuracy = marksAttempted ? Math.round((accepted / marksAttempted) * 100) : 0;
    const third = mode === "glide" || mode === "bridge"
      ? { value: `${score}m`, label: "DISTANCE" }
      : mode === "copycat"
        ? { value: round.copyScore, label: "CHAINS" }
        : mode === "hunt"
          ? { value: round.huntScore, label: "INK FOUND" }
          : { value: round.kills, label: "CLEARS" };
    $("endStats").innerHTML = [
      { value: marksAttempted, label: "MARKS" },
      { value: `${accuracy}%`, label: "ACCURACY" },
      third,
    ].map((s) => `<div><b>${s.value}</b><span>${s.label}</span></div>`).join("");
  }

  function showRunEnd(): void {
    if (!round || !director) return;
    phase = "over";
    hud.show(false);
    const r = director.result(round);
    const info = modeInfo(mode);
    const isBest = recordBest(info, r.score);
    const isDailyBest = dailyRun ? recordDailyBest(r.score) : false;
    commitProgress(r.score);
    renderEndStats(r.score);
    $("endTitle").textContent = r.headline;
    $("endBody").textContent = isDailyBest
      ? `${r.detail}  —  today's new best.`
      : dailyRun
        ? `${r.detail}  —  today's best ${dailyBest().toLocaleString()}.`
      : isBest
      ? `${r.detail}  —  new best.`
      : `${r.detail}  —  best ${bestOf(info).toLocaleString()}.`;
    $<HTMLButtonElement>("againBtn").textContent = "Go again";
    prepareShare();
    screens.show("endScreen");
    pushOnChain(r.score, 0);
  }

  function showMatchEnd(won: boolean): void {
    phase = "over";
    hud.show(false);
    commitProgress(0);
    renderEndStats(0);
    if (mode === "duel" && won && !challengeBout) recordBest(modeInfo("duel"), ladderIndex + 1);
    if (mode === "samepage" || mode === "puppet" || mode === "volley") {
      $("endTitle").textContent = mode === "puppet"
        ? roundsWon > roundsLost ? "Left wins!" : "Right wins!"
        : mode === "volley"
          ? roundsWon > roundsLost ? "Bottom wins!" : "Top wins!"
        : roundsWon > roundsLost ? "Bottom wins!" : "Top wins!";
      $("endBody").textContent = mode === "puppet"
        ? "Balloon popped. Swap rods and run it back."
        : mode === "volley"
          ? "Inkball out. Swap ends and serve again."
        : "Swap ends and run it back.";
      $<HTMLButtonElement>("againBtn").textContent = "Again";
      prepareShare();
      screens.show("endScreen");
      pushOnChain(roundsWon, won ? 1 : 2);
      return;
    }
    $("endTitle").textContent = won ? "Champion!" : "Erased!";
    // A challenge match is not on the ladder, so it names the challenger.
    if (challengeBout) {
      $("endTitle").textContent = won ? "Beaten!" : "Erased!";
      $("endBody").textContent = won
        ? `You beat their round ${roundsWon}–${roundsLost}. Send one back.`
        : `They took it ${roundsLost}–${roundsWon}. Their marks are all in the link — run it again.`;
      $<HTMLButtonElement>("againBtn").textContent = "Run it back";
      prepareShare();
      screens.show("endScreen");
      pushOnChain(roundsWon * 100 + roundsLost, won ? 1 : 2);
      return;
    }

    const next = LADDER[ladderIndex + 1];
    $("endBody").textContent = won
      ? next
        ? `You out-drew ${opponent.name}. ${next.name} is sharpening up next.`
        : `You out-drew ${opponent.name} — that's the whole ladder.`
      : `${opponent.name} rubbed you out ${roundsLost}–${roundsWon}. The counters are all there.`;
    $<HTMLButtonElement>("againBtn").textContent = won && next ? `Face ${next.name}` : "Run it back";
    prepareShare();
    screens.show("endScreen");
    pushOnChain((ladderIndex + 1) * 1000 + roundsWon * 10, won ? 1 : 2);
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  const home = new Home((m) => { mode = m.id; });

  function paintDailyButton(): void {
    const best = dailyBest();
    $("dailyBtn").textContent = best
      ? `★ TODAY'S PAGE · BEST ${best.toLocaleString()}`
      : "★ TODAY'S PAGE · MARGIN MONSTER";
  }
  paintDailyButton();

  function offerChallenge(b: Bout): void {
    challengeBout = b;
    phase = "menu";
    const secs = Math.round((b.marks[b.marks.length - 1]?.t ?? 0) / 1000);
    $("chalBody").textContent =
      `${b.marks.length} marks over ${secs} seconds, replayed exactly as they were drawn. Best of three.`;
    screens.show("challengeScreen");
  }

  $("chalPlay").addEventListener("click", () => {
    clearChallenge();
    mode = "duel";
    home.select("duel");
    roundsWon = 0;
    roundsLost = 0;
    toVs();
  });

  $("chalSkip").addEventListener("click", () => {
    challengeBout = null;
    clearChallenge();
    home.paint();
    screens.show("titleScreen");
  });

  function startSelectedMode(): void {
    dailyRun = false;
    mode = home.mode.id;
    roundsWon = 0;
    roundsLost = 0;
    marksAttempted = 0;
    marksRejected = 0;
    progressCommitted = false;
    if (mode === "duel") {
      // Resume the ladder where you left off.
      ladderIndex = Math.min(bestOf(modeInfo("duel")), LADDER.length - 1);
      opponent = LADDER[ladderIndex];
      toVs();
    } else {
      toVs();
    }
  }

  $("learnBtn").addEventListener("click", startTutorial);
  $("coachSkip").addEventListener("click", endTutorial);
  $("playBtn").addEventListener("click", startSelectedMode);
  $("dailyBtn").addEventListener("click", () => {
    dailyRun = true;
    mode = "monster";
    home.select("monster");
    roundsWon = 0;
    roundsLost = 0;
    marksAttempted = 0;
    marksRejected = 0;
    progressCommitted = false;
    toVs();
  });
  $("howBtn").addEventListener("click", () => screens.show("howScreen"));
  $("howBack").addEventListener("click", () => screens.show("titleScreen"));
  $("startBtn").addEventListener("click", startRound);
  $("boardBtn").addEventListener("click", () => { paintBoard(); screens.show("boardScreen"); });
  $("boardBack").addEventListener("click", () => { home.paint(); screens.show("titleScreen"); });

  $("homeBtn").addEventListener("click", () => {
    phase = "menu";
    dailyRun = false;
    challengeBout = null;
    tutorial = null;
    coach.classList.remove("on");
    home.paint();
    paintDailyButton();
    screens.show("titleScreen");
  });

  const shareBtn = $<HTMLButtonElement>("shareBtn");
  const shareField = $<HTMLInputElement>("shareUrl");

  async function shareResult(): Promise<void> {
    const recordedDuel = mode === "duel" && !!capturedBout;
    if (!recordedDuel && (!round || !director)) return;
    const url = recordedDuel
      ? challengeUrl(capturedBout!)
      : `${location.origin}${location.pathname}`;
    const runResult = !recordedDuel && round && director ? director.result(round) : null;
    const text = recordedDuel
      ? "I drew this at you. Beat it."
      : `${dailyRun ? "Today's Page: " : ""}I scored ${runResult?.score.toLocaleString()} in ${modeInfo(mode).name}. Beat it.`;

    // The native sheet is the right answer on a phone — it reaches a chat app
    // in one tap. On a desktop it opens an OS dialog that is more friction
    // than a copy, so only touch devices get it.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({
          title: "Doodle Champion",
          text,
          url,
        });
        return;
      } catch {
        // Cancelled or refused — fall through to copying.
      }
    }

    // Reveal the link before trying the clipboard, so this is never a dead end
    // even when the copy is blocked (an unfocused window will refuse it).
    shareField.value = recordedDuel ? url : `${text} ${url}`;
    shareField.hidden = false;
    try {
      await navigator.clipboard.writeText(shareField.value);
      hud.say("link copied");
      shareBtn.textContent = "\u2713 Copied \u2014 send it to someone";
    } catch {
      shareField.select();
      shareBtn.textContent = "Copy the link below";
    }
  }

  shareBtn.addEventListener("click", () => { void shareResult(); });

  $("againBtn").addEventListener("click", () => {
    marksAttempted = 0;
    marksRejected = 0;
    progressCommitted = false;
    if (mode === "duel" && challengeBout) {
      roundsWon = 0;
      roundsLost = 0;
      toVs();
    } else if (mode === "duel") {
      const won = roundsWon > roundsLost;
      startMatch(won ? ladderIndex + 1 : ladderIndex);
    } else {
      roundsWon = 0;
      roundsLost = 0;
      toVs();
    }
  });

  // ---- the four octagon toggles -------------------------------------------
  const prefs = {
    sound: localStorage.getItem("dc.sound") !== "0",
    buzz: localStorage.getItem("dc.buzz") !== "0",
    lefty: localStorage.getItem("dc.lefty") === "1",
  };

  function paintToggle(id: string, on: boolean, onText: string, offText: string): void {
    const el = $(id);
    el.classList.toggle("off", !on);
    const tag = el.querySelector("i");
    if (tag) tag.textContent = on ? onText : offText;
  }
  function paintToggles(): void {
    sfx.enabled = prefs.sound;
    sfx.buzz = prefs.buzz;
    paintToggle("tSound", prefs.sound, "ON", "OFF");
    paintToggle("tBuzz", prefs.buzz, "ON", "OFF");
    // Handedness is a preference, not an on/off — it never dims.
    $("tHand").classList.remove("off");
    const h = $("tHand").querySelector("i");
    if (h) h.textContent = prefs.lefty ? "L" : "R";
    document.body.classList.toggle("lefty", prefs.lefty);
  }
  $("tSound").addEventListener("click", () => {
    prefs.sound = !prefs.sound;
    localStorage.setItem("dc.sound", prefs.sound ? "1" : "0");
    paintToggles();
  });
  $("tBuzz").addEventListener("click", () => {
    prefs.buzz = !prefs.buzz;
    localStorage.setItem("dc.buzz", prefs.buzz ? "1" : "0");
    paintToggles();
  });
  $("tHand").addEventListener("click", () => {
    prefs.lefty = !prefs.lefty;
    localStorage.setItem("dc.lefty", prefs.lefty ? "1" : "0");
    paintToggles();
  });
  paintToggles();

  // iOS keeps audio suspended until a genuine gesture.
  const unlock = () => sfx.unlock();
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("click", unlock, { once: true });

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  let lastOutcomeSeen: string = "playing";
  let heartsSeen = 3;
  let ghostHeartsSeen = 3;
  let waveSeen = 0;

  const loop = new Loop(
    (dt) => {
      if (phase === "learning" && round) {
        round.step(dt);
        hud.setInk(round.player.ink);
        hud.setHearts(round.player.hearts, round.ghost.hearts);
        if (round.feedback) { hud.say(round.feedback.text); round.feedback = null; }
        return;
      }
      if (phase !== "playing" || !round || !director) return;
      director.update(round, dt);
      round.step(dt);

      if (round.feedback) {
        hud.say(round.feedback.text);
        round.feedback = null;
      }

      if (round.killedThisStep > 0) sfx.play("kill");
      if (round.player.hearts < heartsSeen) {
        heartsSeen = round.player.hearts;
        sfx.play("hurt");
        sfx.vibrate([28, 40, 28]);
        const stage = $("stage");
        stage.classList.remove("hit");
        void stage.offsetWidth;
        stage.classList.add("hit");
      }
      if (round.ghost.hearts < ghostHeartsSeen) {
        ghostHeartsSeen = round.ghost.hearts;
        sfx.play(mode === "puppet" ? "kill" : "hurt");
        sfx.vibrate(18);
      }
      const waveNow = director instanceof SiegeDirector ? director.wave : 0;
      if (waveNow > waveSeen) { waveSeen = waveNow; if (waveNow > 1) sfx.play("wave"); }

      hud.setHearts(round.player.hearts, round.ghost.hearts);
      hud.setInk(round.player.ink);
      hud.setGhostInk(mode === "samepage" ? round.ghost.ink : null);
      hud.setReadout(director.readout(round));

      const verdict = director.finished(round);
      if (verdict && lastOutcomeSeen === "playing") {
        lastOutcomeSeen = verdict;
        hud.say(verdict === "draw"
          ? "draw!"
          : verdict === "won"
            ? (mode === "duel" ? "erased them!" : mode === "puppet" ? "popped!" : "held!")
            : mode === "puppet" ? "popped!" : "erased!");
        sfx.play(verdict === "draw" ? "wave" : verdict === "won" ? "win" : "lose");
        window.setTimeout(() => {
          lastOutcomeSeen = "playing";
          endRound();
        }, 950);
        phase = "over";
      }
    },
    () => {
      const hint: Half = tutorial && !tutorial.finished && !tutorial.celebrating
        ? tutorial.step!.half
        : null;
      if (round) scene.draw(round, input.wet, performance.now(), hint);
      app.render();
    },
  );

  function pauseGame(): void {
    if (phase !== "playing" && phase !== "learning") return;
    pauseFrom = phase;
    phase = "paused";
    input.enabled = false;
    input.cancel();
    loop.stop();
    hud.show(false);
    screens.show("pauseScreen");
  }

  function resumeGame(): void {
    if (phase !== "paused") return;
    phase = pauseFrom;
    screens.show(null);
    hud.show(true);
    input.enabled = true;
    if (phase === "learning") paintCoach();
    loop.start();
    hud.say("draw!");
  }

  $("resumeBtn").addEventListener("click", resumeGame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseGame();
  });

  loop.start();

  void autoConnectMiniPay();

  const incoming = readChallenge();
  if (incoming) offerChallenge(incoming);

  // A first-timer is pointed at the guide before anything else.
  if (!localStorage.getItem(SEEN_GUIDE)) {
    $("learnBtn").classList.add("nudge");
  }

  // Keep the page from scrolling behind the canvas on iOS rubber-band.
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault());
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<div style="padding:40px;font:16px system-ui">Failed to start: ${String(err)}</div>`;
});
