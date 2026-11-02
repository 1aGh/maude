# S7 Video & kinds — slice plan

Phase 6 (wave B) planning spike, package **S7** (lane L1, after S3 → S2 → S4). Plan row:
`.ai/plans/feature-maude-v2-redesign.md` § Phase 6 "S7 Video & kinds" + § Reuse row S7. Topic owners:
`.design/ui/v2/07 Video Editing.tsx` (26 artboards), `.design/ui/v2/08 Artboard Kinds.tsx` (19), shared timeline
source `_video.tsx`. Checklist: `.ai/plans/notes/v2-inventory/D-video-kinds-export-assets.md` §07 (l. 9–147),
§08 (l. 150–247), cross-cutting (l. 475–560). Binding contracts: **V2-1.10** (video intelligence — the whole
analysis/derivation substrate), V2-1.12 (R1–R8, reserved `artboardMeta` / `video` keys), V2-1.11 (verbs, tiers),
V2-1.15 (runs, the accepted `progress` amendment), V2-1.5 (one op log), V2-1.4 (ids), V2-1.17 (index `byKind`),
`S2-edit-ops.md` (the one dispatch route), S11 §2.3/§2.5 (Advanced rows, empty kit), S4 §3 (time marks), S9 §2
(comments on the timeline). Gate 0: **B3**, B5, C16, C19, C21, **C22**, C25, **C26**, **C35**, C36, **D15**, D17.
No product code in this note — it is the order of work for `v2-builder`s.

## 1. Scope recap

S7 turns the bottom-docked Timeline into canvas 07's **floating island tied to the selected video artboard**
(compact with a notch / full width, ⇧⌘T keeps it open, tap Space plays, hold Space = Hand), with four tracks
(Text · Graphics · Video · Music + "+ track" → Video 2 / Music 2), trim / split (S, ⌘B) / move / transitions,
word-by-word captions + edit by transcript, beats + Snap / Cut to the beat, ducking, poster frame, linked formats
with per-format framing (B3 fallback: centre + manual keyframes), the AI cut streaming shot by shot, other takes,
waiting-for vs missing footage, the clip menu + clip inspector (D15). And canvas 08: the **F size picker** (App ·
Web page · Social · Print · Video, "Fixed size"), kind inspectors, safe zones (never exported), kind filter chips
(Layers + Canvases), change-kind makes a copy, one warning style, the print inspector (paper, bleed, safe margin,
RGB line), the video cap (C22).

**Already shipped — do not redo:**
- Timeline v1: `client/panels/TimelinePanel.jsx` (2,433 lines, dock, ⇧⌘T), `ClipInspector.jsx` (tabbed dialog),
  `timeline-{parse,scale,snap,comp-target,media-cache}.js`, `use-photo-and-timeline.jsx`; `clip-ops.ts` (pure
  `apply*` writers: split, trim, speed, grade, framing, transitions, overlay ↔ storyline, ensure-video-comp, …)
  behind `/_api/clip-edit`, `/_api/comp-clips`, `/_api/footage`; DDR-150 clip addressing (stableId + fingerprint).
- `video-comp.tsx` seek registry `__maudeVideoComps` + `timeline-*` dgn messages; **S3.3** (branch `s3-3`)
  drives a comp in Present through `present/present-media.ts` — S7 reuses that handle, no second playback path.
- Kinds: `kind` JSX prop + `registerKindOverlay` (DDR-181), print model + `print/units.ts` incl. `marginsMm`
  (5 mm default) and the 300 dpi default (B5, V2-2.8), guides overlay + `view.json overlays`, the 24 px fix (V2-2.8).
- Registry: `timeline.*` (play, step, to-start/end, keyframes, undo/redo, split ⌘B, zoom), `view.timeline-keep-open`
  ⇧⌘T, `present.from-selection`; nothing-deleted rows for every timeline/ClipInspector control (`D15`,
  `ad-timeline` testids `timeline-readout` / `timeline-long-badge` / `timeline-kf-<i>-<k>`, "until S7").
- Inspector frame + `slots.js` / `sections.js` (S2.2, on feat); index service with `byKind` (`apps/studio/index/`).

## 2. Open questions resolved, and cross-lane contracts

### 2.1 Decisions (one line each)

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| Q1 | Parallel island or move the dock? | **Move.** S7.7 re-hosts the TimelinePanel body inside the island (file moves to `client/v2/timeline/`), later slices carve it into modules, as S4 did with `annotations-layer.tsx`. | Plan rule "build in place, no parallel version"; nothing-deleted stays green because every control keeps its testid. |
| Q2 | Clip writes: `/_api/clip-edit` (V2-1.10 §5.7) or S2's `/_api/edit-op`? | **Edit ops.** Every clip verb becomes an op in S2's dispatcher (`edit-ops/clip/*.ts` wrapping the pure `clip-ops.ts` appliers). `/_api/clip-edit` stays as a forwarding alias. | Same refusal order for free (`held-by-ai` during an AI cut, `locked`, `stale` via `expectRev`), `actionId` for the toast Undo, one op log. Amends V2-1.10 §5.7 ("same route"). |
| Q3 | Timeline-local undo (`reorder-revert`, `timeline.undo/redo`)? | **Retired into project undo.** ⌘Z in timeline focus = `edit.undo`; `timeline.undo/redo` bindings die with it (rule 13), ids kept as `MOVED_KEYS` rows. | CONTRACT §7: "⌘Z undoes your edits first, then AI's"; one undo step per AI run needs one log. |
| Q4 | Linked formats — where is the link stored? | **Derived, not stored:** video artboards whose `<VideoComp component={X}>` name the same comp are linked. "Make an unlinked copy" forks the comp function under a new name. Per-format data = `<Reframe formats>`, `<Captions formats>`, new `<Place at formats>` (title position). | No new versioned key (V2-1.12 `video` reserved key stays unused); tracks are derived the same way (C35). |
| Q5 | Per-format text position (07 ve-formats) | New literal-prop canvas-lib export `<Place at={[x, y]} formats={{ "16:9": [x, y] }}>` (fractions of the output frame, centre anchor), same rules as `<Reframe>`. | Amendment to V2-1.10 §5.3; v1 builds say "This canvas uses Maude 2" (V2-1.12 §5.8) like the other three. |
| Q6 | Safe-zone preset — prop or meta? | **JSX prop** `safeZones="instagram-reels"` on `DCArtboard`; "Show on canvas" is visibility in `_canvas-state/<slug>.view.json` `overlays.safeZones` (default shown when a preset is set). | DDR-181: artboard intent is JSX-authoritative, visibility is per-user runtime state. Unknown prop is display-ignorable in v1 (R2). |
| Q7 | Custom print size (08 ak-picker-full) | `print={{ paper: "<nearest-larger preset>", sizeMm: [99, 210], bleedMm: 3 }}`; `sizeMm` present = custom trim. Never `paper: "custom"`. | v1 `resolvePrintArtboard` **throws** on an unknown paper id (`print/units.ts:248`); a v1 peer then sees the nearest preset's guides, never a crash (R1–R3). |
| Q8 | `artboardMeta` inner keys S7 owns | `poster`, `snap`, `maxFrames` (V2-1.10 §5.5) + `madeFrom: { artboard, label }` (change-kind provenance). Nothing under `layout` (R6). | Reserved key already names S7. |
| Q9 | F over empty canvas vs F + drag | Contract with **S2.13**: F with **no artboard selected** arms the tool **and** opens the picker above the toolbar; a drag on empty canvas closes it and draws a **Fixed size** artboard (S2.13); with an artboard selected F draws a frame inside it (S2.13), no picker. | Resolves inventory gap "F + drag — what kind?" (08 legend: Fixed size = "Place things anywhere"). |
| Q10 | Space: tap plays, hold = Hand — where decided? | Discriminator on **keyup < 200 ms with no pointer drag** = tap. Canvas focus: the canvas posts `space-tap` (new c2s); shell focus: the shell handles it. `timeline.play` keeps its id, rebinds to "Space tap, a video artboard selected"; Hold → Hand stays the canvas's. | C26 focus order; S3 hands `00/rule/space` to S7 (S3-slices §4). |
| Q11 | Full-screen video preview (ve-fullscreen) | `present.from-selection` on a video artboard starts Present · Artboards with a new optional spec field `only: 'formats'` (the deck = its linked formats; ‹ › switches format). Transport gains scrub, loop ticks, volume, captions toggle. | Reuses S3.3's stage + present-media; one additive field in the Present spec. |
| Q12 | ve-export / ve-render rows are S7's but the sheet is S8's (C19) | S8 builds the sheet + Exports panel; S7.19 supplies the video content through `videoExportContent()` (§2.3) and captures the evidence (the package that lands last captures, S11 Q2). | "One row, one slice". |
| Q13 | Asset "Waiting for Jonas's Mac" | S7 consumes `useAssetPresence(rel)` (§2.3, S8 owns). Until the hub names devices, the word is "Waiting for another device". | 12 ia-missing is the home of a file's state. |
| Q14 | Who closes the two shared rules? | `print-colour-in-one-line` → S7.23, `not-here-yet-vs-missing` → S7.16, **if** S8's halves (ex-print, ia-missing) merged first; otherwise the closer is S8 and S7 adds evidence. | S11 Q2 "last part captures". |
| Q15 | Overlay lanes in existing comps (C35) | Derivation only (V2-1.12 §5.3): standalone video/image → Video 2. No bytes change, no migrator step for tracks. | C35 + V2-1.12. |
| Q16 | Clip right-click menu (inventory gap 10) | All 17 v1 items kept: the 6 drawn as plain rows, the rest under its **Advanced ▸** (D6 pattern). Grade / Crop / Transition frames sit under the clip inspector's Advanced (D15). | Gate 0 D15; nothing deleted. |
| Q17 | Transcript panel entry | Opens from the island's **Captions from speech** tool, from double-clicking a caption word, or `video.transcript.open`; it takes the **left panel slot** as an island (the Canvases panel returns on close). | Inventory ambiguity; 07 ve-captions draws it in the left slot. |
| Q18 | V2-1.10 Q1–Q8 | Adopted as written (loop words excluded until confirmed, no bundled whisper.cpp, configured model, fix this video only, duck on with speech, snap on with a grid, EDL one-way, uniform ticks < 0.4). | Spike defaults. |

### 2.2 Contracts with neighbours (inline — no separate file needed; the lead copies the patch lines)

**S2 ↔ S7 (L1, S2 lands first).**
- S2.13 exposes `onFrameToolArmed({ hasArtboardSelection })` in `editing/draw-tools.tsx`; S7.20 opens the picker
  when `hasArtboardSelection === false`. A drag drawn by S2.13 on empty canvas writes `kind="digital"`.
- `client/v2/inspector/sections.js` += sections `kind-size`, `video`, `poster`, `sound`, `formats`, `safe-zones`,
  `print`, `warnings` (top), `clip`, `title-motion`, `captions`, `music`. `kinds/index` += selection kinds
  `clip`, `title`, `caption`, `music` (timeline selections, shell-side). S7 registers bodies with `registerSlot`;
  an artboard body reads `selection.artboardKind` and returns `null` for other kinds.
- New edit ops (adding an op is not a contract change, `S2-edit-ops.md` header): `artboard.insert-preset`,
  `artboard.convert-kind`, `artboard.set-safe-zones`, `artboard.set-print` (wraps `set-artboard-print`),
  `artboard.set-print-guides`, `warning.fix` (`{ code }`), plus every `clip.*` / `video.*` op of S7.6.
- S2.10's `artboard.duplicate-at-width` is the "Add a width" row; S7.21 only places it and verifies ak-web-widths.

**S7 ↔ S8 (L2).** S8 owns these, S7 calls them:
- `videoExportContent(canvas, artboardIds) → { formats: [{ artboardId, label, size, linked, ticked }], soundOnly:
  'shared', captions: { available, defaultMode: 'off' }, maxFrames }` lives in `client/v2/export/video-content.js`
  (S7.19 writes it; S8's sheet imports it). Unlinked copies arrive unticked.
- `maude design captions export` and the burn-in read `compWords` (`video/derive.ts`, S7.4) — S8 builds both (V2-1.10).
- `useAssetPresence(rel) → { state: 'here' | 'arriving' | 'waiting' | 'missing', device?, pct? }` in
  `client/v2/assets/presence.js` (S8). Fallback before S8: on disk → here; in the hub manifest → arriving; else missing.
- The inspector **Export** section (C21) is S8's; S7's kind bodies place no export buttons of their own, they pass
  the per-kind default preset (`PNG · 1×`, `Print PDF`, `MP4`) through `exportDefaults(kind)` (S7.21).
- `exporters/video.ts` reads `artboardMeta[id].maxFrames` (≤ 18 000) — S7.18 makes the change (Reuse row S7).

**S7 ↔ S5 (L3).** `RunRecord.progress` (V2-1.15 amendment) gains `kind: 'watch' | 'place'` (studio-local). The chat
transcript renders a run card by kind through a new append-only `registerRunCard(kind, Component)` in
`client/v2/ai/run-cards.js` (lead patch on S5's area); S7.15 registers `watch` and `place`. The ring + tag under the
artboard stays S5.11's overlay; its label is `progress.label`.

**S7 ↔ S3.** Present spec `{ kind: 'artboards', from, only?: 'formats' }` — `canvas-modes.ts` validator + S3's stage
filter (lead patch; S3 consulted). `present-media.ts` unchanged.

**S7 ↔ S4.** S4.16 creates `usePlayhead(artboardId)` (read-only, `video-comp.tsx`) and `annotations/time-marks.ts`
`timeMarks(board, artboardId) → Array<{ id, t0, t1, colour }>`. S7 keeps that signature, publishes the playhead
from the island store, and draws the marks on the ruler (S7.17).

**S7 ↔ S9 (patch note named by S9 §2).** S9.22 exports `commentsAt(videoArtboard) → Array<{ threadId, frame,
author, resolved }>` from `client/v2/comments/`; S7.17 draws flags on the ruler; click opens the thread. Print mm for
comments: S7.23 exports `artboardPhysicalSize(artboard) → { wMm, hMm } | null` from `kinds/physical.ts`.

**S7 ↔ S1.** `client/v2/canvases/row-slots.js` += `setRowFilter(source: 'kind', predicate | null)` and foot source
`'filter'` (S1 owner patch; S7.24 provides `'kind'`). Layers tab header gains a filter slot (S2 owner patch).

**S7 ↔ S12 (agreed with plan-s12).** S7 owns the plugin side of its own features inside its slices (rule 14):
the verbs, plus their sections in `plugins/design/skills/video-comp/**`, `skills/footage-director/**` and
`commands/reel.md` (tracks, captions, beat grid, `reel-place --next`, "the timeline comes with a video artboard"
wording). Per slice: S7.2 transcribe-local, S7.3 beats, S7.5 the four components + lint rules + framing density
rule, S7.6 clip verbs / cut-words / cut-to-beat / captions, S7.14 reel-place + beat-grid shot lengths, S7.18 tracks
+ cap. S12 owns the agents (footage-director's hand-off envelope, footage-analyst stays Read-only), the ui-kit
artboard-kinds reference, and a final CONTRACT-words pass after S7 merges; it does not edit those skill files while
S7 runs.

**S7 ↔ L4 (hub).** Awareness fields `timeline: { artboardId, frame }` and `editing: { kind: 'caption-word',
artboardId, wordKey }` ride the same relay as S3's `present`; peers outside the project never see them (relay strip
rule, `S3-present-session.md` §2 pattern). S7.17 is Opus for this reason.

### 2.3 Lead patch requests (shared files), grouped

| File | Patch | Slice |
| --- | --- | --- |
| `bridge/dgn-protocol.ts` | c2s `artboard-anchor { artboardId, kind, label, rect } \| { artboardId: null }` on selection + rAF-throttled viewport change (**merge with S11's `artboard-empty`** — same trigger); c2s `space-tap {}`; s2c `size-ghost { preset \| null }`; c2s `size-place { presetId, world }`; s2c `dim-artboards { ids \| null }`; s2c `timeline-drop-hint { artboardId, on }` | S7.7, S7.8, S7.20, S7.24, S7.9 |
| `actions/defs/{timeline,view,edit,tool,canvas}.ts` + `agents.ts` | ids per slice below; `timeline.split` += S (timeline focus); `timeline.play` rebinding (Q10); `timeline.undo/redo` retire (Q3); `view.timeline-keep-open` semantics | most |
| `routes/index.ts` `allSpecs` | `createVideoRoutes` (`routes/video.ts`: `GET /_api/comp-media` comment-role read; `POST /_api/media-analysis` `readOnly: refused`; both `origin: 'main'`) and `createKindRoutes` (`routes/kinds.ts`: `GET /_api/kinds/presets`, `GET /_api/kinds/warnings?canvas=`) | S7.4, S7.6, S7.20, S7.25 |
| `cli/commands/design.mjs` + verb tiers (V2-2.4b) + `plugin-cli-reachability` + manifest regen | `transcribe-local`, `beats`, `captions add\|list`, `cut-words`, `cut-to-beat`, `reel-place` (auto); `transcribe` stays prompt | S7.2, S7.3, S7.6, S7.14 |
| `sync/file-membership.ts` + `apps/hub/src/file-membership.mjs` | `'.transcript.json'`, `'.beats.json'` in `COMPANION_SIDECAR_SUFFIXES` (both copies, tripwire test) | S7.1 |
| `sync/writer-registry.ts` + hub manifest | `media-analysis` writes = `companion` class; `/_api/clip-edit` alias = `lane` like edit-op | S7.1, S7.6 |
| `app.jsx` residue | `ShellTimelinePanel` mount → `client/v2/timeline/TimelineHost.jsx` (one line) | S7.7 |
| DDR-115 runtime-state lists | **none** — temp files go to the OS temp dir; Recent sizes live in `prefs.json` | — |
| `whats-new.json` | one entry at package close (lead) | S7.25 close |

## 3. Slices

Model column: **opus** = risk class (versioned formats / sync classifier / migrator, route + undo semantics, runs
and leases, cross-peer awareness). Turns are builder estimates (≤ 150).

| id | Title | Artboards made verifiable | Files owned | Lead patch requests | Model | Depends on | Done when (observable) | Red-first tests | E2E / scenario | Turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **S7.1** ∥ | Format additions (all of S7's versioned bytes) | — (feeds all) | new `video/schema.ts` (transcript + beats validators that keep unknown keys, caps), `video/format-ids.ts` (FormatIds `transcript`, `beats` + generated JSON schemas), `kinds/meta.ts` (`artboardMeta[id].{poster,snap,maxFrames,madeFrom}` read/write, R6), `kinds/print-custom.ts` (`sizeMm` + nearest-larger preset, Q7), `migrate/steps.ts` += transcripts step (V2-1.10 §5.10, `--reverse` byte-restores), `footage/edl-keys-frozen.test.ts`; the format doc sections (transcript, beats, `safeZones` prop, `sizeMm`, `artboardMeta` S7 keys) | file-membership suffixes (both copies); writer-registry `companion` | opus | — | Round-trips keep unknown keys byte for byte; v1 frozen readers accept every S7 addition (`resolvePrintArtboard` on a `sizeMm` artboard does not throw); migrator forward + reverse leave the tree byte-equal | V2-1.10 #11, #12, #13, #16; `format-field-rules.test.ts` += `artboardMeta` S7 keys under top level only; `print-custom-v1.test.ts` | — | 120 |
| **S7.2** | Words pipeline + `transcribe-local` | — | new `video/{whisper-parse,words-timing,speech,decode}.ts`, `bin/transcribe-local.{sh,mjs}`; `_transcribe.mjs` writes `.transcript.json`, never the bare `.json`; committed fixtures under `test/fixtures/video/` | verb list + tier (auto); `transcribe` keeps prompt | sonnet | S7.1 | `maude design transcribe-local assets/x.mp4` writes `assets/<sha8>.transcript.json`; exit 3 "No speech engine on this Mac" with the Settings path when whisper-cli is absent; never downloads a model | V2-1.10 #1–#4, #14 (tier half); `MAUDE_MEDIA_EVAL=1` local eval reproduces §6.1–§6.2 budgets | — | 130 |
| **S7.3** ∥ | Beats + `beats` verb | — | new `video/beats.ts` (flux / autocorrelation / Ellis DP / bar phase), `video/decode-webaudio.ts` (headless-Chromium fallback), `bin/beats.{sh,mjs}` | verb list + tier (auto; `--dry-run` none) | sonnet | S7.1 | `maude design beats assets/m.mp3 [--bpm N]` writes `.beats.json`; `--bpm` keeps phase; ffmpeg missing → Chromium path, identical output | V2-1.10 #7 (synth F ≥ 0.85, ffmpeg-only baseline < 0.7) | — | 110 |
| **S7.4** | Derivation + `GET /_api/comp-media` | — | new `video/derive.ts` (`compClips`, `compWords`, `compSpeech`, `duckGain`, `compBeats`, `transcriptCut`, `reframeWindow`, `placeAt`), `routes/video.ts` (comp-media, read-only, comment role) | `allSpecs` += `createVideoRoutes` | sonnet | S7.1 | `/_api/comp-media?canvas&artboard` returns `{fps, clips, words, speech, beats, unresolved}` ≤ 100 ms warm; 100 clips / 5 000 words derive ≤ 30 ms | V2-1.10 #5, #6, #10, #15 (canvas origin → 403); `derive-bench.test.ts` (budget, skips under load flag) | — | 120 |
| **S7.5** | Comp vocabulary in canvas-lib + build injection | — (feeds S7.11–S7.13) | `canvas-lib.tsx` (exports `Captions`, `Duck`, `Reframe`, `Place`, one block), the canvas build pass (`__words` / `__speech` injection, transcript files recorded as build inputs → rebuild on change), `canvas-check` lint rules (one `<Captions>`, `<Duck>` wraps one `<Audio>`, `<Reframe>` sorted / in range / no `follow`, `fixes` JSON literal), `exporters/video.ts` render uses the same injection | — (L1 file in S7's window) | opus | S7.4; L1 window after S4.16 | A comp with `<Captions words="line">` shows words that follow a trim with no file write; `maude design check` refuses `<Reframe follow>`; a 1.x build shows "This canvas uses Maude 2" | `comp-vocab-render.test.tsx`; `build-injection.test.ts` (escaping `'` `` ` `` `${` `</script>` as text, V2-1.10 #11 half); `canvas-check-video.test.ts` | — | 140 |
| **S7.6** | Clip ops as edit ops + analysis jobs + verbs | — (feeds S7.9–S7.15) | new `edit-ops/clip/*.ts` (every `clip-ops.ts` applier + `cut-source-range`, `snap-to-beats`, `reframe`, `duck`, `captions`, `place`, `format.add`, `format.unlink`, `take.swap`, `fit`), `/_api/clip-edit` → forwards to the dispatcher (alias kept), `routes/video.ts` += `POST /_api/media-analysis` (job channel), `bin/{captions,cut-words,cut-to-beat}.*`, retire the timeline-local revert path (`reorder-revert` stays served for v1 callers) | registry `video.*` 12 ids (V2-1.10 §5.7) + `video.format.add/unlink`, `video.take.swap`, `video.fit`; `timeline.undo/redo` → `MOVED_KEYS`; verb list; writer-registry alias | opus | S7.4, S2.1 merged (dispatcher) | A split during an AI cut on the same artboard answers 409 `held-by-ai`; ⌘Z after a timeline split undoes it through project undo; `cut-words --words w12-w15` removes 0.4 s and captions follow | V2-1.10 #8, #9, #14, #15; `clip-edit-alias.test.ts` (old body shape → same bytes); `access-role-matrix` row (Can comment → clip ops 403) | `video-transcript-cut.e2e.mjs` (agent path: same bytes as the UI, rule 14) | 150 |
| **S7.7** | The island: summon, follow, compact/full, keep open | 07/ve-none, ve-select, ve-deselect, 05/es-timeline | move `client/panels/TimelinePanel.jsx` → `client/v2/timeline/Timeline.jsx` (body unchanged), new `client/v2/timeline/{TimelineHost,island,anchor,timeline-store}.js(x)`, `timeline.css`; canvas emitter for `artboard-anchor` in `canvas-shell.tsx` (one block) | dgn `artboard-anchor`; `app.jsx` mount; registry `timeline.expand` / `timeline.compact` (no key), `view.timeline-keep-open` semantics | sonnet | S2.1 (select `kind`), S11.1 kit, L1 window | Select a video artboard → compact island slides out of its bottom edge with the notch on its centre, re-anchors on pan/zoom; another video takes it over and each keeps its playhead; esc / non-video → slides back; ⇧⌘T → "Kept open"; ⌘\ hides it; empty comp shows the S11 kit line + one AI chip | `timeline-summon.test.ts` (store rules), `timeline-anchor.test.ts` (clamp 16 px, notch), `nothing-deleted` remap of moved testids | `video-timeline-summon.e2e.mjs` (replaces the dock scenario; coordinates, the canvas iframe is DOM-unreachable) | 140 |
| **S7.8** | Tracks, ruler, transport, play, Space | 07/ve-play | new `client/v2/timeline/{tracks,lanes,ruler,transport,keys,playhead}.js(x)` (carved out of `Timeline.jsx`; `registerLane(track, Lane)` append-only), `video-comp.tsx` (poster frame picture from `artboardMeta.poster`, centred play button with sound, on-artboard scrub bar), canvas `space-tap` emitter | dgn `space-tap`; registry `timeline.play` rebinding, `timeline.split` += S, `timeline.loop-in` I / `timeline.loop-out` O (timeline focus), `video.poster.set` | sonnet | S7.7, S4.16 (`usePlayhead`) | Four tracks in order with C35 derivation; ruler auto-steps 1/3/5/10/30/60 s; tap Space plays the selected video in place with sound, hold Space pans; I/O set a loop band; ←/→ a frame ("0:07 + 2 frames"), ⇧←/→ a second; S splits only with timeline focus | `timeline-keys-focus.test.ts` (C26 order, ⌘B always), `space-tap.test.ts` (200 ms, drag cancels), `tracks-derive.test.ts` (overlay → Video 2) | `video-play.e2e.mjs` | 140 |
| **S7.9** | Drop, trim, split, move, clip menu | 07/ve-drop, ve-trim-split, ve-move-transition | new `client/v2/timeline/edit/{drop,trim,move,clip-menu}.jsx` (carved), canvas drop chip "Or drop here — adds at the end" (one block in `canvas-shell.tsx`) | dgn `timeline-drop-hint`; registry `timeline.clip-menu.*` (17 rows, D15; Advanced ▸ for the 11 undrawn) | sonnet | S7.8, S7.6 | Drop 3 clips → insert line + "Drop 3 clips at 0:09 · the video grows by 0:20"; trim tip "Touchdown · 2.4 s · −0.6 s · video 0:14" with ripple; S → toast "Split Oslava at 0:10." + Undo; drag lifts, "Drop before Touchdown", length unchanged; a fixed Length trims the end | `timeline-ripple.test.ts`, `clip-menu-rows.test.ts` (17 kept, golden order) | `video-edit-basics.e2e.mjs` | 130 |
| **S7.10** | Joins, clip / title / video inspectors, fit-fill (D15 closes) | 07/ve-transition, ve-fit-fill | new `client/v2/timeline/joins/transition-picker.jsx` (hover plays the two real shots), `client/v2/inspector/kinds/{clip,title}.jsx` + section bodies `clip`, `title-motion` (6 presets), `client/v2/timeline/fit-fill.jsx`; **moves** `ClipInspector.jsx` tabs into the clip inspector (Grade / Crop / Transition frames under Advanced) and deletes the dialog file once empty | `sections.js` / `kinds/index` (§2.2); registry `video.title.motion`, `video.transition.set` | sonnet | S7.9, S2.2 | Click a join → picker titled "Oslava → Logo", 6 tiles, Length slider; clip select → right inspector Length · Speed · Volume · Framing + Advanced `src in out`; a vertical clip on 16:9 asks once (Fill · Fit · Blur behind, "Same for every vertical clip"); an all-mute video shows the Music empty hint | `clip-inspector-rows.test.ts`, `title-motion-presets.test.ts`, nothing-deleted D15 rows all mapped to v2 homes | — | 140 |
| **S7.11** | Captions + Transcript panel (edit by transcript) | 07/ve-text, ve-captions | new `client/v2/timeline/lanes/caption-lane.jsx`, `client/v2/transcript/{TranscriptPanel,transcript-model}.js(x)`, `client/v2/inspector/kinds/caption.jsx` | registry `video.captions.add/style/fix-word`, `video.transcript.cut/find-speech/open`; S8 flag "Also as a file" | sonnet | S7.5, S7.6, S7.2, S7.8 | "Captions from speech" → words land one by one on text lane 1, toast "Captions added — 15 words from the interview." + Undo; select "Ehm…" + ⌫ → video 0:30 → 0:29, captions follow, ⌘Z restores; type over a word → `fixes`; p < 0.5 underlined; loop words "May be noise, not speech"; no engine → "Captions need speech recognition on this Mac." + Set up… | `transcript-model.test.ts` (select → wordIds, struck = uncovered), `caption-fix.test.ts` (Q4 this video only) | `video-edit-by-transcript.e2e.mjs` (V2-1.10 §7) | 140 |
| **S7.12** | Music: beats, snap, ducking, Cut to the beat | 07/ve-music | new `client/v2/timeline/lanes/music-lane.jsx` (waveform, ticks — bar taller, duck curve "Lower under speech"), `client/v2/inspector/kinds/music.jsx`, snap source in `timeline-snap.js` (`compBeats` when `artboardMeta.snap`) | registry `video.music.beats/duck`, `video.cut-to-beat`, `video.snap` | sonnet | S7.5, S7.6, S7.3, S7.8 | Add music → beats detected, ticks drawn; Snap to the beat moves drags to beats; Lower under speech draws the dip; Advanced `bpm 120 (detected)` with Half · Double; Cut to the beat keeps the length | `snap-beats.test.ts`, `music-inspector.test.ts` (defaults Q5/Q6) | — | 120 |
| **S7.13** | Linked formats + Re-frame island | 07/ve-formats, ve-reframe | new `client/v2/timeline/reframe-island.jsx`, `client/v2/inspector/sections/formats.jsx`, canvas link-line glyph + "Unlinked copy — its own cut" tag (one block) | registry `video.format.add/unlink`, `video.reframe` (§5.8 foot copy) | sonnet | S7.5, S7.6, S7.8, S7.22 | "+ Add a format" adds a linked 16:9 sharing the cut; a trim shows in all three; chip "Shared by 3 formats"; Re-frame: dragging the window at the playhead writes a focus keyframe in source time, per format or All formats; Reset; **Follow a subject not built** (rows marked "deferred by DDR (B3)" for those parts) | `linked-formats-derive.test.ts`, `reframe-keyframes.test.ts` (source time across trim) | `video-formats.e2e.mjs` | 130 |
| **S7.14** | AI cut streaming: reel-place, progress, AI edge | 07/ve-ai-scrub, ve-ai-proposal | new `video/reel-place.ts`, `bin/reel-place.{sh,mjs}` (exit 4 "All shots are placed"), `client/v2/timeline/ai-edge.jsx` (spark line + "AI" tag, landing animation, "Placing shot 7 · Tackle 2 …" island), status chips "AI is cutting" / "Made by AI · 14 shots" | run registry `progress.kind` (S5 area); verb list | opus | S7.6, S7.8, S5.2, S5.5 | `reel-place --next` × 14 with Stop after 7 → one published action with 7 shots, "Placed 7 of 14 shots." + Keep going, ⌘Z removes all 7; scrubbing the placed part never moves the AI edge or your playhead | `reel-place.test.ts` (EDL → one literal Sequence + TOTAL), `run-progress-derive.test.ts` (from writes, never prose) | `video-ai-cut-stop.e2e.mjs` (V2-1.10 §7) | 140 |
| **S7.15** | AI cut chat cards + Other takes | 07/ve-ai-cut, ve-ai-watch, ve-ai-adjust | new `client/v2/ai/video/{ClipsAttached,WatchProgress,LeftOut}.jsx` (registered through `registerRunCard`), `client/v2/timeline/other-takes.jsx` | `client/v2/ai/run-cards.js` (S5 area, §2.2) | sonnet | S7.14, S5.9, S5.10 | "Watching 12 clips… 7 done" grid + found lines from `.footage.json`; "Watched all 12. Left out 3: …" + Use them anyway; the run creates "Recap · Reels · 0:30" when no artboard is named; Other takes shows same-length takes, "✦ AI's pick", swap = ordinary edit | `watch-progress-derive.test.ts`, `other-takes.test.ts` (same length, same beat) | — | 120 |
| **S7.16** | Footage states + long videos | 07/ve-footage, ve-long | new `client/v2/timeline/{footage-state,zoom,fold,markers}.js(x)`; ⌘K provider "clips by name" (search provider registration) | registry `timeline.fold-track`, `timeline.marker.add/jump`; ⌘K provider id | sonnet | S7.8, §2.2 `useAssetPresence` | Clip "Dron klesá · waiting for Jonas's Mac", inspector "Your edit is safe. It plays once the file arrives."; preparing clips show %; 40 clips zoom out, names on hover, tracks fold to "Text · 18", markers jump, ⌘K finds a clip, ⌘+/⌘− over the timeline zooms it | `footage-state.test.ts` (waiting ≠ missing), `timeline-fold.test.ts` | — | 120 |
| **S7.17** | Together: peer playhead, word lock, comment + time marks | 07/ve-together | new `client/v2/timeline/{peers,marks}.jsx`; awareness fields (§2.2) in the collab client | awareness fields + relay strip (L4 review); S9.22 `commentsAt`; S4 `timeMarks` | opus | S7.8, S9.22, S4.16, S3.7a | Tereza's playhead shows as a thin sky line; her caption word is locked to her ("Tereza is fixing a caption") until she leaves it, and a clip op touching it answers `locked`; comment flags and time-pinned stickies sit on the ruler | `timeline-awareness.test.ts` (strip outside project), `caption-word-lock.test.ts` | `video-together.e2e.mjs` (two windows, V2-3.2 harness) | 130 |
| **S7.18** | Timeline Advanced, "+ track", video cap | 07/ve-advanced, 06/ad-timeline | new `client/v2/timeline/advanced/{foot,easing-curve,render-settings,cut-as-code}.jsx` (Timecode / Frames seg, frame readout, long badge, keyframe markers — testids kept), "+ track" → Video 2 / Music 2; `exporters/video.ts` reads `artboardMeta.maxFrames` | registry `timeline.add-track`, `video.allow-longer`; S11 `registerAdvancedRow` not needed (own foot) | sonnet | S7.8, S7.6 | Advanced open: ruler in frames, "30 fps · frame 354 of 900 · 00:00:11:24", easing curve writes `cubic-bezier(…)`, EDL / Code seg + Open in code view; a 2:40 video warns "2:40 long — one export goes up to 2 min (3600 frames at 30 fps)." + Allow longer (≤ 18 000) | `video-cap.test.ts` (C22 everywhere past 3600), `easing-write.test.ts`, nothing-deleted ad-timeline rows remapped | — | 120 |
| **S7.19** | Full-screen video + export content | 07/ve-fullscreen, ve-export, ve-render | new `client/v2/present/video-present.jsx` (format switch, transport scrub + loop ticks + volume + captions toggle), `client/v2/export/video-content.js` (§2.2) | Present spec `only: 'formats'` (S3 consulted) | sonnet | S7.13, S3.3 merged, S8 sheet + Exports panel | Present with a video selected → only the video, top-left 9:16 / 16:9 / 1:1 switch, "esc Back to the canvas", loop carries over; ⇧⌘E → Scope This canvas, 3 of 4 formats ticked, "Sound only makes one file — the formats share their sound.", captions Off by default (C19) | `video-export-content.test.ts`, `present-only-formats.test.ts` | `video-present.e2e.mjs` | 110 |
| **S7.20** | Preset catalogue + F size picker | 08/ak-picker, ak-picker-full | new `kinds/presets.ts` (one catalogue: picker, Edit › Advanced ▸ New artboard, Size select; search index), `routes/kinds.ts` (`GET /_api/kinds/presets`), `client/v2/kinds/{SizePicker,CustomPrint}.jsx`, canvas `editing/size-ghost.tsx`, `edit-ops/insert-preset.ts`; Recent in `prefs.json` | dgn `size-ghost` / `size-place`; registry `artboard.insert-preset`, `artboard.new-video` (⌘K "New video", D17); `MODE_TOOLS` F hook (S2.13) | sonnet | S2.13, S7.1 | F with nothing selected → picker above the toolbar: search "A5 / story / 1920", Recent chips, 5 groups with badges, "All 7 ›"; hover a tile → dashed ghost "FB event cover 1920 × 1005"; click lands it with its kind; Custom size… → mm island → Add artboard writes `sizeMm` | `presets-catalogue.test.ts` (one source; Edit › Advanced list agrees), `insert-preset.test.ts` | `kinds-picker.e2e.mjs` | 130 |
| **S7.21** | Kind inspectors: web, fixed size, video, several kinds | 08/ak-web-hug, ak-web-widths, ak-social, ak-video, ak-mixed-select | new `client/v2/inspector/kinds/artboard-{web,fixed,video,multi}.jsx` (slot bodies), `kinds/export-defaults.ts`, canvas growth tag "+ 373 px" (one block) | — (slots only) | sonnet | S2.8, S2.10, S7.20, S7.22 | Kind chip words per C16; Web: Height "Fits content \| Fixed" + "1573 now — grows as you add.", Add a width → toast "Tablet and Mobile are beside Desktop. Their layout reflowed to fit." + Undo; Video: Size · Length · Poster frame Change · Sound · Advanced `kind video · fps 30 …`; two kinds → "2 artboards", "2 kinds", "Size and paper differ. Select one to change it." | `kind-inspector-rows.test.ts` (golden per kind), `multi-kind-shared.test.ts` | — | 130 |
| **S7.22** | Safe zones | 08/ak-safe-zones | new `kinds/safe-zones.ts` (7 presets, "checked Oct 2026"), `safe-zones-overlay.tsx` (`registerKindOverlay`), `client/v2/inspector/sections/safe-zones.jsx`, the "Under the caption" flag | `view.json overlays.safeZones` (already ignored runtime file; no list change) | sonnet | S7.1, L1 window | Story / Reels / grid bands drawn, labelled; menu foot "Shown on the canvas only — never exported. Zones as each platform publishes them, checked Oct 2026."; content under a band flagged; every exporter output has no band | `safe-zones-never-exported.test.ts` (capture + PNG + PDF), `safe-zones-prop-v1.test.ts` (R2) | — | 110 |
| **S7.23** | Print inspector, guides precedence, Advanced, real artboards | 08/ak-print-letak, ak-print-view, ak-advanced, ak-real-about, ak-real-print, ak-real-web | new `client/v2/inspector/kinds/artboard-print.jsx`, `kinds/physical.ts` (`artboardPhysicalSize`, for S9), `client/v2/kinds/advanced-rows.js` (S11 `registerAdvancedRow` entries: Exact size, Resolution, Colour, Guides + Add, Look and layout, In code) | registry `artboard.set-print`, `artboard.set-print-guides` (per artboard, C25 override) | sonnet | S7.1, S7.20, S11.8, S2.8 | Paper · mm size · Orientation · Bleed · Safe margin (`marginsMm`) · Print guides switch · "RGB — the print shop converts to CMYK." · size tag "105 × 148 mm"; View › Advanced › Print guides = default, per-artboard switch wins; Advanced shows `print PDF 300 dpi · vector text` | `print-guides-precedence.test.ts` (C25), `print-inspector-mm.test.ts` | — | 120 |
| **S7.24** | Kind filter chips: Layers + Canvases | 08/ak-mixed-fit, ak-mixed-filter, 05/es-filter | new `client/v2/kinds/{KindChips,kind-filter-store}.js(x)`, canvas `editing/kind-dim.tsx` | dgn `dim-artboards`; S1 `setRowFilter` + foot `'filter'`; Layers header slot (S2 owner); registry `layers.filter-kind`, `canvases.filter-kind` | sonnet | S1.12, index `byKind`, S11.1 | Chips All · Fixed size · Web page · Print · Video with counts (aria "Print, 2"); Layers Print → others dimmed, foot "19 other artboards are dimmed. Show all"; Canvases Video → "12 of 93 canvases have video"; a filter hiding everything says which filter and undoes in one click (kit) | `kind-filter.test.ts` (counts from the index, a canvas counts once per kind) | — | 110 |
| **S7.25** | Change kind makes a copy + one warning style | 08/ak-convert, ak-convert-after, ak-warnings | new `kinds/{convert,warnings}.ts` (effective ppi at 300 dpi, layers crossing the cut, extra-height fill, crosses cut / longer than one export / not paper size / wider than web), `routes/kinds.ts` += warnings, `edit-ops/convert-kind.ts` (copy beside, `artboardMeta.madeFrom`), `client/v2/kinds/ConvertDialog.jsx`, `client/v2/inspector/sections/warnings.jsx`, label warn mark in `DCArtboard` label (one block) | registry `artboard.convert-kind`, `warning.fix`; `whats-new.json` at close | sonnet | S7.21, S7.23, S7.20 | Size select "A6" on a post → "Make “Oznámení události” an A6 print?" with Check after list and the copy switch on; after: copy beside, post "Unchanged", toast "The A6 copy is beside the post. The post is unchanged." + Undo; warnings: label mark "2 things to check" + top inspector row with one verb (Move inside · Allow longer · Fix size · Fit to width · Replace… · Show), never modal | `convert-kind.test.ts` (copy, original bytes unchanged), `warnings-detect.test.ts` (4 detectors) | `kinds-convert.e2e.mjs` | 140 |

25 slices, ≈ 3,240 turns. That is above the 6–14 guide on purpose: S7 carries 48 artboard rows plus the whole
V2-1.10 substrate (9 modules, 7 verbs, a migrator step); each slice still fits one fresh builder.

## 4. Ledger coverage check

**Artboard rows with `package: "S7"` (45) — each in exactly one slice:**
- 07 (26): S7.7 ve-none, ve-select, ve-deselect · S7.8 ve-play · S7.9 ve-drop, ve-trim-split, ve-move-transition ·
  S7.10 ve-transition, ve-fit-fill · S7.11 ve-text, ve-captions · S7.12 ve-music · S7.13 ve-formats, ve-reframe ·
  S7.14 ve-ai-scrub, ve-ai-proposal · S7.15 ve-ai-cut, ve-ai-watch, ve-ai-adjust · S7.16 ve-footage, ve-long ·
  S7.17 ve-together · S7.18 ve-advanced · S7.19 ve-fullscreen, ve-export, ve-render (3+1+3+2+2+1+2+2+3+2+1+1+3 = 26).
- 08 (19): S7.20 ak-picker, ak-picker-full · S7.21 ak-web-hug, ak-web-widths, ak-social, ak-video, ak-mixed-select ·
  S7.22 ak-safe-zones · S7.23 ak-print-letak, ak-print-view, ak-advanced, ak-real-about, ak-real-print, ak-real-web ·
  S7.24 ak-mixed-fit, ak-mixed-filter · S7.25 ak-convert, ak-convert-after, ak-warnings (2+5+1+6+2+3 = 19).

**Rows moved to S7 by S11 §4.2 (evidence by the last part) — 3:** 06/ad-timeline → S7.18; 05/es-timeline → S7.7;
05/es-filter → S7.24. Total 48; none assigned away.

**Parts drawn on S7 artboards that another package builds (verified jointly, S7 captures):** the export sheet and
Exports panel on ve-export / ve-render (S8); the chat panel shell on ve-ai-* (S5); the Add-a-width action on
ak-web-widths (S2.10); comment threads behind ruler flags (S9.22); the Export section rows in every kind inspector
(S8, C21). Parts B3 defers ("Follow a subject", the subject chip, `track subject #1 · 98 %`, the track box and
motion path on ve-reframe / ve-formats / clip Advanced): the lead marks them "deferred by DDR (B3)" on those rows.

**Rule / home rows S7 closes:**
- `00/rule/the-timeline-comes-with-a-video-artboard` — S7.7.
- `00/rule/space` — S7.8 (handed over by S3-slices §4).
- `00/rule/print-colour-in-one-line` — S7.23, `00/rule/not-here-yet-vs-missing` — S7.16, both under Q14's condition.
- `G0-D/D15` — S7.10 (clip inspector + Advanced), with S7.9 (17-item menu) and S7.18 (transport Advanced homes).
- `G0-D/D17` — S7.20 ("New video" + New artboard › Video); the Theme half already has its home (`settings.theme`).
- Contributes, not closes: `G0-D/D6` (Kind row in the artboard inspector, Open Timeline → S2), `G0-D/D14`
  (transcription engine copy in the Captions empty state → S11/S8), `00/rule/two-toolbars-one-per-mode` (none),
  `designer-vocabulary` / `no-we-no-i` / `one-verb-per-dialog-one-action-per-toast` (copy in every slice).
- Gate 0 rows realised: B3 (S7.2–S7.6, S7.11–S7.14), C16 (S7.21), C19 (S7.19), C21 (S7.21), C22 (S7.18, S7.25),
  C25 (S7.23), C26 (S7.8), C35 (S7.8, S7.18), C36 (S8 builds, S7.4 supplies `compWords`).

**Nothing-deleted:** every TimelinePanel / ClipInspector `D15` entry and the three `ad-timeline` testids keep their
testids through the move (S7.7); each carve slice updates its rows' `v2` field in the same commit (via the lead);
`ClipInspector.jsx` is deleted only by S7.10 after its rows map to the clip inspector.

## 5. Risks and run order

**Risks.**
- *`Timeline.jsx` is 2,433 lines and seven slices carve it.* Same mitigation as S4: S7.7 moves it whole; each later
  slice moves its own part into a new module, so hunks stay small. S7.8 → S7.9 → S7.10 are strictly serial.
- *Edit-op dependency.* S7.6 needs S2.1's dispatcher on feat. If it slips, S7.6 starts on the `s2-1` branch base and
  rebases; nothing in S7.7–S7.8 needs it.
- *The canvas build reading transcripts* (S7.5) widens the rebuild graph; the test pins that only canvases that read a
  changed transcript rebuild.
- *Media evals are local-only* (`MAUDE_MEDIA_EVAL=1`); CI runs committed fixtures. A builder must not "fix" a budget
  test by widening it — regressions there go to the lead.
- *Canvas iframe is DOM-unreachable from e2e*: island scenarios drive coordinates and structural routes
  (`/_api/comp-media`), never selectors inside the canvas.
- *Awareness fields leaking to non-members* (S7.17): reviewed with the L4 relay strip; Opus.

**Order.**
- **Now, parallel, off L1** (only new files; no shared hunk between them): S7.1 first (≈ 1 day), then S7.2 ∥ S7.3 ∥
  S7.4 on separate worktrees. S7.6 after S7.4 + S2.1. S7.20's shell half and S7.15 can start once their deps land.
  ≈ 990 turns (31 %) sit off the L1 critical path.
- **L1 window (after S4.16):** S7.5 → S7.7 → S7.8, then two tracks:
  - timeline: S7.9 → S7.10 → { S7.11 ∥ S7.12 } (different lane files) → S7.13 → S7.14 → { S7.15 ∥ S7.16 } → S7.17 →
    S7.18 → S7.19;
  - kinds (canvas hunks in `editing/*` + one `DCArtboard` label block, no timeline file): S7.22 → S7.20 → S7.21 →
    S7.23 → S7.24 → S7.25, run beside the timeline track on its own worktree; the only shared canvas file is
    `canvas-shell.tsx`, where each slice adds one block — the lead rebases them in order.
- **Close:** S7.25 last; whats-new entry; the e2e set (summon, play, edit basics, edit by transcript, formats, AI cut
  stop, together, present, kinds picker, kinds convert) runs on the default desktop lane.
