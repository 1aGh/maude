# studio-file-preview

**Persona:** a designer browsing a design system's assets in Studio, expecting to click any file in the tree — including images, fonts, video, and docs — and see it, without leaving the app or hunting for the file on disk.

**Feature under test:** `feature-studio-file-preview` (`.ai/plans/feature-studio-file-preview.md`) — the server-side extension allowlist unlock (`apps/studio/api.ts` `buildIndexData()`) that lets binary/media assets under `system/<ds>/assets/**` actually list in the tree, plus the client-side `previewKind` classification + `FilePreview` component (`apps/studio/client/panels/file-preview.jsx`) that renders markdown/text/image/video/audio/font previews inline instead of the old inert no-op. Canvas rows (`.tsx`/`.html`) must keep opening exactly as before.

**Canvas under test:** none — this scenario exercises the Studio shell itself (file tree + preview overlay), driven against this repo's own `.design/` (`.design/system/maude/`), which has a populated `assets/{glyphs,logos}` folder plus `README.md`/`colors_and_type.css` at the DS root — real, non-throwaway fixtures already on disk.

## Hypothesis

- Expanding `DESIGN SYSTEM › maude` in the file tree lists `assets/glyphs/*.svg`, `assets/logos/*.svg`, `README.md`, `SKILL.md`, `colors_and_type.css` as real, clickable rows (not empty folders) — proves the server allowlist unlock (Task 1).
- Clicking `README.md` renders a formatted markdown preview (headings, bold, lists) via the reused `Markdown` component.
- Clicking `colors_and_type.css` renders the raw text in a `<pre>` block.
- Clicking an SVG under `assets/glyphs/` (a plain icon glyph, no token-based fill) renders visibly in the `<img>`-based image preview.
- Clicking an SVG under `assets/logos/` (a brand mark authored with `fill="var(--accent)")`) renders **blank** in the image preview — this is the plan's disclosed, non-blocking known limitation (`<img src>` loads the SVG as a separate document with no access to the host page's CSS custom properties), not a regression.
- Clicking a real canvas (`.tsx`) after previewing files still opens it normally in the canvas iframe (status bar flips from `IDLE / no canvas open` to `CANVAS` with the `.tsx` path), and the file-preview overlay is fully replaced — no coexistence artifact, no stale preview chrome left over.

## Platform matrix

| Platform | Viewport | Required |
| --- | --- | --- |
| web-desktop | 1280×800 (default) | ✓ |
| web-mobile / ios-phone / ios-tablet / android-phone | — | **SKIPPED** |

Native + mobile **SKIPPED** — the Maude Studio dev-server is desktop-development tooling with no touch/mobile parity surface, same rationale as sibling specs `web-artboards` / `artboard-kinds` / `app-boots-and-renders-canvas`. Project `platforms` in `.ai/workflows.config.json` is `["web-desktop"]` only, so this is a scope decision, not a coverage gap — recorded as `skipped: <reason>` in each platform's `result.txt`, never silently omitted.

## Preconditions

- Dev server booted against this repo's own root, on a **dedicated port** distinct from any already-running maude-server instances (this workstation routinely has several — one per open worktree/session) to avoid session cross-talk:
  `MAUDE_SKIP_RUNTIME_BUILD=1 bun run apps/studio/server.ts --root . --port <N>`
- **Guard `apps/studio/dist/`** — `git status apps/studio/dist/` before AND after boot; a source dev-server boot self-heals unminified dev bundles over committed artifacts if they're missing, but leaves them alone if already present (verified this run: pre-existing release-minified rebuild diff was untouched by boot/scenario).
- Isolated `agent-browser --session studio-file-preview`.

## Steps

1. **Boot + open shell.** Navigate to `http://localhost:<N>`. Screenshot the default file tree (canvases only, DS group collapsed).
2. **Open Canvases › Advanced (V2-4.4a: the DS files live there), then expand `DESIGN SYSTEM › maude`.** Assert `assets/glyphs/{canvas,inspector}.svg`, `assets/logos/{favicon,mark,wordmark}.svg`, `README.md`, `SKILL.md`, `colors_and_type.css` all appear as tree rows. Screenshot.
3. **Click `README.md`.** Assert the viewport renders formatted markdown (not raw text, not blank). Screenshot.
4. **Click `colors_and_type.css`.** Assert the viewport renders raw CSS text in a monospace block. Screenshot.
5. **Click `assets/logos/mark.svg`** (brand mark, token-fill). Assert the image preview mounts (checkerboard background) but the mark itself is **not visible** — the documented `var(--accent)` limitation, not a bug.
6. **Click `assets/glyphs/canvas.svg`** (plain icon glyph). Assert the glyph **is visible** in the same `<img>`-based preview — narrows the limitation from step 5 to token-fill SVGs specifically, confirming raster/non-token SVGs are unaffected.
7. **Click a real canvas** (`Agency Hero`). Assert the status bar leaves `IDLE / no canvas open` and shows `CANVAS · .design/ui/Agency Hero`, the canvas mock renders live in the iframe, and no file-preview chrome remains. Screenshot.

## Success criteria

- Steps 1–7 PASS: asset files list (server unlock verified), markdown/text/image previews render for their respective kinds, the token-fill-SVG blank-render limitation is present and scoped exactly as documented (glyphs fine, brand marks blank), and opening a real canvas afterward works with no regression to the single-canvas tab model.
- `dist/` guard: no unintended bundle churn from booting the source server this run (checked before/after).
- Cross-platform parity: N/A (web-desktop only by design; the other 4 recorded SKIPPED with reason, per project's single-platform config).

## Follow-ups (not blocking)

- Video/audio/font preview branches were code-reviewed but not asset-verified live in this run (no such files in this repo's own DS assets folder, same gap noted in the plan's acceptance criteria) — low risk, same fetch/serve path as the verified image branch.
- The `var(--accent)`-token-fill SVG blank-render gap (mark.svg/wordmark.svg/favicon.svg) is a known, disclosed fast-follow per the plan — inlining sanitized SVG markup instead of `<img src>` would fix it, out of scope for this pass.
