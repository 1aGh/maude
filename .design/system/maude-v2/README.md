# maude-v2 — "Light glass with a spark"

The design language for the **Maude v2.0.0 redesign**: a designer-first desktop app
where the canvas is the whole window and the chrome floats over it. You install it
and create; nothing to configure, the app handles it for you.

> **Direction locked 2026-10-05** at the Stage-3 moodboard
> ([`ui/v2/maude-v2-moodboard.tsx`](../../ui/v2/maude-v2-moodboard.tsx), artboard
> `direction-mix`): base **"Mac-native light glass"** (macOS Liquid Glass × Craft ×
> Framer) + **a touch of play** from "Playful workshop" (FigJam × Kinopio). Lives next
> to the existing `maude` DS, which stays the contract for today's client until the
> v2 migration. Plan: [`.ai/plans/notes/v2-redesign-approach.md`](../../../.ai/plans/notes/v2-redesign-approach.md).

## What this DS is for

The Maude Desktop app and the maude.sh docs/site, rebuilt for **designers and
non-coders**. Everything that used to be visible chrome (status pills, ports, paths,
git jargon) moves out of sight — into one menu under the icon, ⌘K, or a panel's own
Advanced section. **Nothing is deleted, only hidden.** Power users find it all.

## The feeling

**Lightness — "it handles it for me."** Calm, crafted, a pro who knows what they're
doing and doesn't show off. Attractive like Framer, effortless like Craft, playful
like FigJam only where play belongs: on the canvas and in the AI's moments.

## The three signature codes (tvar · symbol · motion)

1. **Shape — floating islands that fold into an icon.** Every piece of chrome is an
   `.island`: frosted (~88 % opaque, never peek-through), compact, soft concentric
   radii (island 14 › control 10 › chip 6), a 0.5 px inner edge. Any island collapses
   into a single icon button (`⌘\` toggles all). The dock is rounder (20) and a little
   chunkier than the rest.
2. **Symbol — the spark.** The logo mark (the spark on the message-bubble tile) is
   lifted verbatim, never redrawn. The bare spark marks **the AI** wherever it speaks
   or acts.
3. **Motion — gentle, with a drop of spring.** Panels collapse and open on
   `--dur-panel` + `--ease-out`. Feedback starts within one frame; chrome motion finishes within 280 ms (`--dur-route`), most of it far sooner. `--ease-spring` /
   `--dur-spring` are reserved for playful moments only (AI finished, a new sticky
   lands). Reduced motion collapses every duration to 1 ms.

## Contract

Menu structure, keyboard shortcuts, the exact words and the voice rules live in [`CONTRACT.md`](./CONTRACT.md). Specimens and canvases copy it; when they disagree, the contract wins.

## Tokens

Authoritative: [`colors_and_type.css`](./colors_and_type.css). Light is the default;
dark is an equal-status theme (every family token is declared in both).

| Role | Tokens | Rule |
| --- | --- | --- |
| Canvas | `--canvas-bg`, `--canvas-dot`, `--canvas-grid` | The page is the canvas — a quiet dot grid, edge to edge. |
| Surfaces | `--bg-0` … `--bg-4` | Canvas → island → popover → input well → pressed. |
| Island | `--island-bg`, `--island-blur`, `--island-edge`, `--island-shadow` | The floating-chrome material. Chrome only. |
| Accent | `--accent*` (azure, hue 238 — L 0.53 light / 0.54 dark so white text holds AA; `--accent-text` for azure words; `--focus-ring` for keyboard focus outlines — lighter in dark so it holds 3:1 on bg-3/bg-4) | **Functional only:** primary action, current selection, focus. One job per surface. |
| Spark | `--spark*` (vermilion, hue 36; dark ink on it, `--spark-text` for words) | **The AI only:** agent cursor, Ask-AI send, AI-made badges. Never decoration, never an error. |
| Objects | `--object-*` | Stickies, shapes and canvas colours. Colour lives on the canvas, not in chrome. |
| Status | `--status-*` | Always paired with an icon or a word; error (hue 22) never relies on hue alone next to the spark. |
| Presence | `--presence-*`, `--presence-agent` (= spark) | People and the agent on the canvas. |
| Type | `--font-display` / `--font-body` (SF Pro), `--font-rounded` (SF Pro Rounded), `--font-mono` (SF Mono) | Native faces. Rounded for playful surfaces (empty states, onboarding, stickies). **Mono only in Advanced and code.** |
| Scale | `--type-xs` 11 … `--type-3xl` 35 | Ratio 1.2 from a 14 px base; xs/sm held at legible UI floors. |
| Space | `--space-1` 4 … `--space-8` 64 | 8 px rhythm with a 4 px half-step (the half-step is for dense Advanced panels). |
| Motion | `--dur-flip/soft/panel/route/spring`, `--ease-out/in-out/spring` | Gentle; spring only for playful moments. |

## Hard rules (sub-agents and critics enforce these)

- **Chrome floats; it never frames.** No docked bars around the canvas, no full-height
  sidebars by default. Islands are small and fold into an icon. A docked layout exists
  only as an Advanced option (Figma's UI3 lesson: big floating panels cramp the canvas).
- **Azure acts, the spark is the AI, colour lives on the canvas.** Don't fill chrome
  with `--object-*`; don't use `--spark` for anything the AI didn't do.
- **Edit toolbar is monochrome 18 px; the Preview toolbar may carry the object colours of the thing each tool makes** (sticky colour, marker ink, stamp disc — 48 px buttons, 22 px glyphs, CONTRACT §2).
- **No developer chrome in the default view.** No ports, paths, PIDs, SHA, branch names,
  status stamps or slash commands. They live in the icon menu ▸ Diagnostics, ⌘K, or an
  Advanced section. Hiding is fine; **deleting a capability is not.**
- **Advanced is a layer inside a panel**, never a separate app mode.
- **No glass on content.** Frost is for the navigation layer only; never a glassy card
  in the canvas content, never a translucent sheet that lets the design peek through.
- **No decorative gradients in chrome**, no purple-pink hero gradients, no emoji in chrome.
- **Tokens only.** No hardcoded colours or off-ladder type sizes in specimens.

## Voice

Quiet pro with a warm touch. Talks about the user's work, not the tool. Short labels
in everyday nouns — *canvas, artboard, project tab, AI chat panel, toolbar, layer,
comment, frame*. No hype, no exclamation marks, no jargon.

- "Your canvas is ready. Ask AI for a first screen, or start drawing."
- "Done — three hero variants are on the canvas. Pick one."
- "Panels tucked away. Press ⌘\ to bring them back."

## Brand

The logo stays — a verbatim copy lives in [`assets/logos/`](./assets/logos/) (`mark.svg`, `wordmark.svg`, `favicon.svg` re-coloured azure, and `spark.svg` — the AI spark, an exact scale of the mark's star). The tile takes `--accent` and the star `--accent-fg`, so it re-tints with this DS automatically.

**v2 migration item:** the old indigo is still hard-coded in `apps/studio/client/index.html` (favicon data-URI), `site/app/icon.svg` and `apps/desktop/src-tauri/icons/*` — regenerate them from an azure master in one commit, plus a macOS 26 app-icon variant on a plate (Icon Composer) so the squared tail corner survives.
