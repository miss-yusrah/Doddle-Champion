# Doodle Champion

**A one-thumb drawing duel on a sheet of paper — built for Celo MiniPay.**

Your finger is the pencil. The page is split by a fold: the bottom half is yours, the top half is theirs. You draw simple marks to defend, attack, dash, and erase. Rounds are short, ink is limited, and the same shape means something different depending on *where* you draw it.

Play free in the browser or inside MiniPay. Finished matches can optionally be saved on **Celo mainnet** through a tiny tracker contract. No wallet? The game still plays the same.

---

## What this app is

Doodle Champion started from a simple idea: if a game is about a pencil, the player should actually *draw*.

It is a **portrait, mobile-first web game**. You hold the phone upright and use one thumb on the lower half of the screen. There is no joystick, no button grid of special moves — only five marks, recognized from your strokes, and a rule that makes space matter:

> **Where you draw is what you get.**

A circle near you is a shield. The same circle across the fold is an ink bomb. A line at home is a wall; a line up close on their side is a slash. That single rule is the heart of the game.

Opponents in Duel mode are **ghosts** — recordings of marks replayed on a fixed clock — so a bout can travel as a URL with no server and no live netcode. Challenge a friend, and they fight the exact round you drew.

On Celo, MiniPay players get **zero-click wallet connect**, an in-game alias instead of a raw address, and optional on-chain match recording. Gameplay does not require crypto, and nothing is gated behind a “Connect Wallet” button inside MiniPay.

---

## Who it’s for

- Players who want a quick, tactile mobile duel
- MiniPay users who want a skill game that feels native in the wallet browser
- Builders looking at a small, honest Celo integration (record runs, fail soft, stay playable offline)

---

## How to play

### The page

- **Your half** = bottom of the screen (easy for a thumb)
- **Their half** = top of the screen
- You are the solid black doodle; the opponent is grey (a replay)

### The five marks

| Mark | Gesture tip | In your half | Across theirs |
|------|-------------|--------------|---------------|
| **Line** | Short straight flick | **Wall** — blocks one hit | **Slash** — damage (close range) |
| **Circle** | Close the loop | **Shield** — absorbs one hit | **Ink bomb** — lob / splash |
| **Zigzag** | Three or more sharp turns | **Tangle** — catches dashes | Mostly out of range |
| **Tick** | Out, then a clear stroke back (like a check mark) | **Dash** — move that way | Mostly out of range |
| **Cross** | Two strokes that cross | **Erase** — delete a nearby threat | Works anywhere |

Ink is limited and refills over time. Draw a few marks, then breathe. A rejected stroke costs no ink and often tells you how to fix it (*close the loop*, *more zigs*, …).

### The counter ring (duels)

```
Dash   dodges   Bomb
Bomb   breaks   Wall
Wall   stops    Slash
Slash  cuts     Tangle
Tangle catches  Dash
```

**Erase** sits outside the ring and answers anything — that’s why it costs more.

In longer duels the **Eraser** eventually eats the page from both edges so you cannot stall forever.

### Learn first

On the home screen, tap **Learn to draw**. It’s a six-step guided round with no clock and no losing. Do it once — especially the steps that teach *same mark, different half*.

Also open **MARKS (?)** for the fold diagram.

---

## Game modes

Ten featured modes on a swipeable home carousel. Same marks, different pressure.

| Mode | What it is |
|------|------------|
| **Duel** | Best of three against a recorded ghost. Climb the ladder from Scribbles to Inkja. |
| **Siege** | Eight waves of scribbles crawl down. Hold the baseline. |
| **Scribble Storm** | Endless, ramping, combo-driven score chase. |
| **Paper Glide** | Auto-run obstacle course. Line shoots, tick cape-dodges, circles bomb or shield. |
| **Same Page** | Two players, one phone. The half you start a stroke in is who you are. |
| **Margin Monster** | Solo boss — falling attacks are also its health. Clear eighteen to erase it. |
| **Doodle Volley** | Two local players flick one inkball across the fold. |
| **Drawbridge** | Auto-run over a tearing page: draw the bridge early or cape-flap across. |
| **Copycat** | Watch an expanding mark sequence, then draw it back in order. |
| **Ink Hunt** | Cross paper wrinkles to reveal inklings, then line or circle them. |

**Today’s Page** is a seeded Margin Monster run shared for the local calendar day, plus daily missions on **Your Board**.

**Duel** and **Same Page** enforce the fold (defend bottom, attack top). **Siege** and **Scribble Storm** relax that so you can barricade anywhere against descending scribbles.

---

## Challenges & sharing

Finish a duel and tap **Challenge a friend**. Your bout is packed into the URL fragment (no server, no personal data in the payload). On a phone that opens the native share sheet; on desktop it copies the link.

Whoever opens it fights *your* recording — same marks, same timing.

---

## Celo & MiniPay

### Design goals

- **Zero-click connect** inside MiniPay (`window.ethereum.isMiniPay`)
- **No** `personal_sign` / typed-data auth
- **Alias** identity (`INK AB12`), not a raw `0x…` as the player name
- **Fail soft** — missing wallet, declined tx, or no contract never breaks play
- **Network fee** paid in stablecoin (USDm) via fee abstraction when saving on-chain
- ERC-8021 **attribution** tag appended to tracker writes

### On-chain tracker

**Contract:** [`DoodleChampionTracker`](https://celoscan.io/address/0xaAF421C92B1005EdA7eEAa236049259D3732AD99) on Celo mainnet  
**Address:** `0xaAF421C92B1005EdA7eEAa236049259D3732AD99`

A minimal, ownerless contract:

- `signUp()` — idempotent register
- `recordMatch(score, place, modeId)` — auto-registers on first write
- `statsOf(player)` / global totals

No funds held, no admin keys, nothing to pause. Anyone records only their own runs.

Set the address in `.env.local`:

```bash
VITE_TRACKER_ADDRESS=0xaAF421C92B1005EdA7eEAa236049259D3732AD99
```

Without that env var, the game is fully local.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Bundler | Vite |
| Renderer | Pixi.js 8 |
| Recognition | `$1` unistroke + shape features (thumb-tuned) |
| Audio | Synthesized in-browser (no audio files) |
| Chain | Celo mainnet |
| Wallet | MiniPay via `viem` + `@celo/attribution-tags` |
| Contracts | Foundry / Solidity 0.8.24 |

**Platform:** mobile-first web (portrait). Desktop works for development. Tuned for phone thumbs; layout is normalized so a bout recorded on a small phone replays on a larger screen.

---

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173 — also prints a Network URL for your phone
npm run build
npm run check    # typecheck + recognition + simulation balance checks
```

Copy `.env.example` → `.env.local` and set `VITE_TRACKER_ADDRESS` if you want on-chain saves.

### Test in MiniPay

1. Serve over **HTTPS** (ngrok, Vercel, etc.)
2. Open the URL in MiniPay with Developer Mode
3. Alias chip should appear with no Connect button
4. Finish a run and confirm a `recordMatch` on Celoscan when you approve the tx

---

## Project layout

```
src/
  config.ts           tunables in one place
  core/               fixed-step loop, seeded RNG, normalized viewport
  input/              stroke capture + recogniser
  game/               rounds, modes, ghosts, share packing, progress
  render/             Pixi scene
  ui/                 DOM HUD / home / sfx
  wallet.ts           MiniPay + Celo tracker client (fail-soft)
contracts/
  src/DoodleChampionTracker.sol
  script/Deploy.s.sol
public/
  privacy.html
  terms.html
tools/                headless recognition & balance checks
```

---

## Privacy & safety

- Scores and settings live in **localStorage**
- Challenge links use the URL **fragment** (not sent to a host by this app)
- MiniPay only reads the account for alias + optional match writes
- Never commit `contracts/.env` (deployer key) or `.env.local`
- `.env.example` is safe to share

See in-app **Privacy** and **Terms**.

---

## One-line pitch

> Doodle Champion is a one-thumb ink duel for Celo MiniPay — draw to fight, share bouts as links, and optionally save your runs on-chain.
