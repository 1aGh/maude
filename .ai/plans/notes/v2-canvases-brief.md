# Maude v2 — canvases in practice (shared brief for every canvas agent)

**Request (Michal, verbatim, 2026-10-06):**
> nejaky zakladni design system mame, pojdme ho rozkreslit v praxi design:new. Udelej novou slozku v canvases a chci videt hlavne
> * zakladni user flow tvorby a praci s canvasem
> * nejaky onboarding ale ne tak slozity jako ted, vse smerujeme predevsim na to aby uzivatele pouzivali cloud.maude.sh vse ostatni je advanced ale rozkresli to a nebo chci jen vytvorit lokalni projekt
> * Jak pouzivat AI chat a edge cases kdy pojede nekolik sessions zaraz
> * Ruzne mody edit/preview/present atd.
> * empty states
> * advanced mode
> * video editing
> * artboard kinds print/web/digital/video atd.
> * export
> * ...co te jeste napadne
>
> Vse rozkresli jako edge cases napriklad Maude/alligators ktery uz ma docela komplikovanou strukturu i spoustu ruznych artboards a typu

## Where things go

- Folder: **`.design/ui/v2/`** (new). Canvas = `.design/ui/v2/<NN Name>.tsx` + sibling `<NN Name>.css` + `<NN Name>.meta.json`.
- Shared app chrome kit: **`.design/ui/v2/_kit.tsx` + `_kit.css`** (underscore ⇒ hidden from the canvas tree). Every canvas imports it. **Canvas agents never edit `_kit.*`** (parallel agents would race). If the kit lacks something, build it locally in your canvas file with a canvas-specific class prefix, and list it under "kit candidates" in your report so the main agent can promote it.
- DS = **maude-v2**. Read, in this order, before writing a line:
  1. `.design/system/maude-v2/CONTRACT.md` — menu tree, keys, words, voice, §6 settled details (empty-canvas line, Share primary = Invite, tab menu, save-status words, tab avatar = project initial). **Wins over everything.**
  2. `.design/system/maude-v2/SKILL.md` + `README.md` — rules, token roles.
  3. `.design/system/maude-v2/preview/ui_kits-desktop-showcase.tsx` — **Tier-0 prior for the shell** (window, project tabs, project pill, Canvases panel, toolbar, AI chat panel, inspector, Share cluster, zoom/undo, Home). Lift, don't reinvent.
  4. `.design/system/maude-v2/preview/iconography.tsx` (glyph family) + `logo.tsx` (the mark — lifted verbatim, never redrawn).
  5. `.ai/plans/notes/v2-triage-draft.md` — what is Core / Contextual / Advanced / Automatic, and principle 0 **nothing is deleted, only hidden**.
- Tokens: `.design/system/maude-v2/colors_and_type.css`. Components: `preview/_components.css` (`.island`, `.dock`, `.btn`, `.icon-btn`, `.input`, `.seg`, `.switch`, `.chip`, `.kbd`, `.row-item`, `.sticky--*`, `.ask`, `.collapsible`).

## Canvas file shape

```tsx
/**
 * @canvas      <NN Name> — <one line>
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   <id> | <id> | …
 * @brief       <the slice of the request this canvas answers, verbatim where possible>
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./<NN Name>.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { … } from "./_kit";
```

- Each artboard body is wrapped in `<div className="maude-v2" data-theme="light">` (the host injects the old `maude` tokens on `:root`; the scoped wrapper wins). The kit exports a `<V2>` wrapper for this.
- App-window artboards: **1440 × 900, `fixed`**. Close-ups (a panel, a sheet, a menu): sized to content (e.g. 560 × 640), `fixed`. Print/web/video artboards *inside a mock* are drawn as mock content, not real `kind=` artboards — EXCEPT in `08 Artboard Kinds`, which may use real `kind` artboards to show the real thing next to the mock.
- Sections (`DCSection`) = one scenario each: **happy path first, then edge cases**. Section title says the scenario; subtitle names the edge case in plain words.
- Every artboard carries a short **note** (kit `<Note>`: max ~2 sentences, ≤60ch lines) saying *what the user sees and why*, placed outside the app window area (a 1440×900 window + a note strip ⇒ use 1440 × 980 when the note sits below; or put notes in a narrow 360-wide "explainer" artboard at the start of each section). Pick one convention per canvas and stay consistent.
- `.meta.json`: `{ "title", "subtitle", "brief", "platform": "desktop", "designSystem": "maude-v2", "opt_out_scope": "palette", "sections": [{id,title,subtitle}], "artboards": [{id,label,note}], "created", "last_modified" }` — **no `layout`/`viewport` keys** (the engine auto-lays out; camera lives in `_canvas-state`).
- CSS: every value a `var(--*)` token; no hex; prefix classes with a short canvas prefix (e.g. `.cf-` for Create Flow). No `vw`/`vh`/`@media` inside artboards (use `@container` if needed). Weights stop at 600. Mono only inside Advanced surfaces.

## Realism — the edge-case projects

Use **real** content, never Lorem. Two projects in the window tabs:

**Alligators brand** (the complicated one — modelled on the real `~/Maude/alligators` project, cloud-linked to `alligators.cloud.maude.sh`, Czech content):
- ~93 canvases in folders: `2026/combine` (Combine-kampan — 15 artboards incl. 2 print; Combine-letak-registrace; Combine-invite; Combine-cisla; Combine-video-AI), `2026/dresy` (Uniformy-2027 — 12 artboards: helma z boku, kalhoty doma/venku…), `2026/social` (Super-Bowl-Watch-Party, Reprezentace-U19, Krpole-v-pohybu, summer-camp…), `club-web` (website, admin, admin-states, flows, responsive), `print` (LetakA6 — 4 print artboards: A · přední FLAG, B · zadní…; AlligatorsAcko), `social` (matchday — 7 artboards, score-mvp, sponsors, gameweek-schedule, video-hype — Reels 9:16 + 16:9, video-recap, video-touchdown, video-nabor…), `legacy` (old moodboards), plus junk at the root (`test`, `Test2`, `ahoj`, `ahoj2`) — a real messy project.
- 247 assets (match photos, logos, footage `.mov/.mp4`, music), its own DS "alligators" (green), several AI chat sessions in history.
- People: **You**, **Tereza**, **Jonas** (CONTRACT §4).

**Studio site** (the simple one): canvases Homepage, Pricing, Onboarding, Mobile — detail.

Edge cases to keep in mind everywhere: 93 canvases (search + folders + recents matter), long Czech labels that truncate, mixed artboard kinds in one canvas, many people + AI at once, offline / sync pending, a local-only project next to a cloud one, two windows of the same project.

## Product rules to draw (from the triage + contract)

- Cloud first: the default path is **sign in to cloud.maude.sh → your team's projects**. "Just a local project" is one clear secondary choice. Self-hosted hub, CLI, git, Claude Code plugin, ports = **Advanced** (reachable, never in the way).
- One menu under the project pill; Search ⌘K finds every hidden tool; ⌘\ hides panels; ⌘/ Ask AI; context summons tools (inspector on selection, timeline only for a video artboard); Advanced is a disclosure at the foot of each panel; status is shown in words, not operated (Saved / Syncing… / Offline — changes kept on this Mac).
- Designer vocabulary only (CONTRACT §3). App never says "we"/"I" (exception: "What shall we make?"). AI messages describe results. One action per toast/callout. Dialog title verb = primary button; other button Cancel.

## Verification (each canvas agent does this before reporting)

1. Dev server: `http://localhost:4402` (already running — `maude design server-up --root /Users/iagh/git/personal/maude` returns the port). Canvas URL: `/_canvas-shell.html?canvas=ui/v2/<NN Name>.tsx` (URL-encode spaces).
2. Screenshot every artboard: `AGENT_BROWSER_SESSION=<your-unique-id> maude design screenshot --screen <artboardId> --canvas "ui/v2/<NN Name>.tsx" --out <scratch>/…png` (run `maude design screenshot --help` first for the exact flags). **Read every PNG.** Fix overlaps, clipped text, empty frames, wrong theme, console errors.
3. Dark theme: render at least two artboards with `data-theme="dark"` (kit `<V2 theme="dark">` or the screenshot `--theme` flag) to prove the canvas is theme-clean.
4. Self-review against CONTRACT words/voice/menu/keys and the "nothing deleted" rule; grep your files for hex colours and banned words.
5. Report: artboard list (id · label · one-line note), screenshot dir, kit candidates, open questions for Michal. Keep it short.

## Lessons from wave 0 (kit + 01 Create Flow) — read this

- **Reference canvas:** `.design/ui/v2/01 Create Flow.tsx` — study how it composes `_kit` (Stage 1440×980 = window + note strip, TABS, CanvasesPanel, AIPanel, Inspector, Artboard + mocks, Toast, SearchPalette…). Match its conventions (artboard ids prefixed with your canvas prefix, Stage + Note per artboard).
- **Kit API:** the header comment of `.design/ui/v2/_kit.tsx` lists every export + props. `KIT ADDITIONS` glyphs exist (kinds, offline, laptop, lock…).
- **Screenshots:** `maude design screenshot --screen` captures at fit-all zoom (~156 px wide) — useless here. Copy the 1:1 capture script `/private/tmp/claude-501/-Users-iagh-git-personal-maude/c005b008-c24c-4d74-90c5-548ed2a2ed37/scratchpad/cf/cap.sh` into your own scratch dir, change `AGENT_BROWSER_SESSION`, `OUT` and the canvas URL, then `bash cap.sh light <id> <id>…` / `bash cap.sh dark <id>…`. It strips the host's forced artboard theme and pans each artboard to 1:1.
- **Settled answers:** offline empty canvas adds a second line "AI is back when this Mac is online."; artboard right-click menu = Ask AI about <name> · Duplicate · Duplicate at another width › · Rename · Copy · Paste · Export… · Move to trash; picking a preset (Print A4, Reels 9:16…) sets the artboard's kind.

## Cross-canvas rules (CONTRACT §7) — every canvas follows these
AI offline = queued prompt + "AI is back when this Mac is online." · AI not connected = Ask AI unchanged, connect sheet on first use · Home always shows "Start with an empty canvas ⌘N" (kit default) · one AI per artboard (queue / Run on a copy) · "moved to the trash", never "deleted" · mode switch in the Share cluster.
Export done toast = Show in Finder · ⇧⌘E default scope = this canvas, Scope always visible · print colour line "RGB — the print shop converts to CMYK" · ⇧⌘T show/hide timeline; tap Space plays, hold Space = Hand.
