# Phase 8 stage C round 5 — 13 Design system surfaces (branch p8-c5-dsfix) — budget-capped

Nothing below is marked matched; the lead's critic judges. Re-shot (impl, light + dark) with `_d2-harness-g5` + the patched `s13.mjs` (see "Harness" below).

## Done (product)

| what | ids | proof (red → green) |
|---|---|---|
| **⌘K "design system" reads as the board draws it** — the system's own board (`system/<ds>/design-system.tsx`) and its artboards are no longer listed a second time under Canvases / Artboards (they are the Design system row); every colour / type style / component row also answers to "design system" (group capped at 4 rows); **Actions** carries "Check the system" (`Design system › Advanced`) and, with more than one system, "Switch canvases to another system…" (`Design system row`) as search rows that run the registry actions `ds.check-system` / `ds.switch` for the first converted system. No registry change (rows are built in `search-ds.js`; `runAction` = the menu runner). | ds-where-gator | `p8-c5-dsfix-search.test.ts` (4 red on feat tip → green; the board-filter test red again with the filter removed, restored and `git diff`-checked) |
| **"Uses <system>" door after the fields** — was a full-width row under the inspector title; now the last thing before Advanced, under a hairline (`.insp-uses-wrap`), and not drawn for a bare kind (a token / master block). | ds-where-studio, ds-multi-panel | `v2-inspector-render.test.tsx` (red → green) |
| **Colour editor opens with Advanced open** (OKLCH rows light / dark / token visible, as the board draws it). | ds-edit-colour, ds-edge-contrast | `v2-ds-token-kind.test.tsx` (red → green) |

## Harness (not product) — why six frames showed the legacy token grid
The frames ds-edit-reach / -review / -master, ds-truth-outside, ds-edge-trash and ds-multi-migrate in the D2 set were shot where the Design system row did not open the board (the harness fell back to ⌘K typing the slug and landed on the old folder view). On this tip, `G=b` shows the board with the review sheet over it. Two steps now do what the board does: `ds-edge-trash` selects the colour and presses its "Move to the trash" (the question sheet), `ds-make-mix` selects Direction A so the inspector shows "Use A · Mix with…".

## Still open (by priority)
- **Rename…** in a system's own menu — needs a route for a system's label + a registry action (shared files); the menu also still lists Preview in… / Check the system that the board does not.
- **Pinned row second line** "used by N projects" — the number is hub fetchers (S10.18a), unknown for a local project; the row keeps "<name> · N canvases".
- **Swatch ring**: a deep-selected swatch still shows the artboard's handles + size tag (editing/index.tsx selection layer).
- **Contrast line** "5.6:1 on white · 4.8:1 on the dark page": the product computes the worst pair per mode ("Light 4.8:1 · Dark 4.7:1"); naming the surface needs the page pair split out of `contrastLine`.
- **ds make**: "Made by AI" tags per section, the AI card / progress question, the "<system> is ready · Use as <project>'s style" banner, directions as large artboards, sections as real thumbnails.
- **Brand** lockup / icons / voice / Say-not / Rules for AI (SKILL.md data not in the board model); **Patterns** real screens need a canvas-safe thumbnail route that respects the C4 frame capability — needs a decision.
- **Advanced inspector**: Used-by row, CSS | JSON seg, Files tree, Hand off tokens / Reveal in Finder actions.
- **Fixtures**: the spec names (Studio site system · Alligators brand system · Combine 2026 · Warm paper) are fixture data; the harness projects use `maude` / `maude-v2`, and only one system is in use, so the "Design systems · 2 in use" header (built, `pinnedChrome`) does not draw.
- Unreachable lanes unchanged (library / linked / schema / AI suggest).
