# Feature: raise or reshape the video/audio asset drop size cap (issue #126)

> **Decided 2026-10-07: Option C** (chunked upload). Implemented by `feature-chunked-asset-upload.md` (archived alongside this one), with decisions recorded in DDR-248. The 512 MiB ceiling matches the sync cap, the session budget is 4 GiB, and the native picker is in scope.

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

A user reports they can't drop a video onto the canvas when the file is over
100 MB — "that's bullshit, when working with videos that's usually the case."
There is no code bug here: every intake path (browser drag-and-drop, clipboard
paste, and the desktop app's native "Open file" picker) funnels into the same
deliberate per-category ceiling, `ASSET_MAX_VIDEO_BYTES` in
`apps/studio/api.ts:1121`, defaulted to `100 * 1024 * 1024` and already
overridable via `MAUDE_ASSET_MAX_VIDEO_BYTES` for power users who know the env
var exists. The cap is a reasoned security control, not an oversight — see
Problem below — so the decision to raise or reshape it belongs to the owner,
not to an autofix.

## User Story

As someone editing video on the canvas, I want to drop a clip larger than
100 MB without it silently failing, so that I don't have to pre-compress
every file or discover an undocumented environment variable by accident.

## Problem

`/_api/asset` (`apps/studio/http.ts:4624`, writer in `apps/studio/api.ts:2476`
`saveAssetFromStream`) is reachable from the **untrusted canvas origin**
(DDR-054). Two prior decisions shaped today's limit on purpose:

- **DDR-088** (`.ai/archive/decisions/DDR-088-canvas-media-vocabulary-and-asset-write-surface.md`)
  closed a MEDIUM DoS finding: unbounded request-body buffering +  no
  aggregate quota let a scripted drop from the canvas iframe amplify memory
  or fill disk. Fix: a streamed write, a per-route cap, and
  `ASSET_SESSION_BUDGET` (then 256 MB, env-overridable).
- **DDR-148** (`.ai/archive/decisions/DDR-148-video-comp-remotion-authoring-capture-export.md`)
  widened the surface for video comps: per-file cap raised to 100 MB
  (`ASSET_MAX_VIDEO_BYTES`), session budget raised to 1 GB
  (`ASSET_SESSION_BUDGET`), `maxRequestBodySize` raised **only as far as the
  video route needs** (`apps/studio/server.ts:269`), and the write path kept
  streamed (no full in-memory buffer) specifically so raising the cap didn't
  reopen the memory-amplification bug DDR-088 had just closed.
- That same DDR **already flagged this exact tension as unresolved** —
  its "Open follow-ups" section says verbatim: *"F3 — the raised asset
  budgets (session 1 GB, per-file 100 MB) widen untrusted-origin disk-fill;
  consider a lower default or a gesture gate."* Issue #126 is a real user
  hitting the forcing function for that undecided follow-up, from the other
  direction (asking the ceiling to go *up*, not down).

So "just raise the constant" is not a safe one-line fix: every MB added to
`ASSET_MAX_VIDEO_BYTES` is a MB of attacker-reachable disk-fill budget from a
hostile canvas (DDR-054's whole point is that canvas JS is not trusted), and
`ASSET_SESSION_BUDGET` (currently 1 GB) would need to move in step or a
10-clip disk-fill script gets cheaper relative to the per-file cap. This is
squarely a security/product trade-off the owner should make explicitly, not
a judgment call to make silently inside an autofix PR.

## Solution

Four non-exclusive options, ordered cheapest-to-ship → most durable. The
owner picks one (or a sequence) before `/flow:execute`.

### Option A — raise the default, keep the shape

Bump `ASSET_MAX_VIDEO_BYTES`'s default (`apps/studio/api.ts:1121-1124`) to a
higher flat number (e.g. 250–500 MB) and raise `ASSET_SESSION_BUDGET` and
`MAX_REQUEST_BODY` (`apps/studio/server.ts:269`) to match. Cheapest, but it is
exactly the knob DDR-148's own follow-up warned against turning without a
decision — it mechanically enlarges the disk-fill/memory-amplification
surface from the untrusted canvas origin for every session, including ones
that never touch video.

### Option B — expose the existing override as a real setting

The escape hatch already exists (`MAUDE_ASSET_MAX_VIDEO_BYTES`); almost no
user will ever find it. Surface it as a labeled setting in the app's
preferences UI (writes the env var / a config value the server reads at
boot), so the ceiling is still opt-in and per-install, but discoverable
without reading source. Smallest security-surface change (default stays
100 MB; nothing changes for a user who doesn't opt in) but doesn't help the
reporter today, and needs a design-system-compliant settings control — see
Design Decisions.

### Option C — chunked / resumable upload, keep the per-request cap

Replace the single-request streamed write with a chunked upload (multiple
bounded requests, each under today's 100 MB-ish ceiling, reassembled
server-side with the same magic-byte sniff + content-addressing it does now).
Raises the *effective* file size a user can land without raising the
per-request memory/body ceiling DDR-088/DDR-148 were protecting. Correct
long-term shape, but the most work: new wire protocol between
`use-canvas-media-drop.tsx` and `/_api/asset`, reassembly + partial-failure
handling in `saveAssetFromStream`, and a session-budget accounting change
(partial uploads must count against `ASSET_SESSION_BUDGET` without letting an
abandoned chunk set leak budget forever).

### Option D — better failure UX, cap unchanged

Leave the cap exactly where it is and fix the *reporting*: today a rejected
drop surfaces only as a toast (`showCanvasToast`, `uploadAndAnnounceMedia` in
`use-canvas-media-drop.tsx:375`) that the reporter's own wording suggests they
either didn't see clearly or found unhelpful ("that's bullshit" reads like
"I don't understand why this failed," not just "I wish the number were
bigger"). Make the 413 response actionable — name the current cap, name the
env var that raises it, and/or suggest compressing/trimming first. Doesn't
solve the underlying ask but costs nothing security-wise and ships
immediately regardless of which of A/B/C the owner picks later.

**Recommendation for the owner to weigh, not a decision made here:** D is
close to free and should probably happen regardless. B is the next safest
increment (keeps the default conservative, makes the existing override
usable) and could ship alongside D. A and C are the real fork — A trades
security margin for simplicity, C preserves the margin but is a real feature
build. Given DDR-148 already flagged "a lower default or a gesture gate" as
the alternative to consider, the owner may also want to weigh a **consent
gate** (e.g. a canvasConfirm()-style prompt — the pattern already exists in
`use-canvas-media-drop.tsx:260` `canvasConfirm` — before accepting an
oversize drop) as a fifth, even cheaper mitigation-preserving option worth a
sentence in whatever gets decided.

## Metadata

- **Ticket**: Issue #126 — "I can't drop media that's more than 100mb" (github.com/1aGh/maude/issues/126)
- **Type**: Enhancement / design decision (not a bug fix)
- **Complexity**: Medium (the decision fork matters more than any single option's diff size)
- **App/Package**: `apps/studio` (asset upload route + canvas drop hook); `apps/desktop` unaffected (confirmed no competing native drop path — see Context References)
- **Affected Systems**: canvas media intake (`use-canvas-media-drop.tsx`), asset write API (`api.ts` `saveAssetFromStream`), dev-server body-size config (`server.ts`)
- **Dependencies**: none new for A/B/D; C needs a chunked-upload protocol decision

---

## Context References

### Must-Read Files

- `apps/studio/api.ts` (lines 992-1140, 2440-2627) — Why: defines `ASSET_MAX_BYTES`, `ASSET_MAX_VIDEO_BYTES`, `ASSET_SESSION_BUDGET` and the streaming writer `saveAssetFromStream` that enforces them; every option touches this file.
- `apps/studio/http.ts` (lines 4624-4658) — Why: the `/_api/asset` route; declared-Content-Length fast-reject (`ASSET_MAX_VIDEO_BYTES`) happens here before the stream is even opened.
- `apps/studio/server.ts` (lines 260-270, 385-395, 520-530) — Why: `MAX_REQUEST_BODY = ASSET_MAX_VIDEO_BYTES + 8 MiB` wired into both `Bun.serve` instances' `maxRequestBodySize` — any cap change here must move in lockstep with `api.ts`'s constant or the route will reject before the per-category check ever runs.
- `apps/studio/use-canvas-media-drop.tsx` (whole file, esp. 371-393, 401-527) — Why: the browser-side drop/paste hook; owns the only client-side messaging (`uploadAndAnnounceMedia`'s toast) a user sees today, and the one entry point both drag-drop and (per investigation) the desktop native file picker share.
- `apps/desktop/src-tauri/src/lib.rs` (`pick_media_file`/`pick_media_files`, ~lines 269-379) — Why: the desktop "Open file" picker's Rust side; confirmed this session to have no size limit of its own — it reads the whole file and defers entirely to the same `/_api/asset` cap, so it needs no separate change under any option.
- `apps/desktop/src-tauri/tauri.conf.json` (`dragDropEnabled: false`) — Why: confirms there is no competing native `WindowEvent::DragDrop` handler; the OS drop lands as a normal DOM event the webview hands to `use-canvas-media-drop.tsx`. Leave as-is.
- `apps/studio/test/video-asset.test.ts` (esp. ~lines 9, 125-160) — Why: existing coverage for `MAUDE_ASSET_MAX_VIDEO_BYTES` override behavior and the streamed-write 413 path; whichever option ships should extend this file, not a new one.

### Design canvases

Not applicable — `.design/` canvas matching found no sidecar tagged or named
for this feature, and the affected surface (an upload-size ceiling + its
error toast) has no existing mockup. Option B's settings-UI control and
Option D's improved toast copy are the only sub-pieces with a visible
surface; route them through the project's existing settings-panel and
toast patterns rather than inventing new chrome.

### Documentation

- `.ai/archive/decisions/DDR-088-canvas-media-vocabulary-and-asset-write-surface.md` — Why: the original memory-amplification/disk-fill threat model for `/_api/asset`; any change to the caps must re-affirm or explicitly revise this threat table.
- `.ai/archive/decisions/DDR-148-video-comp-remotion-authoring-capture-export.md` (esp. "Open follow-ups" F3) — Why: raised the cap to 100 MB in the first place and explicitly deferred the exact question issue #126 is now asking, from the opposite direction.

### Patterns to Follow

- Env-var-overridable constant with a safe default, mirrored between
  `ASSET_MAX_BYTES` (images) and `ASSET_MAX_VIDEO_BYTES` (video/audio) in
  `api.ts` — any new override (e.g. a lower "gesture gate" threshold) should
  follow the same `Number(process.env.X) || default` shape already used
  three times in that file.
- `canvasConfirm()` (`use-canvas-media-drop.tsx:260`) is the existing
  sandbox-safe confirm-dialog pattern (real `window.confirm()` is blocked in
  the canvas iframe) — reuse it verbatim if a consent-gate mitigation is
  added rather than building a second dialog primitive.

---

## Tasks

This plan intentionally stops at a decision fork — no tasks are executed
until the owner picks an option (or an explicit combination, e.g. "D now,
B next"). Each option's task outline below is sized for planning only; the
chosen option should get its own `/flow:plan` (or be executed directly if
small enough, e.g. D) once selected.

### Task 0 (owner): choose an option

- **Do**: Read Solution above, pick A, B, C, D, or a sequence (e.g. "D now,
  B next quarter"). Note the DDR-148 F3 trade-off (per-file ceiling vs.
  disk-fill budget from an untrusted origin) explicitly in whichever DDR or
  changeset records the choice.
- **Validate**: n/a — this is the decision, not a diff.

### If D is chosen — improve failure messaging (smallest diff, ships regardless)

- **Do**: In `capError()` (`api.ts:1134-1140`) and/or the 413 JSON in
  `http.ts:4641-4644`, name the env var (`MAUDE_ASSET_MAX_VIDEO_BYTES`) that
  raises the cap. In `uploadAndAnnounceMedia` (`use-canvas-media-drop.tsx:375`),
  surface that message distinctly from a generic network error (e.g. keep
  the toast open longer / give it its own `'error'` sub-variant) so "it
  silently failed" can't recur.
- **Pattern**: existing `capError(category)` already returns a user-facing
  string; extend it, don't replace the shape.
- **Validate**: extend `apps/studio/test/video-asset.test.ts`'s 413 case
  (~line 125) to assert the message mentions the override env var.

### If B is chosen — expose the override as a setting

- **Do**: Add a labeled numeric setting (MB) in the app's existing
  preferences surface that writes through to whatever `MAUDE_ASSET_MAX_VIDEO_BYTES`
  reads today (likely needs the setting to set a project/user config value
  the server reads at boot, since it's an env var today — resolve this
  env-var-vs-config read path as part of the task, it's the one open
  technical question for this option).
- **Gotcha**: `ASSET_SESSION_BUDGET` must be checked/raised alongside any
  user-set per-file ceiling or a user could set a 2 GB per-file cap against a
  1 GB session budget and get a confusing "budget exceeded" on their very
  first large drop.
- **Validate**: unit test the setting → env/config plumbing; manual drop of
  a file between the old and new cap.

### If A is chosen — raise the default

- **Do**: Raise `ASSET_MAX_VIDEO_BYTES`'s default (`api.ts:1123`) and
  `ASSET_SESSION_BUDGET`'s default together; update `MAX_REQUEST_BODY`
  (`server.ts:269`, already derives from the former, so it follows for free).
  Update DDR-148's threat table or record a new DDR superseding its numbers —
  this is a security-relevant default change and should not land silently.
- **Gotcha**: this is the option DDR-148's own follow-up flagged as the
  wrong direction to default toward; if chosen, the plan/DDR should say why
  the trade-off is acceptable now (e.g. a mitigating control shipped
  alongside, or a reassessed risk tolerance).
- **Validate**: `apps/studio/test/video-asset.test.ts` cap assertions updated
  to the new default; confirm `server.ts`'s `maxRequestBodySize` wiring still
  derives from the constant (no hardcoded duplicate to miss).

### If C is chosen — chunked/resumable upload

- **Do**: Design a chunk protocol (size, ordering, resume token) between
  `use-canvas-media-drop.tsx`'s upload call and a new/extended `/_api/asset`
  mode; reassemble server-side before the existing magic-byte sniff (sniffing
  must still happen on the reassembled head, not per-chunk); account partial
  uploads against `ASSET_SESSION_BUDGET` with a cleanup path for abandoned
  chunk sets (temp-file TTL sweep).
- **Gotcha**: this is big enough to warrant its own `/flow:plan` pass with
  full task breakdown — treat this bullet as a pointer, not a spec.
- **Validate**: new test file mirroring `video-asset.test.ts`'s structure for
  the chunked path, including an abandoned-chunk-set budget-leak regression
  test.

---

## Validation

No commands to run yet — this plan has no code change pending a decision.
Once an option is chosen and implemented:

1. **Lint**: `pnpm lint`
2. **Types**: `cd apps/studio && bunx tsc --noEmit`
3. **Tests**: `pnpm test` (extend `apps/studio/test/video-asset.test.ts`)
4. **Manual**: drop a video just under, at, and over whatever the new
   effective ceiling is; confirm the desktop "Open file" picker path
   (`apps/desktop/src-tauri/src/lib.rs` `pick_media_file`) behaves
   identically to drag-drop, since it shares the same route.

---

## Scenario Coverage (UI tasks — required)

No existing `.ai/scenarios/` entry covers the asset-drop-size-cap flow
specifically. If Option B (settings UI) or D (toast copy) ships, add a
scenario step to an existing canvas-interaction scenario (or a small new one)
that drops an oversize file and asserts the toast/setting round-trip —
screenshot the rejection message so a reviewer can see the exact wording,
per this repo's "before/after screenshot" convention for UI-facing reports.

---

## Acceptance Criteria

- [ ] Owner has chosen an option (or sequence) from Solution — **this plan
      does not implement anything until that happens**
- [ ] Whichever option ships: `ASSET_MAX_VIDEO_BYTES`, `ASSET_SESSION_BUDGET`,
      and `MAX_REQUEST_BODY` stay mutually consistent (no route silently
      rejecting below its own stated cap)
- [ ] The DDR-088/DDR-148 threat tables are re-affirmed or explicitly
      superseded by a new DDR if the default ceiling changes
- [ ] Regression test added/extended in `apps/studio/test/video-asset.test.ts`
- [ ] No DDR-worthy decision left unrecorded
