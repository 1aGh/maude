# Phase 8 stage C round 6 — 13 Design system board (branch p8-c6-dsboard2) — budget-capped

Nothing below is marked matched; the lead's critic judges. Re-shot (impl, light + dark): ds-board-studio, ds-board-dark, ds-board-gator.

## Done (product)

| what | ids | proof |
|---|---|---|
| **Brand draws icons · voice · Say/not · "Rules for AI and code"** — read from the system's own files: `assets/icons/*.svg` (≤12, ≤4 KB each, drawn as a mask so they take the ink colour), SKILL.md / README.md (`ds/board/brand-notes.ts`: the bold lead of each rule under a "rules" heading, the "Voice:" rule or a Voice heading, a `Say … not …` line). Nothing is invented: a system with none of these draws none of the headings. `BoardModel.brand` (optional, so older literal models still render). | ds-board-studio / -dark / -gator | `p8-c6-dsboard2-brand.test.tsx` |
| **Patterns draws the system's kept showcases** live and scaled (380 px tiles, name under each, max 5) from the `<Specimen>`s the board already loaded; none → the old "No patterns yet" line. | same three | same test |

## Decision: Patterns without a thumbnail route
The brief asked for a canvas-safe thumbnail route. Not built: the showcases are already one unit with the board (`v2-p8-ds-board-specimens-one-unit`), so drawing them in the Patterns tiles needs no new route and no new capability — a picture of a canvas the frame was never granted would be the leak C4 closes. Rejected: reusing the capture-origin thumbnail service read-only (a route in two allowlists, key plumbing, and a second render of a page the board already renders); inlining JPEGs of other canvases into the board module (reaches canvases outside the frame's grant).

## Open (by priority, from critic-final-d3)
- Swatch selection ring (editing/index.tsx selection layer), framed zoom, contrast line naming the page, "Used in N canvases · Show".
- Review / master sheets: real thumbs, "by folder" grouping, "14 places" sub-line.
- Pinned "Design system" row + "Design systems · N in use" header + amber dot; system menu placement + Rename… (needs a route + registry action — shared files).
- Advanced inspector: Used-by row, CSS|JSON seg, token block, Files tree, Hand off tokens, Check result card.
- ds make: large direction artboards (320x480 today), Made by AI tags, AI card, "Use A · Mix with…" bar, ready banner (`MakeReadyBanner` exists; not reached in the harness lane).
- Update-available / outside-change / conflict surfaces mounted in the harness lane.
- Brand: spec's "Logo · clear space" frame and the gator lock glyph on locked colours in the board crop; the Say/not row draws only when SKILL.md carries one.
