---
name: ux-patterns
description: "UX composition rules for building and reviewing UI — hierarchy, actions, navigation, forms, dialogs, microcopy, data, tokens and motion — each with a stable ID, a reason and a yes/no check."
user-invocable: false
---

# ux-patterns

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

How to compose a screen and why. Use it **while generating** (`/design:new`, `/design:edit`) so the rules shape
the layout up front, and **while reviewing** (critics) to name what is wrong. Rationale, sources and the full
checklist live in [`reference.md`](reference.md) — read the section you need, not the whole file.

## Precedence

1. **The project's design system wins.** Its `SKILL.md` / `README.md` (under `<designRoot>/system/<ds>/`) may bind,
   override or exempt any rule below. A deliberate DS choice is never a finding.
2. **Accessibility rules** (the project a11y skill / WCAG) stay hard regardless.
3. **These rules** are the default when neither of the above speaks.

Bind numbers to the project's tokens: a rule's px value is the intent; use the nearest DS token, never a raw px.

## Before any rule — the meta-patterns

- **M1 Content first.** List content types, group and rank them; the layout falls out of the groups.
- **M2 Subtract first.** Every element must carry meaning or speed a decision — otherwise remove it.
- **M3 Design the decision.** Judge a fix by "does the user decide faster?" (decision friction, signal vs noise).
- **M4 One of each.** One focal image, one primary action, one alignment anchor, one control per action.
- **M6 Borrow proven patterns.** Platform conventions beat novelty unless the novelty clearly wins.
- **M7 Systems over eyeballing.** Spacing scale, radius formula, token names — numbers, not "looks right".
- **M8 Both themes.** Nothing is done until it works in light and dark.
- **M9 Hierarchy has a time axis.** Motion reveals in order of importance.

## Rules (ID · rule)

**Hierarchy & layout**
- `UX-HIER-1` Layout = content groups; every region maps to one named group.
- `UX-HIER-2` Inside a group rank by size → color → proximity → order; meta rows horizontal; long text below.
- `UX-HIER-3` Lead with the subject, not metadata (the event, not the date).
- `UX-HIER-4` Group with white space; borders/containers/cards only for emphasis or affordance.
- `UX-HIER-5` One alignment anchor per text column; no stacked multi-line centered text.
- `UX-HIER-6` One focal hero image.
- `UX-HIER-7` Equal items (tabs, segments) get equal cells.
- `UX-HIER-8` Put the action where reading ends (visual → message → action).
- `UX-HIER-9` On layered surfaces, interactive items are lighter than their container; inputs read recessed.

**Actions & buttons**
- `UX-ACT-1` Exactly one primary action per view/section; verb label.
- `UX-ACT-2` Brand/primary color is a signal — ration it to the most important action/state.
- `UX-ACT-3` Destructive and primary never share a color (if the brand is red, destructive goes neutral/secondary).
- `UX-ACT-4` Buttons have a min width; buttons side by side align; capture-form primary goes full width.
- `UX-ACT-5` One action = one control in one position with states (no separate open/close buttons).
- `UX-ACT-6` Option lists use consistent visual anchors (an icon on every row or none).
- `UX-ACT-7` Tier actions primary/secondary/tertiary; more than ~4 → overflow behind "More".
- `UX-ACT-8` Decoration never looks like a button.

**Navigation & wayfinding**
- `UX-NAV-1` Tab bar: no overlapping FAB, aligned icon + label, one active state, title case, content scrolls under.
- `UX-NAV-2` Navigation controls grouped in one place, not split left/right.
- `UX-NAV-3` Mobile menus: single column, grouped under labels — "boring" scans fastest.
- `UX-NAV-4` Carousels show content (thumbnails/peek), not progress dots; dots ≥ 8px if unavoidable.

**Forms**
- `UX-FORM-1` Every input has a persistent visible label; placeholder never replaces it.
- `UX-FORM-2` Placeholder = actionable example ("Example: …") or instruction ("Enter your full name"); no "e.g.", no "Type here".
- `UX-FORM-3` Spacing: helper 4 · label→input, header→caption, button→button 8 · input→input 20 · group→group, last input→button 24. Don't cramp to edges.
- `UX-FORM-4` Pickers carry decision data (e.g. price per day) and stay legible (no thin weights).

**Dialogs**
- `UX-DLG-1` Confirm dialog: title names the action ("Delete folder"), body states the consequence, verb CTA + "Cancel", close ×, left aligned, no "Are you sure?", no decorative icon.
- `UX-DLG-2` Capture dialogs sell the user's outcome, include dismiss and privacy note.

**Microcopy**
- `UX-COPY-1` CTA = precise verb (+ noun), consistent across flows ("Reserve room", not "Book").
- `UX-COPY-2` No ALL CAPS in buttons, labels, tabs.
- `UX-COPY-3` Headings state the user's benefit, not your task.

**Data, content, a11y**
- `UX-DATA-1` Metrics = label · value · helper, grouped by meaning (tabs), visualized where possible — not a spreadsheet.
- `UX-CONT-1` Realistic, varied content; never cloned placeholders.
- `UX-CONT-2` Real-world metaphors only after hierarchy works.
- `UX-CONT-3` Empty space is not a reason to add content.
- `UX-A11Y-1` Text over imagery passes contrast (scrim/gradient).

**Tokens, shape, icons**
- `UX-TOK-1` Primitives → semantic aliases per mode; components use semantic tokens only.
- `UX-TOK-2` Semantic names: `color-<element>-<priority>-<state>` (element = background, surface, border, text, icon).
- `UX-TOK-3` Tone saturated accents down in dark mode (warm ≈ 70 %, cool ≈ 60 %).
- `UX-TOK-4` Gradients: one hue, HSL, four steps (light source → hold → fall-off → anchor).
- `UX-SHAPE-1` Nested radius: outer = inner + padding.
- `UX-ICON-1` One established icon family; no custom one-offs.

**Motion**
- `UX-MOT-1` Reveal primary → secondary → tertiary, staggered (~0.2 s).
- `UX-MOT-2` Transition by change type: context (structure stays) · drill (IA level) · continuity (shared element morphs).
- `UX-MOT-3` Overlays: fixed controls fade, primary element scales + fades, make room, secondary enters delayed.
- `UX-MOT-4` Ease-out for entrances/expansions; content trails its container.

## Severity when reviewing

Blocker: `UX-ACT-1`, `UX-ACT-3`, `UX-FORM-1`, `UX-DLG-1`, `UX-A11Y-1`. Everything else: warning — promote only when
the brief makes it central. Cite the ID in the finding's `category`/summary so fixes can look it up in `reference.md`.

## Who reads which part

| Reader | Sections |
| --- | --- |
| `/design:new`, `/design:edit` (generation) | meta-patterns + all rules for the surfaces being built |
| `design-critic` (Pass A) | all |
| `graphic-design-critic` | HIER, ACT-2/4/6/8, SHAPE, TOK-3/4 |
| `copy-critic` | COPY, FORM-2, DLG |
| `info-architecture-critic` | NAV, DATA, HIER-1/3, ACT-7 |
| `motion-critic` | MOT |
