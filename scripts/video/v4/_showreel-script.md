# maude — feature showreel + voiceover script (v5.2)

> ## ⚠ EXECUTOR DIRECTIVE — read before animating
> **The storyboard (`.design/ui/Studio Intro Video.tsx`) is INSPIRATION, not a
> spec.** Do NOT reproduce its frames 1:1. Your job is to ELEVATE — make each
> beat more cinematic, more real, more polished than the storyboard tile.
> - **Ground in the REAL assets**, not the storyboard mocks: the captured
>   screenshots in `.design/_assets/showreel/` + `scripts/video/v4/_research/`
>   (real Studio, canvas, DS specimen, moodboard), the real terminal capture
>   `scripts/video/final/public/v4/cli.mp4`, the real geometry SVGs in
>   `.design/_draw/`, real `.ai/` artifacts (DDR-070, plans, scenario reports),
>   real `.design/ui/*.registry.json`. Re-capture fresh/higher-res where needed.
> - The storyboard fixes the **order, the beat, the VO line, and what each beat
>   must prove** — not the exact composition. Improve the composition.
> - Bar: would a designer screenshot it? If a beat only matches the mock, it has
>   failed. Push past it.

> **Pivot (2026-06-09).** Not a tutorial — a **showreel**: top features as a
> cinematic sequence that blows people away. Install dropped. Voiceover via
> ElevenLabs. Every beat grounded in a REAL maude capability (verified against
> `plugins/` + `apps/studio/` + `.ai/plans/`).
>
> **v5.1 changes (user):** DS moved to #2 and made richer (world-class
> questionary → moodboard shows the direction → robust full design system);
> added the emotional core — **"you talk to the AI *through* the canvas"**;
> expanded **flow as a second brain** (what it does + why it matters).
> **v5.2 changes (user):** added **multiplayer** (beat 65 — live, peer-to-peer
> via a self-hosted hub, no SaaS); **layered the second brain across 3 screens**
> (memory 92 · continuity 94 · ships 96); reframed handoff as **"to any
> production code"** (not shadcn-only).

## The cut — 15 beats, ≈90 s

Arc: **hook → a real design system, from a conversation → a canvas → it builds →
it judges itself → ✦ you direct it by pointing & drawing ✦ → and you're not alone
(multiplayer) → it does the hard things (vector, motion) → it ships → and it
remembers (a second brain, in three layers).**

| # | beat | feature (the wow) | on screen | grounded in | ~dur |
|---|------|-------------------|-----------|-------------|------|
| 00 | Cold open | the hook | dark void → `maude` resolves, one cursor on the dotted canvas | wordmark + canvas | 4s |
| 10 | The questionary + moodboard | DS discovery built on how the best designers work → a moodboard shows the direction | the Claude TUI asking sharp discovery Qs → a real "1am pinboard" moodboard assembles (type, swatches, mood + reference cards) | `/design:setup-ds` + `.design/_moodboard/*` | 8s |
| 20 | The robust design system | a full, tokenized DS — not a palette, a system | editorial specimens fan in: "Accent. One indigo.", type ladder, spacing, elevation, motion, components | real `system/maude/preview/*` specimens | 7s |
| 30 | The canvas | infinite multi-artboard canvas, in your repo | camera flies across a real canvas full of artboards; WORLD minimap | real `Canvas Viewport.tsx` / Studio | 5s |
| 40 | It draws itself | canvas-first iteration in real TSX | `/design:new` — a screen builds live on your DS: skeleton → hero → tokens → CTA, presence cursor | real Studio chrome + canvas fill | 7s |
| 50 | It critiques itself | critic panel + auto-fix loop | verdict card: signature/a11y/type/restraint scores resolve → "✓ auto-fix · 2 applied" | critic PANEL.md shape (illustrated) | 6s |
| 60 | **✦ You talk to it through the canvas** | the aha — point, comment, draw → it acts | ⌘-cursor lands on an element → chip `Hero.tsx:42`; a comment pin drops on a pixel; a hand-drawn arrow + "make this bigger" → the element changes | real Studio inspector + comments + annotations | 9s |
| 65 | Multiplayer | live, peer-to-peer, no SaaS | two (three) presence cursors move on the same canvas live; an edit by one peer lands for everyone; a `maude hub` invite link / connected-peers card | real `maude hub serve` + bidirectional sync (Phase 9) | 7s |
| 70 | Draw as code | the geometry engine (the moat) | a logo/icon assembles from geometry (splines/grid), crisp at 16px + single-color flatten | real `/design:draw` engine | 6s |
| 80 | Animate once | to-lottie, web + native 1:1 | a mark animates → emits `one .lottie` → same motion on a web frame + a phone frame | real `/design-video:to-lottie` | 6s |
| 90 | Ship it | handoff to ANY production code | a component drops into a real codebase — Next.js / Vite / Bun / raw TSX (shadcn registry is one path); `+ components/…tsx` lands wired to your tokens | real handoff / export (registry + raw code) | 5s |
| 92 | Second brain · it remembers | plans + decisions + continuity, in your repo | a PRD-grounded plan checklist forms → a DDR decision card ("what · why · revisit") → a HANDOFF/STATE timeline (pause today, resume tomorrow) | real `/flow:plan` + `.ai/decisions` + `/flow:pause`+`resume` | 6s |
| 94 | The daily loop | the everyday rhythm: plan → execute → done | three command cards pulse in sequence — `/flow:plan` · `/flow:execute` · `/flow:done` — day after day | real flow daily verbs | 5s |
| 96 | Nothing slips through | every ship runs the full gate | a checklist ticks green in a cascade: security review (defender + attacker) · code review · validation (lint · type · tests · build) · smoke tests · 5-platform scenarios → the PR opens | real `/flow:done` gate + `/flow:validate` + scenario-runner + security-auditor/ethical-hacker | 7s |
| 99 | End card | the close | brand lockup + `npm i -g @1agh/maude` + trust line, loop-safe to the void | real `logo.tsx` mark | 4s |

**What carries the film:** DS-from-a-conversation (10–20), the
talk-through-the-canvas aha (60), multiplayer (65), and the three-layer
second-brain (92–96). The moat trio (DS · vector · motion) is the visual
crescendo; the aha (60) is the heart.

Pure-design ≤70 s cut = drop 92–96 (keep a one-line second-brain nod). Default =
full ~90 s.

---

## Voiceover script (ElevenLabs)

**Voice direction:** dry, confident, unhurried — a senior designer who doesn't
oversell. Anti-corporate. Lets the visuals breathe; sparse, not wall-to-wall.
Short sentences, hard stops. Slight pause at each em-dash. The line at beat 60
("…it just gets it.") is the warmest — a small, knowing smile, not a hype shout.

**Suggested ElevenLabs settings:** a low/measured voice; Stability ~55,
Similarity ~75, Style ~15 (low exaggeration), Speed ~0.95. Render each line as a
separate clip so timing locks to the cut.

### Per-beat (line + delivery)

> **v5.3 copy pass (2026-06-09):** tightened every line — cut filler ("And…",
> "Then…", "It starts the way…"), sharper verbs, harder stops. Weak middles
> rewritten. The lines below are the current authoritative set.

- **00 · Cold open** — *"Every design tool pulls you out of your code."* — beat — *"Not this one."* _(cold, deadpan; lands on "Not this one")_
- **10 · Questionary + moodboard** — *"It opens like a real designer would — sharp questions, real research, and a moodboard that commits to a direction."*
- **20 · Robust DS** — *"Then a whole design system, built for you. Colour, type, space, motion, components — every token, in place."*
- **30 · The canvas** — *"One infinite canvas. Every screen of your product — inside Claude Code."*
- **40 · It draws** — *"Describe a screen. Watch it appear. Real components, real tokens, real code."*
- **50 · Critics** — *"A panel of critics grades it — accessibility, type, restraint — then fixes what it flags."*
- **60 · ✦ Talk through the canvas** — *"Here's the part that lands: you don't prompt it."* — beat — *"You point. You comment on a pixel. You draw on it. And it understands."* _(the heart — warm, unhurried)_
- **65 · Multiplayer** — *"And you're not the only cursor. Live, peer to peer, through a hub you run — no SaaS, no sign-up."*
- **70 · Draw as code** — *"Logos, icons, diagrams — drawn by a geometry engine. Computed, never guessed."*
- **80 · Animate once** — *"Animate it once. Ship a single file — web and native, frame for frame."*
- **90 · Handoff** — *"Then hand it off — into any codebase. Next, Vite, Bun, or raw — wired to your tokens."*
- **92 · Second brain · it remembers** — *"And it remembers everything. Every plan, every decision, the reason behind it. Close the laptop — tomorrow it picks up mid-thought."*
- **94 · The daily loop** — *"After that, it's a rhythm. Plan. Execute. Done."*
- **96 · Nothing slips through** — *"And nothing ships unchecked — security, code review, tests, five platforms — every time. Then it opens the PR."*
- **99 · End card** — *"maude. No telemetry. No sign-up. Your repo is the source of truth."*

### Clean VO block (paste into ElevenLabs, one line per clip)

```
Every design tool pulls you out of your code… not this one.
It opens like a real designer would — sharp questions, real research, and a moodboard that commits to a direction.
Then a whole design system, built for you. Colour, type, space, motion, components — every token, in place.
One infinite canvas. Every screen of your product — inside Claude Code.
Describe a screen. Watch it appear. Real components, real tokens, real code.
A panel of critics grades it — accessibility, type, restraint — then fixes what it flags.
Here's the part that lands: you don't prompt it. You point. You comment on a pixel. You draw on it. And it understands.
And you're not the only cursor. Live, peer to peer, through a hub you run — no SaaS, no sign-up.
Logos, icons, diagrams — drawn by a geometry engine. Computed, never guessed.
Animate it once. Ship a single file — web and native, frame for frame.
Then hand it off — into any codebase. Next, Vite, Bun, or raw — wired to your tokens.
And it remembers everything. Every plan, every decision, the reason behind it. Close the laptop — tomorrow it picks up mid-thought.
After that, it's a rhythm. Plan. Execute. Done.
And nothing ships unchecked — security, code review, tests, five platforms — every time. Then it opens the PR.
maude. No telemetry. No sign-up. Your repo is the source of truth.
```

Word count ≈ 195 → ≈ 78–82 s of speech over a ≈90 s cut.

### Czech variant

```
Každý designový nástroj tě tahá pryč z kódu… tenhle ne.
Otevře to jako skutečný designér — ostré otázky, opravdová rešerše a moodboard, který se rozhodne pro směr.
Pak celý design systém, postavený pro tebe. Barvy, písmo, prostor, pohyb, komponenty — každý token na svém místě.
Jedno nekonečné plátno. Každá obrazovka tvého produktu — přímo v Claude Code.
Popiš obrazovku. Sleduj, jak vznikne. Reálné komponenty, reálné tokeny, reálný kód.
Panel kritiků ji oznámkuje — přístupnost, typografie, zdrženlivost — a co najde, opraví.
A teď to, co sedne: nepíšeš prompty. Ukážeš. Okomentuješ pixel. Nakreslíš to. A ono to pochopí.
A nejsi jediný kurzor. Živě, peer to peer, přes hub, který si hostuješ — žádný SaaS, žádná registrace.
Loga, ikony, diagramy — kreslí geometrický engine. Spočítané, nikdy odhadem.
Naanimuj to jednou. Pošli jediný soubor — web i nativ, frame po framu.
Pak to předej — do jakékoliv codebase. Next, Vite, Bun, nebo čistý kód — napojené na tvoje tokeny.
A pamatuje si všechno. Každý plán, každé rozhodnutí, důvod za ním. Zavři notebook — zítra naváže uprostřed myšlenky.
Pak už je to rytmus. Plan. Execute. Done.
A nic se nenasadí nezkontrolované — security, code review, testy, pět platforem — pokaždé. Pak otevře PR.
maude. Žádná telemetrie. Žádná registrace. Tvé repo je zdroj pravdy.
```

---

## Why these features (verified against the real code)

- **DS from a conversation (10–20)** — `/design:setup-ds` runs a discovery built on
  designer-grade probes + `ux-research-agent` (WebSearch mood/color/type research),
  emits a real moodboard (`.design/_moodboard/`), then scaffolds a full tokenized
  system with a completeness-critic. Unique vs. "AI makes a palette."
- **Talk through the canvas (60)** — the real product surface: Cmd+Click maps a
  pixel to its exact source line (`data-cd-id` + `_locator.json`), pixel-anchored
  comments + FigJam annotations feed the next `/design:edit`. This is the
  emotional core: directing AI by pointing/drawing, not prompting.
- **Multiplayer (65)** — Phase 9 self-hostable hub (`maude hub serve`, Hocuspocus +
  SQLite): real-time presence cursors + bidirectional file sync so a peer's edits
  land on disk (and Claude sees them). Peer-to-peer through a hub YOU host — "live
  collab without SaaS, tunnel mode, or partykit." DDR-051/053.
- **Draw as code (70)** — DDR-070 geometry engine: deterministic SVG (splines / A*
  routing / optical corrections), one source → SVG + JSX, self-verify loop. No
  hallucinated path data.
- **Animate once (80)** — DDR-094 keyframe IR → one `.lottie` rendering 1:1 on web
  + native.
- **Handoff to any production code (90)** — export engine emits a component into a
  real codebase: a shadcn `registry-item.json` (Next/Vite/Bun `shadcn add`) is ONE
  path; raw TSX + tokens + CSS is another. Framework-agnostic, wired to your tokens.
- **Second brain (92–96)** — the `.ai/` workspace as the everyday driver:
  - *92 it remembers* — PRD-grounded plans + DDR decision records (institutional
    memory) + pause/resume across sessions. Context + decisions survive, so you
    (and the AI) never re-litigate or re-discover.
  - *94 the daily loop* — `plan → execute → done`, the flow "daily verbs" you live
    in feature after feature.
  - *96 nothing slips* — every `done` runs the full gate: security review
    (`security-auditor` defender + `ethical-hacker` attacker, in parallel), code
    review, validation (lint · type · tests · build), smoke tests, and a
    5-platform scenario runner (web-desktop/mobile · iOS phone/tablet · Android)
    — then the PR. The "everything is covered" beat.

## Per-beat animation direction (from canvas review · 2026-06-09)

> These are the user's notes left as comments on the storyboard artboards. They
> are EXECUTE-phase direction (transitions, motion, what to demonstrate) — the
> storyboard tiles can't show them statically. Honor them when animating.

- **00 cold open** — add MORE cursors/arrows; label some "Claude Code" / "AI agent"
  so it's instantly clear this is a **human × AI collaboration** tool, not solo.
- **10 questionary + moodboard** — show **2–3 REAL questions + answers as chat
  bubbles** (messenger style); as each answer lands, **assets appear on the
  moodboard** in sync (answer → board grows). Real Q text from `_DISCOVERY-v1.md`.
- **20 robust DS** — scatter real specimen components, **float-animate** them
  dynamically; transition = they swirl into a **vortex and vanish**.
- **30 the canvas** → **MERGE with beat 60** (talk-through-canvas). One canvas beat.
- **40 it draws itself** — no real capture needed; animate the **wave-pulsing
  "AI is editing" overlay** (the real Studio effect) over placeholder/random
  screens appearing. Reuse elements from `Studio.tsx`.
- **50 critics** — **map ALL critics, miss none.** Real roster: `design-critic`,
  `a11y-critic`, `frontend-critic`, `graphic-design-critic`, `typography-critic`,
  `motion-critic`, `brand-critic`, `copy-critic`, `info-architecture-critic`,
  `signature-moment-critic`, `draw-critic` (+ `design-system-completeness-critic`,
  `design-system-keeper`). Show the panel resolving across these, not just 4.
- **60 talk through canvas** (absorbs 30) — needn't be a real capture, but must
  clearly demo a **real canvas**: draw · annotate · comment · move. Placeholders
  OK but **genuinely wow**.
- **65 multiplayer** — **continuous from 60**: keep the scene, just add more mice
  over the canvas + a dramatic **"It's multiplayer"** title.
- **70 draw as code** — the SVG shown must be **genuinely top-tier** (clearly
  proves SVG mastery). Sets up the transition into 80 where the **same SVG
  animates**.
- **80 animate once** — **transition: the static SVG from 70 comes alive**, then
  places into desktop + mobile devices. The animation must have **grády** — pull
  real motion inspiration (research online).
- **90 handoff** — current is poor. Make it a **swipe-left of the placeholder
  screens from 40**, right side reveals **real code (split-screen)** with an
  animation of it **flowing left→right from canvas into code**.
- **92 second brain** — make it an **infographic / diagram / illustration** so
  what's happening is instantly understandable (not a flat card).

## Notes for the rebuild

- Beats 30/40/60/65 reuse the faithful **real Studio chrome** component (build once).
- The moat trio (20 DS · 70 vector · 80 motion) gets the music crescendo; the aha
  (60) gets a beat of near-silence before the line lands.
- Multiplayer (65): show 2–3 distinctly-coloured presence cursors moving at once +
  a peer edit landing for everyone (the bidirectional-sync proof).
- Second brain (92–96): three short screens, punchy rhythm — memory → continuity →
  ships. Keep each ≤6 s so the layering reads as cadence, not drag.
- Music bed under VO; hard cuts on 70/80.
