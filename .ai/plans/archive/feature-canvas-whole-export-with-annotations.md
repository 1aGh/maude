---
name: feature-canvas-whole-export-with-annotations
status: done
created: 2026-10-06
decisions: owner answered 2026-10-06 (see Owner decisions)
---

# Feature: export the whole canvas (with annotations) to PNG / PDF

> Tier `plan` from fixbot triage of issue #125 (report `r-e1362337`). This document is a **proposal awaiting the owner's decision**. No source has been changed.

## Description

Users can export individual artboards, or every artboard as a separate file (`canvas-as-separate`). They cannot export the canvas as one image or one document, with the annotations and surrounding layout included. The request asks for a PNG or PDF export of the whole canvas "with annotations and everything".

## User Story

As a designer working on a canvas I want to export the whole canvas to PNG or PDF, including its annotations, so that I can share one complete picture of the work.

## Problem

- `apps/studio/exporters/format-scopes.ts` defines `VALID_SCOPES_BY_FORMAT`. For `png` and `pdf` the valid scopes are `selection`, `artboard` and `canvas-as-separate`. No scope renders the whole canvas as a single unit.
- `apps/studio/exporters/scope.ts` resolves a scope into `Target[]`. The only target kinds are `element` (CSS selector plus canvas file) and `file-tree`. Nothing describes the canvas as one bounding region.
- `apps/studio/exporters/index.ts:176` (`canvasShellUrl`) always sets `hide-chrome=1`. That suppresses "tool palette, mini-map, halos, pins, snap guides, annotation chrome" so the export captures only artboard content. **So the "with annotations" part of the request is not a missing option. Annotations are deliberately stripped from every export today.** Making them appear is a change to what exports mean, not a toggle.

## Solution (proposed)

Add one new scope for the raster and document formats, and an explicit opt-in for annotations.

1. **New scope `canvas-whole`** (name is a placeholder; see Open questions) added to `Scope` in `scope.ts`, to `ExportScopeName` in `format-scopes.ts`, and to `png` and `pdf` in `VALID_SCOPES_BY_FORMAT`. It becomes the default for those formats only if the owner decides so.
2. **Resolver**: `canvas-whole` resolves to one element target that is the whole canvas root, not one per artboard.
3. **Annotations opt-in**: an `includeAnnotations` boolean in the export options, default `false`. When `true`, the canvas shell is opened without `hide-chrome` (or with a narrower set of hidden elements) for this export only. Default `false` keeps every existing export byte-for-byte unchanged.
4. **Adapters**:
   - PNG: one raster of the canvas bounding box at the chosen scale.
   - PDF: one page sized to the bounding box, with the same raster or vector content.

**Recommendation:** ship scope plus the `includeAnnotations` opt-in together, with the default off. Shipping annotations on by default would silently change every existing `canvas-as-separate` export only if the flag is wired into the shared path; keeping it opt-in avoids that.

## Metadata

- **Ticket**: GitHub #125 — https://github.com/1aGh/maude/issues/125 (tracker provider `github`; the ticket is the issue itself)
- **Type**: New Capability
- **Complexity**: High (multi-package, public export contract)
- **App/Package**: `apps/studio` (exporters, export dialogs, client export lane); `apps/hub` (export jobs and their validation); `apps/render` (render service `validBody`)
- **Affected Systems**: export dialogs (`client/app.jsx`, in-canvas export dialog), export scope resolver, PNG and PDF adapters, hub export-job endpoint, render service job validation
- **Dependencies**: none new expected. Must confirm `pdf-lib` covers a single custom-size page (see Risks).

---

## Context References

### Must-Read Files

- `apps/studio/exporters/format-scopes.ts` (whole file) — Why: the single table that decides which scope/format pairs are legal; the server-side guard lives here too.
- `apps/studio/exporters/scope.ts` (lines 1–60, `Target` union) — Why: the resolver contract every adapter consumes.
- `apps/studio/exporters/index.ts` (lines 160–181, `canvasShellUrl`) — Why: the `hide-chrome` decision that makes annotations invisible to export.
- `apps/studio/exporters/pdf.ts` (around lines 480–540) — Why: page sizing and scale handling; not yet read in full.
- `apps/studio/exporters/png.ts` — Why: current single-artboard raster path; not yet read.
- `apps/studio/client/export-lane.js` — Why: client side of the export lane; which scopes it sends. Not yet read.
- `.ai/plans/archive/followup-annotations-v2.md` — Why: annotations are now element-model data (DDR-242). The plan must say which of them an export shows.

### Files to Create

- None expected. Add tests next to the existing `apps/studio/test/*` export tests.

### Design canvases

No canvas under `.design/` matches the export/annotation feature by tag or slug. The closest recent canvas is `.design/ui/Studio.meta.json` (app shell). It is a hint, not a spec. No canvas for the export dialog exists.

### Documentation

- `.ai/plans/archive/followup-annotations-v2.md` — Why: prior annotation model and its open items.

### Patterns to Follow

`format-scopes.ts` already states the rule that a format and scope pair must be legal in one place, and that the server must enforce it too. The new scope follows that rule. Do not add a second list in the dialogs.

---

## Design Decisions

No design-system document is present at the configured path (`.ai/maude-design-system.md` does not exist), so there is no component or token mapping to record. The export dialog UI change is limited to one extra scope option and one checkbox. Reuse the existing dialog controls.

---

## Owner decisions (2026-10-06)

1. **Shape:** two variants — the whole canvas, and the bounding box of what is currently selected. Each is ONE image / ONE PDF page, layout between artboards kept.
2. **Annotations:** the whole canvas view incl. artboards and the annotation layer (`[data-mdcc-annotations]`, DDR-242 elements) — **no comment pins**.
3. **Default:** opt-in checkbox "Include annotations", off.
4. **Naming:** `canvas-whole`; the selection variant is `selection-bounds`.

## As implemented

- Scopes `canvas-whole` + `selection-bounds` (png/pdf only, appended — no default changed) in `format-scopes.ts`, `scope.ts`, `index.ts`, both dialogs, export-center labels, CLI + `/design:export` doc.
- Target carries `region: 'canvas' | {selectors}` + `annotations`; `bin/_region.mjs` lays the region out at the origin (resets pan/zoom, translates `.dc-world`, 32px padding, drops the `aria-current` ring) for `_png-playwright.mjs` / `_pdf-playwright.mjs`.
- `canvasShellUrl(..., {annotations})` adds `annotations=1`; `hide-chrome=1` STAYS (it also selects the capture CSP). `_shell.html` then re-shows only the annotation scene + the `.dc-annot-svg` `<defs>` (the sticky shadow filter lives there; a filter in a display:none SVG makes Chromium skip the sticky entirely).
- Multi-selection: the in-canvas dialog sends `selectionAll`; the shell dialog only knows one selection, so there it is that element's box.
- Render service needs no change (targets pass through; browser lane stays artboard-only, so region scopes go via the render service in workspaces — not verified against a live cloud).
- Open: DDR for the export-contract change (Task 1 below), What's New entry at `/flow:done`.

## Open questions for the owner (answered above — kept for the record)

1. **Shape of the output.** A single stitched raster / single-page PDF covering the canvas bounding box? Or a multi-page PDF with one page per artboard in layout order, all on one document? The first matches the wording "the whole canvas"; the second is closer to existing artboard handling.
2. **What "annotations" covers.** Canvas comments? Pins and sticky notes? The v2 annotation element model (DDR-242)? Whiteboard annotations? Each needs a different render path.
3. **Default.** Should `canvas-whole` be the default scope for PNG and PDF, or only selectable? Should `includeAnnotations` default to on or off? (Plan recommends off.)
4. **Public contract.** A new `Scope` value changes the hub export-job API surface and what the render service accepts. Confirm this is acceptable under the DDR process, or whether a new DDR is needed first.
5. **Naming.** `canvas-whole`, `canvas-merged`, or another name? It becomes user-visible.

---

## Tasks (proposed — not to be executed under this plan)

Execute in order after the owner has answered the open questions.

### Task 1: CREATE the DDR for the export contract change

- **Do**: record the decisions from open questions 1–4 with `/flow:record-ddr`.
- **Gotcha**: this changes a public contract; do not start Task 2 without it.
- **Validate**: DDR file exists and is referenced from this plan.

### Task 2: UPDATE `apps/studio/exporters/format-scopes.ts`

- **Do**: add the new scope to `ExportScopeName` and to `png` / `pdf` in `VALID_SCOPES_BY_FORMAT`. Keep the order rule: the first entry is the default.
- **Pattern**: existing table entries in the same file.
- **Gotcha**: `project-raw` must stay excluded from rendering formats, and the new scope must not appear in `zip`.
- **Validate**: unit test asserting the new pair is legal and an illegal pair (for example `pptx` + `canvas-whole`) still refuses.

### Task 3: UPDATE `apps/studio/exporters/scope.ts`

- **Do**: add the scope to `Scope`; resolve it to one element target for the whole canvas root.
- **Pattern**: the existing `selection` / `artboard` branches.
- **Gotcha**: the resolver reads `ExportScopeHints.canvasFile`; reuse that rather than the persisted `_active.json`.
- **Validate**: pure unit test on `resolveScope` for the new scope.

### Task 4: UPDATE the export option plumbing for `includeAnnotations`

- **Do**: add the boolean to the options bag; in `canvasShellUrl` (`index.ts`), omit or narrow `hide-chrome` only when it is `true`.
- **Pattern**: the existing `tokens` / `components` params in the same function.
- **Gotcha**: default must stay `false`; add a test that the default URL still contains `hide-chrome=1`.
- **Validate**: unit test on `canvasShellUrl` both ways.

### Task 5: UPDATE the PNG and PDF adapters

- **Do**: render the whole-canvas target as one raster / one page, sized to its bounding box.
- **Gotcha**: very large canvases can exceed the render budget; define a clear degradation (`ExportDegradation`) instead of a silent truncation.
- **Validate**: adapter test with a small multi-artboard fixture checking dimensions and page count.

### Task 6: UPDATE the hub export-job validation and the render service `validBody`

- **Do**: accept the new scope in both places. Both must read from the same table as Task 2, not a copy.
- **Gotcha**: this is the layer that produced the earlier opaque `invalid render job` error; the refusal message must name the scope.
- **Validate**: hub test posting `{format: 'png', scope: 'canvas-whole'}` is accepted; `{format: 'pptx', scope: 'canvas-whole'}` is refused with a readable message.

### Task 7: UPDATE the export dialogs

- **Do**: show the new scope in the shell dialog (`client/app.jsx`) and the in-canvas dialog; add the annotations checkbox, shown only when a whole-canvas scope is selected.
- **Gotcha**: the dialogs must not keep their own scope list.
- **Validate**: scenario run (below).

---

## Validation

1. **Lint**: `pnpm lint`
2. **Types**: `pnpm typecheck`
3. **Tests**: `pnpm test` — including the new unit tests from Tasks 2–6.
4. **Build**: `pnpm build`
5. **Scenario** (UI task): `scenario-runner` across the platforms in `.ai/scenarios/`; a new scenario covering export of a multi-artboard canvas, with and without annotations.
6. **Design System Guard**: skipped — no design-system document exists at the configured path. State this in the PR.
7. **A11y**: `a11y-auditor` over the export dialog.
8. **Manual**: export a canvas with one annotation and check the PNG and PDF visually.

## Acceptance Criteria

- [ ] Open questions 1–5 answered and recorded in a DDR
- [ ] PNG and PDF each export the whole canvas as one output for the chosen shape
- [ ] `includeAnnotations=false` (default) produces output identical to today's for every existing scope
- [ ] `includeAnnotations=true` shows the annotations the owner selected in open question 2
- [ ] Server refuses illegal format/scope pairs with a readable message
- [ ] Unit tests added for every task that changes logic

## Risks

- **Annotations are stripped on purpose.** The `hide-chrome` decision in `canvasShellUrl` was made for artboard fidelity. Turning annotations on for whole-canvas export could leak dev-server overlays (pins, halos) into the output. Mitigation: render only the annotation layer, not the full chrome.
- **Public contract.** A new scope reaches the hub, the render service and both dialogs. A partial rollout produces the same "opaque invalid job" failure the format-scopes module was written to prevent.
- **Size.** A large canvas as one raster or page can exceed memory or PDF limits.
- **Not verified.** I have not read `pdf.ts` in full, `png.ts`, the render service `validBody`, or `client/export-lane.js`. The task list assumes their shape; execute must confirm it first.

## Triage record

- Tier: `plan` (feature request with design questions, new public export scope, multi-package). Heavier than `quick` or `bug` by design.
- Not run: `/flow:validate` (no code change), debate step 5.5 (no orchestration mode configured for this run; open questions go to the owner instead).

**Confidence for one-pass implementation (once questions are answered): 5/10.** The open questions decide the shape, and the unread files may change Tasks 5–6.

## Retro

- The fixbot's plan-tier escalation was right: the open questions (shape, which annotations, default) genuinely changed the build — e.g. "no comment pins" made the annotations toggle a CSS re-show of one scene, not a whole-chrome flip.
- The plan assumed annotations meant removing `hide-chrome`; reading `http.ts` showed that flag also selects the capture CSP, so a separate `annotations=1` param was the only safe shape. Read the server side of a URL flag before planning to drop it.
- Two defects only surfaced by LOOKING at the region output: stickies vanish when their `<defs>` filter lives in a display:none SVG, and the active-artboard ring paints outside the box. Per-artboard crops had hidden both. Visual verification of the new capture shape was not optional.
- agent-browser clicks on the shell dialog silently didn't fire; a scripted `fetch` intercept + DOM click proved the request body. Prefer asserting the request over trusting a click.
- Not covered: in-canvas dialog in a browser, cloud render-service lane, desktop E2E.
