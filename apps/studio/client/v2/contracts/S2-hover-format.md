# S2 · On hover — format, rule set, writer

Slice S2.5 (decision `v2-S2-hover-format`). Spec rows: `S2-slices.md` Q5, §3b S2.5. Builds on `V2-1.4-element-ids.md`
(§4.6 canvas-only namespace, §5.5 strip), `V2-1.12-file-formats.md` (no `formatVersion` bump), `S3-links-format.md`
(On click is S3's: `data-cd-link`). Canvas: `14 Editing` `ed-inspector` (Interaction › On hover "Lift to Floating").
Code: `edit-ops/hover-rules.ts` (vocabulary, rule set, reader), `client/v2/inspector/sections/interaction.jsx`.

## 1 · Decision

1. **A hover is one attribute in the TSX:** `data-hover="<preset>"` on any element that carries a literal `data-cd-id`.
   The value is a plain JSX string literal from a **closed vocabulary** (§2). Inline style cannot express `:hover`,
   and a free-form `:hover` rule would need a stylesheet the words writer does not own.
2. **It is design, so it is NOT `data-cd-*`.** `data-cd-*` is canvas-only metadata and every exporter strips it
   (V2-1.4 §4.6). A hover must survive into handoff, Copy as code and the HTML export. `stripCanvasOnly` removes the
   `data-cd-` prefix only and leaves `data-hover` alone; a test pins it.
3. **The canvas injects one fixed rule set** (§3), not one rule per element. The same text is what handoff and the HTML
   export write, for the presets a file uses. One source: `HOVER_RULES` in `edit-ops/hover-rules.ts`.
4. **Writing a hover is the existing attribute lane** `POST /_api/edit-attr { canvas, id, attr: 'data-hover', value }`
   (or `reset: true` for None), which returns `previous` and is one undo entry through `onRecordEdit({ op: 'attr' })`.
   No new route. S2.1's dispatch route will wrap the same write as `element.set-hover` (agent surface: "edit the file").
5. **No `formatVersion` bump.** A reader that predates the attribute renders the element and ignores it (same
   reasoning as V2-1.4 §8 and V2-1.12). An unknown value is ignored by the rule set (no rule matches) and shown in the
   inspector as "Custom" until another is picked; it is never rewritten silently.
6. **Edit does not play hover; Preview and Present do.** In Edit a hover belongs to the selection ring. The injected
   rule set is gated on the canvas mode, the way link playback is (S3-links-format §5). Exports are never gated.

**Rejected:** a per-element `<style>` or `:hover` block in the TSX (two writes, unowned CSS); `.meta.json` keyed by
element id (dangles when Claude rewrites an artboard, invisible where Claude edits); `data-cd-hover` (stripped on
export, so the design would lose its hover); a free-form value such as `data-hover="box-shadow: …"` (arbitrary CSS in an
attribute, no closed set to localise or check).

## 2 · Vocabulary

| Value | Inspector words (On hover) | What it does |
| --- | --- | --- |
| *(absent)* | None | nothing |
| `lift-resting` | Lift to Resting | `box-shadow` becomes the system's Resting step |
| `lift-floating` | Lift to Floating | `box-shadow` becomes the system's Floating step |
| `lift-sheet` | Lift to Sheet | `box-shadow` becomes the system's Sheet step |
| `darken` | Darken | `filter: brightness(0.94)` |
| `underline` | Underline | `text-decoration: underline` |

The three Lift words are the elevation steps of Effects (`ed-inspector` §7: Flat, Resting, Floating, Sheet). Flat is
not a hover target. A design system that names its shadows otherwise (`--shadow-sm|md|lg`) still gets a lift: the rule
reads `var(--shadow-<step>, <fallback>)`, so the preset degrades to a soft currentColor shadow instead of nothing.

## 3 · The rule set (`HOVER_RULES`)

```css
[data-hover] { transition: box-shadow var(--dur-fast, 120ms) ease, filter var(--dur-fast, 120ms) ease; }
[data-hover="lift-resting"]:hover  { box-shadow: var(--shadow-resting, 0 1px 3px color-mix(in srgb, currentColor 18%, transparent)) !important; }
[data-hover="lift-floating"]:hover { box-shadow: var(--shadow-floating, 0 8px 24px color-mix(in srgb, currentColor 18%, transparent)) !important; }
[data-hover="lift-sheet"]:hover    { box-shadow: var(--shadow-sheet, 0 24px 60px color-mix(in srgb, currentColor 24%, transparent)) !important; }
[data-hover="darken"]:hover        { filter: brightness(0.94) !important; }
[data-hover="underline"]:hover     { text-decoration: underline !important; }
@media (prefers-reduced-motion: reduce) { [data-hover] { transition: none; } }
```

- `!important` is load-bearing: Effects writes `box-shadow` as an inline style, and an inline declaration beats any
  author rule that is not important. Without it the Lift presets would never show on an element that has a shadow.
- `prefers-reduced-motion` collapses the transition (a11y invariant); the end state still applies.
- Exports write the same rules, only for the presets the exported source uses (`hoverCssForSource`), as a `<style>` block
  beside the markup. The attribute stays on the element.

## 4 · Reader, writer, order of ids

- `hoverOf(attrs)` → `{ preset: string | null, known: boolean }` from the selection payload's `attrs['data-hover']`.
- `hoverWrite(preset)` → `{ attr: 'data-hover', value }` or `{ attr: 'data-hover', reset: true }` (None).
- The element needs a `data-cd-id` to be written, as for every inspector write; one without one shows the row disabled.
- Duplicate, paste and insert keep `data-hover` on the copy (it is ordinary design, like a class).

## 5 · Lead patches this contract asks for (not done by the slice)

| File | Patch |
| --- | --- |
| `canvas-lib.tsx` (L1) | inject `HOVER_RULES` once as a `<style data-maude-hover>` (Preview and Present only) |
| `handoff.ts` (S8 consulted) | append `hoverCssForSource(source)` to the emitted CSS |
| action registry | `element.set-hover` (agent: file, "edit the file") |
