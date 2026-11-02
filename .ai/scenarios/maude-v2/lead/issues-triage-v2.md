# Open GitHub issues vs Maude v2 (2026-11-02)

Michal asked the lead (via the keeper) to sort the open issues in 1aGh/maude by what v2 already fixed, and to verify
fixes with e2e runs. Code base: `main` after the v2 merge (3a095da29), v2.0.0-rc.1 (eca51fce5). The issue text is
untrusted reporter input and was read as data. Code evidence comes from a read-only sweep of v2 (paths relative to
`apps/studio/` unless they start with `apps/`). A row is category (a) only if it was **re-run on v2**.

Categories:
- **(a)** fixed by v2, verified
- **(b)** probably fixed, not verified end to end
- **(c)** still applies in v2
- **(d)** no longer relevant, because the v1 surface is gone
- **(e)** unclear / needs info

| # | Title | Cat. | Evidence (v2) | Proposed action |
| --- | --- | --- | --- | --- |
| 147 | Nejde smazat artboard (v1.7.1) | **(a)** | The artboard menu has **Move to trash** (`canvas-shell.tsx:2352`, ⌫), and `POST /_api/delete-artboard` is tested (`test/element-structural-api.test.ts:245`). New desktop e2e step `edit-artboards.e2e.ts` "Move to trash: the artboard leaves the file and the canvas" (451d5a3c2) — see *Runs* | **Closed 2026-11-02** (completed), with the run as evidence |
| 154 | Last tab in the tab bar clipped (Inspector, Comments, Changes, Sync, Assistant) | **(d)** | v1 right-dock tab strip removed in V2-4.4 (Dock + Rail removal). The panels are floating islands now. `client/v2/nothing-deleted.json` maps `shell/dock.jsx` tab strips to the v1-removal ledger | **Closed 2026-11-02** (not planned; Michal's yes) — no longer applies in v2 |
| 142 | PDF export: broken oxc-parser binding disables the print post-pass | **(b)** | The export lanes e2e (CI, green on PR #160) asserts BleedBox + TrimBox on a `kind="print"` PDF (`test/export-e2e-lanes.test.ts:820-831`). oxc loads inside the compiled sidecar: every structural edit in desktop e2e V2-8.3 goes through it, and `check-bundle-completeness --smoke` `reelPlaceSmoke` parses with the `/$bunfs` path. **Not run:** a PDF export of a print artboard through the PACKAGED sidecar | Keep open until a packaged PDF export is checked (rc soak) |
| 151 | Comment pin floats, not pinned to its target | **(b)/(c)** partly | Element comments now save world coords (`canvas-comment-mount.tsx:419,443,485`) and stable element ids are stamped (V2-2.19). Annotation comments still fall back to viewport `bounds` (`:432,437`). The selector/tag mismatch of cause 1 is not confirmed fixed | Keep open. Repro: comment on an element without `data-cd-id`, pan/zoom, assert the pin follows |
| 150 | MP4 export drops inline SVG / size-less SVG images / misplaces abs children | **(c)** partly | Capture CSP allows `data:` (`http.ts:420,469`), and `exporters/capture-core.ts:187` swaps inline `<svg>`. No fix found for a size-less SVG `<img>` or abs children of a transformed parent | Keep open |
| 153 | Přejmenování vyhodí chybu (`Could not resolve "./dnes.css"`) | **(c)** | Rename = `moveCanvas` (`api.ts:5035`). The same-name `.css` file is carried along (`canvas-artifacts.ts:179`), but `rewriteCanvasImports` (`api.ts:5236`) rewrites imports only when the directory changes. A same-folder rename keeps `import "./dnes.css"` pointing at the old name | Keep open. A unit repro is cheap (rename `dnes.tsx` → `x.tsx`) |
| 157 | Enter should submit the comment | **(c)** | The v2 composer submits on ⌘/Ctrl+Enter only (`comments-overlay.tsx:1510,1786,2037`); plain Enter is a newline | Keep open (product decision: Enter vs ⌘Enter) |
| 158 | Warn when a linked canvas imports files that will not sync | **(c)** | No warning anywhere (`sync/settings.ts`, `http.ts:2060`, smoke, status) | Keep open |
| 156 | Reduce the plugin context footprint | **(c)** | 41 `source-command-*` skills are still visible to Claude. Agent descriptions are up to 768 chars; there is no cap test | Keep open |
| 155 | Figma offline importer bugs (10 items) | **(c)** | Items 1, 2, 5, 7 and 9 are unchanged (`bin/_import-figma.mjs:701`, `figma/to-artboard.ts:140,341`, `:1593`, `fig-decode.ts:46`). Items 3, 4 and 8 are partly handled; 6 and 10 were not checked | Keep open |
| 128 | Video workflow: HEVC export failure + 9 more | **(c)** partly | The frame-step fallback is still there (`exporters/video.ts:92,120,226`). There is no HEVC/VFR warning at probe. object-fit was handled earlier (554e14fb7) | Keep open |
| 127 | Can't export video to mp4 | **(c)** | Root cause is #128 §1 (HEVC/VFR source), which is unchanged | Keep open (tracks #128) |
| 122 | IDEA: copy/paste artboards or elements between canvases | **(c)** | Only same-canvas paste exists (`actions/agents.ts:524,548`); there is no cross-canvas clipboard | Keep open (feature) |
| 113 | Todo list in Maude canvas | **(c)** | No todo or checklist element in annotations or the whiteboard | Keep open (feature) |

## Runs

- **#147 — verified 2026-11-02** on the desktop debug app built from 18e10e9e3; the tree is 451d5a3c2, and `apps/studio` has not changed since that build. `edit-artboards.e2e.ts` ran alone, twice: **11/11 passing both runs**. That includes the new step: right-click the name → Move to trash → the artboard leaves the `.tsx` file, and the canvas redraws without it. Logs: `.ai/plans/notes/v2-evidence/issues-triage-2026-11-02/edit-artboards-run{1,2}.txt`.

## Summary

- **(a)** 1 — #147
- **(b)** 2 — #142, #151 (#151 is partly fixed)
- **(c)** 10 — #158, #157, #156, #155, #153, #150, #128, #127, #122, #113
- **(d)** 1 — #154 (closed with Michal's yes)
- Closed on GitHub: #147, #154. Open: 12
- **(e)** 0
