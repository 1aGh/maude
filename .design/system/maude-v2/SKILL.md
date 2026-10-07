---
name: maude-v2-design
description: Read-context for the maude-v2 "Light glass with a spark" design system — the Maude v2.0.0 redesign. Designer-first, light-default; the canvas is the whole window and the chrome floats over it as frosted islands that fold into an icon. Azure acts, the spark is the AI, colour lives on the canvas. Load before iterating on any maude-v2 specimen or canvas.
user-invocable: false
---

# maude-v2 — design-system skill (READ pointer)

Authoritative context for any agent iterating on a **maude-v2** specimen or canvas.
Full philosophy + hard rules: [`README.md`](./README.md). Tokens: [`colors_and_type.css`](./colors_and_type.css).
Locked direction: [`ui/v2/maude-v2-moodboard.tsx`](../../ui/v2/maude-v2-moodboard.tsx) → artboard `direction-mix`.

## Load-bearing rules (do not violate)

1. **Chrome floats; the canvas is the window.** All chrome is an `.island` (`preview/_components.css`):
   frosted ~88 % opaque, compact, soft concentric radii, collapses to one icon (`⌘\`).
   No docked bars/sidebars in the default view (docked = an Advanced option only).
2. **Three colour roles, never mixed:** `--accent` (azure) = primary action, selection, focus ·
   `--spark` (vermilion) = the AI only · `--object-*` = things on the canvas (stickies, shapes).
   Never fill chrome with object colours; never use the spark for decoration or errors.
3. **Native type.** `--font-display`/`--font-body` = SF Pro; `--font-rounded` = SF Pro Rounded for
   playful surfaces (empty states, onboarding, stickies); `--font-mono` ONLY in Advanced/code.
4. **Nothing deleted, only hidden.** Developer detail (ports, paths, SHA, branches, status stamps,
   slash commands) is never in the default view — it lives in the icon menu ▸ Diagnostics, ⌘K or a
   panel's own Advanced section. Advanced is a layer inside a panel, not an app mode.
5. **Motion:** gentle `--ease-out`, feedback starts at once and chrome motion ends within 280 ms; `--ease-spring`/`--dur-spring` only for
   playful moments (AI done, sticky lands). Prefer canvas-lib `<MotionDemo role>` (DDR-049).
6. **Light is default**, dark is equal-status; every family token exists in both themes.
7. **Menu, shortcuts, words, voice:** follow [`CONTRACT.md`](./CONTRACT.md) exactly — it wins over any specimen.
8. **Voice:** quiet pro with a warm touch; everyday nouns (canvas, artboard, project tab, AI chat
   panel, toolbar, layer, comment, frame). No hype, no exclamation marks, no Lorem / "Get Started".

## Specimen shape

Bare flowing pages (NOT canvas-lib): `import "./_layout.css"; import "./<slug>.css";
import { SpecimenHeader } from "./_specimen-controls";` then
`<SpecimenHeader crumbs={["Foundations", "<Name>"]} /><main className="specimen">…</main>`.
`_layout.css` already imports the tokens and `_components.css`.
