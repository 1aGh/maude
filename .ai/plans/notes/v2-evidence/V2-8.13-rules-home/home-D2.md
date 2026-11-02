# Pen B, Rect R, Ellipse O, Highlighter I, Eraser E, Section ⇧S — home `G0-D/D2` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D2.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D2` · action `tool.pen` · testid `toolbar-slot-pen`
- where: Preview toolbar › Marker M (tips toolbar-tip-highlighter · toolbar-tip-eraser) · Shape R (toolbar-slot-shape) · Section S (toolbar-slot-section); Pen P and Ellipse are Edit’s (S2: Edit › More › Ellipse); “?” › Keys and tools that moved
- v1 entry points mapped to this row: 10
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: preview · browser: ok: preview · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)
- `apps/studio/test/tool-palette.test.tsx` — "Edit: Select V · Hand H · Frame F · Shape R · Pen P · Text T …" · "Preview: … Marker M · Arrow A · Shape R · Text T · Stickers E · Section S"
- `apps/studio/test/tool-keys.test.ts` — "Edit's own keys: V H arm, F R arm their drag tools" · "Q2 — Preview: V F P I ⇧I switch to Edit (P is the Pen)"
