# Project persistent writer registry

**Executable half (2026-09-15):** [`apps/studio/sync/writer-registry.ts`](../../apps/studio/sync/writer-registry.ts)
classifies every `/_api/*` route the studio serves as `read`, `lane`,
`structural`, `file-plane`, `git` or `local`, naming for each lane/structural
writer how it travels in accepted-revisions mode and the test that proves it;
`test/sync-writer-registry.test.ts` fails for an unclassified or stale route.
Runtime tripwires back it: the accepted-replica write counter
(`acceptedWriteViolations`), the hub's per-message read-only fence, and the
collab room's accepted-mode refusal. The rows below remain the call-site
inventory those classes were derived from.

T6 inventory, inspected 2026-09-14 against the current worktree. This is a migration registry, **not an implemented transaction API or a passing conformance gate**. The [transaction contract](project-transactions.md) defines the destination; the [implementation plan](../../.ai/plans/archive/feature-reliable-project-multiplayer.md) retains T1–T35. Each row below identifies a concrete current input or sink, its future authority, owner and required test. No row grants an existing writer permission to mutate accepted state.

## Scope and reading key

Persistent project content includes canvas source, CSS, metadata, annotations, comments, photo/footage/edit sidecars, explicit directories, support modules, design-system/configuration content, and media references. A file excluded from Git can still contain canonical shared content: comments are the main example. Persistence of a local cache is not a shared content action.

Current boundaries:

- **HTTP**: studio route guards and route-specific validation; hub proxy and membership enforcement when reached remotely. Loopback/Host/origin/canvas capability checks are not the proposed authenticated project commit boundary.
- **Room**: local Yjs room/protocol gates or hub Hocuspocus connection permissions. Accepted content remains writable through these legacy transports until T12 fences them.
- **Disk**: process-local file lock, path containment, atomic rename and watcher import. These do not establish an accepted revision or prove an external editor's base.
- **Projector**: system process materializing remote state. Its future authority is an accepted revision plus a current projector fence, never implicit authorship.
- **Control**: project membership, configuration, setup and migration. Content-changing control operations still require a project action; secrets/local trust stay outside the manifest.

Tripwires referenced by every row are future requirements, not existing test results:

| Code | Conformance assertion required for each listed entry/variant |
|---|---|
| A | Exact retained proposal produces one durable action/effect set; same-ID replay after lost ACK changes neither revision nor history; different bytes under that ID fail. No public document/file mutation before acceptance. |
| S | Target/generation/base checked; resulting source parses without executing project code; untouched bytes preserved; rejected candidate bytes retained. Run distinct peer edits and stale target/base cases. |
| M | Manifest identity survives rename; retired generation rejects old work; source, sidecars, dependencies and descendants change atomically; empty directories survive bootstrap/restart. |
| P | Peer-authored subsequent effect survives local undo, including equal-value assignment; valid A→B→A is a new action. |
| B | Referenced immutable blob is durable and hash-verified before acceptance; interrupted upload resumes; receiving mounted media decodes after cold arrival. |
| F | Old epoch, revoked capability and replaced projector cannot change accepted content or serving snapshot; include already-open sockets and direct helper invocation. |
| R | Restart/repair projects the same accepted manifest without adding author actions, losing pending work or resurrecting retired generations. |
| E | Camera, selection, awareness, caches, secrets and runtime state never enter accepted project content or shared undo. |

Action names below map to the contract's operation families. `manifest.replace`, `config.assign`, `footage.assign` and `edl.edit` are **schema gaps explicitly proposed by this inventory**, not silently added implemented operations. The current family list has no precise variant for these inputs.

## Studio content routes and API calls

The HTTP dispatch is [http.ts](../../apps/studio/http.ts). The in-process API is [api.ts](../../apps/studio/api.ts). The following table enumerates content-mutating routes separately from their disk/room sinks. UI, native shell, canvas iframe and loopback CLI callers must all resolve to the same future adapter.

| ID | Current entry → actual mutation function | Planned action / authority | Owner; tripwires |
|---|---|---|---|
| S01 | POST `/_api/edit-text` → `editText` → `suppressedEdit` → `canvas-edit.ts:editText` | `source.text.assign`; HTTP→proposal | T15/T24; A,S,P,F |
| S02 | POST `/_api/edit-css` → `editCss` → `editAttribute` / `removeAttribute` on `style.<property>` | `source.css.assign`; HTTP→proposal | T15/T24; A,S,P,F |
| S03 | POST `/_api/edit-attr` → `editAttr` → `editAttribute` / `removeAttribute` | `source.attribute.assign`; HTTP→proposal | T15/T24; A,S,P,F |
| S04 | POST `/_api/reorder` → `reorder` → `moveElement` | `source.structure` move/reparent | T25; A,S,P,F |
| S05 | POST `/_api/delete-element` → `deleteElementOp` → `deleteElement` | `source.structure` delete | T25; A,S,P,F |
| S06 | POST `/_api/insert-element` → `insertElementOp` → `insertElement` / `insertElementIntoArtboard` | `source.structure` insert plus imports | T25; A,S,M,P,F |
| S07 | POST `/_api/duplicate-element` → `duplicateElementOp` → `duplicateElement` | `source.structure` duplicate with fresh stable identity | T25; A,S,P,F |
| S08 | POST `/_api/convert-to-absolute` → `convertChildrenToAbsoluteOp` → `convertToAbsolute` | `source.structure` + property assignments in one action | T25; A,S,P,F |
| S09 | POST `/_api/detach-component` → `detachComponentOp` → `detachComponent` | `source.structure` detach with import/source dependencies | T25; A,S,M,P,F |
| S10 | POST `/_api/insert-artboard` → `insertArtboardOp` → `insertArtboard` | `source.structure` artboard insert + `layout.assign` | T17/T25; A,S,M,P,F |
| S11 | POST `/_api/duplicate-artboard` → `duplicateArtboardOp` → `duplicateArtboard` | `source.structure` artboard duplicate + layout | T17/T25; A,S,M,P,F |
| S12 | POST `/_api/delete-artboard` → `deleteArtboardOp` → `deleteArtboard` | `source.structure` artboard removal + layout | T17/T25; A,S,M,P,F |
| S13 | POST `/_api/resize-artboard` → `resizeArtboardOp` → `resizeArtboard` | Supported source width/height assignments + layout | T25; A,S,P,F |
| S14 | POST `/_api/set-artboard-hug` → `setArtboardHugOp` → `setArtboardHug` | Supported artboard attribute/style assignment | T25; A,S,P,F |
| S15 | POST `/_api/set-artboard-style` → `setArtboardStyleOp` → `setArtboardStyle` | Supported source style assignments | T25; A,S,P,F |
| S16 | POST `/_api/set-artboard-kind` → `setArtboardKindOp` → `setArtboardKind` | Supported source kind assignment | T25; A,S,P,F |
| S17 | POST `/_api/set-artboard-guides` → `setArtboardGuidesOp`; POST `/_api/set-artboard-print` → `setArtboardPrintOp` | Supported artboard property assignments; exact payloads must retain guide/print validation | T25; A,S,P,F |
| S18 | POST `/_api/reorder-revert` → `reorderRevert` writes the stored whole-file before/after version through `withLock` | `history.undo` / `history.redo`, server-built compensating operation; whole-file replay is legacy | T5/T28; A,S,P,F |
| S19 | PATCH/POST `/_api/canvas-meta` → `patchCanvasMeta`; `canvas-lib.tsx:patchCanvasMeta` calls it for layout and viewport | `layout.assign` for shared properties; split camera/overlays/locked preferences from project content | T17/T25; A,M,P,E,F |
| S20 | POST `/_api/canvas` → `createCanvas` writes TSX + meta; DELETE route → `deleteCanvas`, folder inputs → `deleteFolder` | `manifest.create` / `manifest.delete`; document ID/generation, atomic sidecars | T17/T25; A,S,M,F |
| S21 | POST `/_api/fs-move` → `moveCanvas`, directory inputs → `moveFolder`; `rewriteCanvasImports` rewrites relative imports | `manifest.move` plus source import edits in the same action | T17/T25; A,S,M,F |
| S22 | POST `/_api/fs-mkdir` → `createFolder` creates directory + `.gitkeep` | `manifest.create` directory. `.gitkeep` is excluded by the current classifier, so it cannot stand in for this entry | T17; A,M,F |
| S23 | PUT/POST `/_api/annotations` → `saveAnnotations` → sanitized SVG disk write + `onAnnotationsChanged`; `annotations-layer.tsx` PUT chain includes optional `writeId` | `annotation.create/update/delete` by stable stroke ID, grouped gesture | T17/T26; A,P,F; concurrent disjoint strokes |
| S24 | `/_ws` messages `comments-add`, `comments-patch`, `comments-delete` → `commentsAdd`, `commentsPatch`, `commentsDelete`; POST `/_api/comments/:id/reply` → `commentsAddReply` | `comment.create/update/delete/reply`; authenticated actor and per-operation rights | T17/T26; A,P,F; reader cannot edit another author's comment |
| S25 | PUT/POST `/_api/photo-edit?asset=` → `photoStore.savePhotoEdit`; `client/photo-knobs.jsx` edits/reset/undo; `canvas-lib.tsx` background removal uploads mask then PUTs edit | `photo.assign` with asset identity and grouped reset/mask operation | T17/T26; A,P,B,F |
| S26 | PUT/POST `/_api/footage?asset=` → `footageStore.saveAnalysis`; `?slug=` → `saveEdl` | `footage.assign` / `edl.edit` schema gaps, source/media dependencies | T16/T17/T26; A,S,B,P,F |
| S27 | POST `/_api/asset` → `saveAssetFromStream`; `saveAsset(bytes)` also calls stream writer | Blob upload then accepted manifest entry/reference | T18; A,B,F |
| S28 | POST `/_api/import-asset` → import helper; POST `/_api/import-brand` → `importBrand`; Figma routes described below | Grouped import proposal after blob staging | T16/T18/T20; A,S,M,B,F |
| S29 | POST `/_api/generate-jobs`: `localizeGenAsset` → `saveAsset`, `writeCaptionSidecar`, `writeAudioIntent`, generated-video `saveAnalysis` | One generation action including outputs and provenance; immutable blobs first | T16/T18/T26; A,M,B,F |
| S30 | POST `/_api/generate/audio-reuse` → `writeAudioIntent`; cloud transcription job → `writeCaptionSidecar` | Explicit sidecar assignment/replacement with exact base; not just upload deduplication | T16/T18; A,B,F |
| S31 | POST `/_api/generate/prefs` → generation preference writers in `generation/prefs.ts` update `.design/config.json` | `config.assign` schema gap; field-level project policy, credentials excluded | T17/T20; A,P,E,F |

Route links intentionally point to source files rather than fixed line numbers: another implementation agent is actively modifying the same worktree, so line offsets are not a stable snapshot identifier. Symbols and literal routes are search keys.

### Timeline variants (all persistent inputs, not one generic “timeline” test)

[api.ts](../../apps/studio/api.ts) and [clip-ops.ts](../../apps/studio/clip-ops.ts) currently write TSX. Each row must become a `timeline.edit` semantic operation with stable clip/artboard identity, dependency checks, one action and effect-aware inverse. Owners T16/T17/T26; **A,S,P,F** apply to every row; **B** additionally applies to source/media changes.

| ID | Route → function | Concrete operation variants |
|---|---|---|
| V01 | `/_api/retime-sequence` → `retimeSequenceOp` | `retimeSequence` and `retimeSequenceByClip`; timing/duration |
| V02 | `/_api/remove-sequence` → `removeSequenceOp` | `removeClip`, `removeClipRippled`; ordinary and ripple removal |
| V03 | `/_api/insert-sequence` → `insertSequenceOp` | `insertClip`, `insertClipAt`; placeholder/media/text insertion |
| V04 | `/_api/reorder-sequence` → `reorderSequenceOp` | `reorderClip`, `seriesMove`; stable target and sequence ordering |
| V05 | `/_api/toggle-hide` → `toggleHideOp` | `toggleClipHidden` |
| V06 | `/_api/edit-array-src` → `editArraySrcOp` | `editArrayElementString`; declared media dependency |
| V07 | `/_api/clip-edit` → `clipEditOp` → `applyOnDisk` | `speed`→`applySetPlaybackRate`; `trim-in`→`applyTrimIn`; `audio`→`applyClipAudio`; `detach-audio`→`applyDetachAudio` |
| V08 | Same `clipEditOp` switch | `framing`→`applyClipFraming`; `grade`→`applyClipGrade`; `transition`→`applyEditTransition`; `split`→`applySplitClip` |
| V09 | Same `clipEditOp` switch | `insert-transition`→`applyInsertTransition`; `remove-transition`→`applyRemoveTransition`; `set-text`→`applySetClipText` |
| V10 | Same `clipEditOp` switch | `to-overlay`→`applyMoveClipToOverlay`; `to-storyline`→`applyMoveClipToStoryline`; `layer-order`→`applyReorderOverlayLayer`; `resolve-placeholder`→`applyResolvePlaceholder` |

`/_api/comp-clips` → `compClips`, `/_api/edit-scope` → `editScopeOp` and `/_api/component-map` → `componentMapOp` are **reads**, despite their proximity to mutators. `timelineMediaSave` is a derived thumbnail/waveform cache, not clip history.

## Direct source helpers and alternate invocation

These functions are mutation sinks independently of the studio HTTP call path. A route-only adapter leaves a bypass when the CLI or a module imports them. [canvas-edit.ts](../../apps/studio/canvas-edit.ts) uses `withLock`, validates supported edits, and writes a temporary file followed by rename; neither lock nor rename is the future revision boundary.

| ID | Concrete functions / caller | Future owner and tripwire |
|---|---|---|
| D01 | `canvas-edit.ts`: `editAttribute`, `removeAttribute`, `editText` | T15/T24; A,S,F through direct invocation as well as S01–S03 |
| D02 | `moveElement`, `deleteElement`, `insertElement`, `insertElementIntoArtboard`, `duplicateElement`, `convertToAbsolute`, `detachComponent` | T25; A,S,M,F for direct calls |
| D03 | `resizeArtboard`, `setArtboardHug`, `setArtboardStyle`, `setArtboardKind`, `deleteArtboard`, `insertArtboard`, `duplicateArtboard`; `setArtboardGuides`, `setArtboardPrint` used by S17 | T25; A,S,M,F; metadata cannot be an independent second commit |
| D04 | `retimeSequence`, `retimeSequenceByClip`, `removeClip`, `reorderClip`, `toggleClipHidden`, `insertClip`, `editArrayElementString` | T26; A,S,P,F for direct calls |
| D05 | `clip-ops.ts`: `removeClipRippled`, `seriesMove`, `insertClipAt`, `applyOnDisk` (the disk wrapper for pure `apply*` variants, including exported `applyEnsureVideoComp` and `applyFitTotalToContent` when invoked by an agent) | T26; A,S,P,F; arbitrary callback must not become a network operation |
| D06 | [canvas-header.ts](../../apps/studio/canvas-header.ts): `applyHeader` writes generated canvas header; [bin/canvas-edit.sh](../../apps/studio/bin/canvas-edit.sh) invokes `canvas-edit.ts --invoke` for direct attribute edits | T16/T25; source mutation requires the same base/action even when described as normalization |
| D07 | [commands/edit-source-command.ts](../../apps/studio/commands/edit-source-command.ts): `createEditSourceCommand` / `buildEditSourceRecord`; [client/app.jsx](../../apps/studio/client/app.jsx) applies commands over HTTP and bridges iframe messages | T24/T28; P plus retained rejected stack entry; frontend command record is not durable server provenance |

## AI, CLI, imports, setup and user-controlled output

ACP advertises `fs.readTextFile:false` / `fs.writeTextFile:false` in [acp/bridge.ts](../../apps/studio/acp/bridge.ts); the external agent/adapter still executes its own file tools and commands. `requestPermission`, `newSessionParams`, and [acp/write-scope.ts](../../apps/studio/acp/write-scope.ts) constrain tools/paths, **not project transaction acceptance**. An approved Bash command can write many files; do not invent a finite allowlist of shell executables that supposedly solves this.

| ID | Actual entry and landing behavior | Planned boundary; owner / tests |
|---|---|---|
| I01 | ACP `requestPermission` + external Write/Edit/MultiEdit/NotebookEdit/shell tools; agent sessions launched through `newSessionParams` | Explicit begin/propose/commit candidate action, instrumented base receipt, dependency set and isolated candidate workspace; T16; A,S,M,F. Missing/unproven base retains candidate. |
| I02 | `/_api/ai/start`, `/_api/ai/heartbeat`, `/_api/ai/end` → activity signal | Ephemeral activity only; never infer an accepted edit or atomic action from an idle/end signal; T16/T29; E |
| I03 | [bin/annotate.mjs](../../apps/studio/bin/annotate.mjs): `main`/`applyOps`, `applyMove`, `applySetText`, `applySetColor`; PUT `/_api/annotations`, then direct `writeFileSync(svgPath, merged)` fallback on server failure | Same annotation proposal; fallback must retain a candidate rather than bypass acceptance; T16/T26; A,P,F |
| I04 | [bin/_import-figma.mjs](../../apps/studio/bin/_import-figma.mjs): `importBoard`, `importPages`, `importFrames`, `explodeArtboard`, `importTokens`, `resolveArchiveAssets`; staged TSX/meta/SVG/assets/annotations moved into project | One import/explode action with explicit file set, blob staging and source validation; T16/T18/T25; A,S,M,B,F |
| I05 | [figma/endpoints.ts](../../apps/studio/figma/endpoints.ts): `createFigmaEndpoints`, HTTP `/_api/figma/import`, `/_api/figma/explode` | Invokes I04; identical transaction semantics for UI and CLI; T16; A,S,M,B,F |
| I06 | [bin/_import-tokens.mjs](../../apps/studio/bin/_import-tokens.mjs): `importTokens`, `atomicWrite`; writes token CSS, design-system scaffold and config | `manifest.create` / replacement + `config.assign`; one token import action; T16/T20; A,S,M,F |
| I07 | [bin/_import-brand.mjs](../../apps/studio/bin/_import-brand.mjs): `importBrand`; logo asset writes, palette/font extraction | Blob + explicit support/config assignments; T16/T18/T20; A,B,M,F |
| I08 | [bin/_import-asset.mjs](../../apps/studio/bin/_import-asset.mjs): `writeContainedAsset`, `importSvg`, `importSvgBatch`, `importPdf`, `importRaster` | Immutable blob staging followed by accepted manifest reference; T18; A,B,F |
| I09 | [bin/_fetch-asset.mjs](../../apps/studio/bin/_fetch-asset.mjs): `fetchAsset` temp download/rename, including caller-selected output | Same B boundary for admitted project output; non-project output remains local export; T18/T20; B,F |
| I10 | [bin/_ingest-footage.mjs](../../apps/studio/bin/_ingest-footage.mjs): `ingestFootage` uses `copyFileSync` into content-addressed assets | Resumable staged uploads, one import action, durable refs; T16/T18; A,M,B,F |
| I11 | [bin/_transcribe.mjs](../../apps/studio/bin/_transcribe.mjs): SRT/VTT `writeFileSync`; `photo-adjust.sh`, `photo-bg-remove.sh`, `generate.sh` call live HTTP/canvas helpers | Caption replacement and photo/generation actions through S25/S29/S30, preserving source asset dependencies; T16/T18/T26; A,B,P,F |
| I12 | [scaffold-design.ts](../../apps/studio/scaffold-design.ts): config + starter TSX/meta + directories; HTTP `/_api/design/init`, `/_api/project/create-local`, `/_api/github/create-project` | Initial manifest transaction for managed project; local-only creation remains local until explicit admission; T17/T19/T21; A,M,F |
| I13 | [cli/commands/design.mjs](../../cli/commands/design.mjs): design init copy plan/force writes templates and DS preview/config through `writeFile`; [cli/lib/design-link.mjs](../../cli/lib/design-link.mjs), [design-ownership.mjs](../../cli/lib/design-ownership.mjs) edit project configuration | Separate public config from local link/trust policy; managed content changes need `config.assign`/manifest action; T16/T20/T21; A,M,E,F |
| I14 | `draw-build.sh` executes authored Bun script; output-selectable export helpers `_html-playwright.mjs`, `_pdf-playwright.mjs`, `_pptx-playwright.mjs`, `_svg-playwright.mjs`, `_video-playwright.mjs`, `to-lottie.sh`, CLI design export write outputs | Local export is not a project mutation until its destination is an eligible managed path. Admit that write via I01/external candidate import, then B/S; T15/T16/T18; A,S,B,F |
| I15 | [plugins/design/commands/rollback.md](../../plugins/design/commands/rollback.md) step 7 instructs `cp <chosen-snapshot> <canvas-file>` directly | Replace with explicit restore proposal in managed mode; shell copy otherwise enters X01 as an unproven candidate. T16/T27/T30; A,S,P,F |

No arbitrary external script has a provable base merely because it runs inside ACP or `maude design`. The instrumented helper interface and treatment of unrestricted shell/external saves remain required T16/T15 work.

## Disk import, room transport and projection authorities

| ID | Actual entry / sink | Target authority and owner; tripwires |
|---|---|---|
| X01 | [sync/fs-mirror.ts](../../apps/studio/sync/fs-mirror.ts): `createFsReader`; ordinary save and atomic rename events → [projection.ts](../../apps/studio/sync/projection.ts): `applyFromFs` | Candidate import with durable proven-base receipt, or explicit unresolved conflict. T15; A,S,P,F; stale editor buffer and process restart |
| X02 | [sync/agent.ts](../../apps/studio/sync/agent.ts): `createCanvasSyncAgent`, `applyFromFs`, `reconcile`, `flush`, `writeHtmlIfChanged`, `writeCommentsIfChanged`, `writeAnnotationsIfChanged`, `writeMetaIfChanged`, `writeCssIfChanged` | Legacy two-document writer retired/fenced; accepted projector or candidate importer, never both roles from origin guesses. T14/T15/T30/T34; F,R,E |
| X03 | [sync/projection.ts](../../apps/studio/sync/projection.ts): `writeAndAnnounce`, `writeHtmlIfChanged`, `writeCssIfChanged`, `writeMetaIfChanged`, `flush`, `reconcile` | One fenced accepted snapshot projector. Current source guard is process-local containment only. T14; F,R; partial multi-file projection invisible |
| X04 | [collab/persistence.ts](../../apps/studio/collab/persistence.ts): `seed`, `persistJson`, `persistBinary`; local `_state/*.ydoc` read/write | Accepted replica cache/projector; binary cannot become authority after restore. T12/T14/T30; F,R |
| X05 | `persistJson` → `api.saveCommentsForFile`, `api.projectAnnotations`; latter uses temp write + after-IO freshness check + rename without publication hook | Disk-only sink under projector fence; no second author/action from projection. T14/T26; F,R,P |
| X06 | `api.publishComments` → `onCommentsChanged` before `saveCommentsForFile`; [collab/registry.ts](../../apps/studio/collab/registry.ts): `syncRoomFromComments`, `syncRoomFromAnnotations` | Future accepted replayer alone updates shared maps; UI paths propose operations. T12/T17; A,F,P |
| X07 | [ws.ts](../../apps/studio/ws.ts) `/_ws/collab/:slug` → [collab/room.ts](../../apps/studio/collab/room.ts): `receive`, `receiveGated` → [protocol.ts](../../apps/studio/collab/protocol.ts): `handleMessage` | Reject raw persistent Update/SyncStep2 before public mutation, main/canvas/readOnly/loopback clients included; awareness remains separately bounded. T7/T12; F,E |
| X08 | [use-collab.tsx](../../apps/studio/use-collab.tsx): browser local Y.Doc and transport; shared-doc link in [sync/index.ts](../../apps/studio/sync/index.ts); [sync/loopback.ts](../../apps/studio/sync/loopback.ts) | Separate optimistic candidate replica from accepted replica; U2 depending on rejected U1 cannot replay raw bytes. T7/T12/T13; A,F,P |
| X09 | [sync/codec.ts](../../apps/studio/sync/codec.ts): `applyHtmlToDoc`, `applyCssToDoc`, `applyCommentsToDoc`, `applyAnnotationsToDoc`, `applyMetaToDoc`, `repairSharedMeta`, `stampBodyEdit`, `stampAnnotationsEdit`, `markSeeded`, `stampCanvasPath`, `stampMovedTo`, `clearMovedTo` | Internal accepted replayer/one-time fenced migration only. Path and movedTo are currently document metadata, not manifest identity. T12/T14/T17/T30; F,R,E |
| X10 | `sync/index.ts`: `retireForMove`, `onRetirementSeen`, `applyTombstones`, `noteToHub`; [tombstone-apply.ts](../../apps/studio/sync/tombstone-apply.ts): `quarantineCanvas` | Accepted generation retirement + projector. Current local trash and best-effort remote statement are not durable action ACK. T13/T17; A,M,F,R |
| X11 | [sync/file-plane.ts](../../apps/studio/sync/file-plane.ts): `push`, `pushDelete`, `materialize`, `parkLocal`, `quarantineLocal`, `applyOne`, `reconcile` | Blob staging + manifest proposal; materialization only by fenced projector. Current per-file CAS/journal does not group dependencies. T14/T18/T20; A,M,B,F,R |
| X12 | [sync/file-pull.ts](../../apps/studio/sync/file-pull.ts) temp write/rename; [sync/asset-push.ts](../../apps/studio/sync/asset-push.ts) uploads; [sync/file-ledger.ts](../../apps/studio/sync/file-ledger.ts) persistent receipts | Transfer/cache layer, not project head. T13/T18/T20; B,F,R; restart cannot falsely advance durable-save status |
| X13 | [sync/migrate-seed.ts](../../apps/studio/sync/migrate-seed.ts): `migrateSeed`; [seed-repair.ts](../../apps/studio/sync/seed-repair.ts): `rememberSeed`, `repairSeedDuplication`; agent duplicate collapse | Explicit fenced migration or repair from accepted state, no live accepted mutation based on heuristics. T30/T34; F,R |
| X14 | [sync/cold-start-apply.ts](../../apps/studio/sync/cold-start-apply.ts): `applyColdStart`; [sync/migrate-flat-fallback.ts](../../apps/studio/sync/migrate-flat-fallback.ts); [source-recovery.ts](../../apps/studio/sync/source-recovery.ts) retained source writes | Recovery must distinguish candidate bytes from accepted serving snapshot; preserve both, do not silently promote a candidate. T14/T15/T30; S,F,R |
| X15 | [history.ts](../../apps/studio/history.ts): `rollback` directly writes snapshot bytes; [sync/trash.ts](../../apps/studio/sync/trash.ts): `restoreFromTrash`; POST `/_api/sync/trash` | `history.restore` / manifest recreation as new action; current path generation resolved explicitly. T27/T28/T30; A,M,P,F |
| X16 | POST `/_api/sync/resync`, settings-induced sync restart and runtime reconciliation | Rebuild accepted cache and retry retained proposals; not silent conflict resolution. T13/T19/T30; F,R |

The current content-hash echo guards, annotation `writeId`, room origins, local file locks and journal sequences have different purposes. None is an authenticated effect identity or a durable project acceptance record.

## Git, hub and cloud

| ID | Actual mutation / storage entry | Target boundary and owner; tripwires |
|---|---|---|
| H01 | [hub/src/server.mjs](../../apps/hub/src/server.mjs): Hocuspocus document transport + SQLite extension; `afterStoreDocument` calls workspace agent | Gateway accepts validated proposals before publication; store hook is too late to prevent a public CRDT update. T7/T8/T11/T12; A,F,R |
| H02 | [hub/src/documents.mjs](../../apps/hub/src/documents.mjs): `handleDocumentItemRoute`, DELETE/POST `/api/documents/:name` → `deleteDocument`, `deleteDocumentRow`, `recordTombstone` / `clearTombstone` in [tombstones.mjs](../../apps/hub/src/tombstones.mjs) | Manifest generation delete/recreate with durable idempotency, not clearing a path tombstone as permission to replay old edits. T17; A,M,F,R |
| H03 | [hub/src/file-door.mjs](../../apps/hub/src/file-door.mjs): PUT/DELETE `/api/file/:rel`, `handleFileDoor`, `handleDelete`, `streamAndHash`, `quarantineForDelete`; legacy PUT `/assets/:key` and `/_asset-file/:rel` delegate here | Blob-ready plus manifest proposal under role, base and generation checks; per-path lock/CAS is not multi-file commit. T18/T20; A,M,B,F |
| H04 | [hub/src/workspace-agent.mjs](../../apps/hub/src/workspace-agent.mjs): `onDocumentStored`, source/sidecar materialization, move/quarantine and autocommit; [workspace-files.mjs](../../apps/hub/src/workspace-files.mjs) selects lanes | Single fenced projector from accepted manifest; accepted effect provenance drives authorship. T14/T27; F,R; competing process and crash between lanes |
| H05 | [hub/src/journal.mjs](../../apps/hub/src/journal.mjs): `openJournal`/handle append/observe/tombstone operations, `walkImport`, POST `/api/journal/report`, `createJournalTail`, `replayTailFromTarget` | Disk reports are candidates; future accepted journal derives from coordinator commit. Tail replication/replay is not durable ACK by itself. T8/T11/T14/T30; A,F,R |
| H06 | [hub/src/asset-lane.mjs](../../apps/hub/src/asset-lane.mjs): `createWriteBehind`, `hydrateAssets`, `hydrateFiles`; journal-driven S3 put/delete and checkout refill | Immutable blob store/verified accepted projection; rehydration cannot overwrite pending work or revive deletion. T8/T18/T30; B,F,R |
| H07 | [hub/src/backup.mjs](../../apps/hub/src/backup.mjs) SQLite snapshot/manifest upload + restore writes; [repo-checkpoint.mjs](../../apps/hub/src/repo-checkpoint.mjs): `bundleRepo`, `restoreRepo` | Disaster recovery layer distinct from acceptance storage; restore head/epoch and fence old writers before serving. T8/T11/T30/T32; F,R |
| H08 | [studio/sync/autocommit.ts](../../apps/studio/sync/autocommit.ts): `createAutoCommit`; hub and desktop call it | Git export of accepted actions only; editor attribution from retained effects, not last socket or debounce. T27; A,F,R |
| H09 | [studio/git/service.ts](../../apps/studio/git/service.ts): `gitDiscard`, `gitCheckout`, `gitFoldDraft`, `gitPull`, `gitResolve` (including conflict-copy writes); HTTP `/_api/git/discard`, `/checkout`, `/fold`, `/pull`, `/resolve` | Managed checkout cannot become a second authority; import explicit Git action/candidate or disallow on managed accepted view. T14/T15/T27/T30; A,S,M,F,R. **Disallowed in accepted mode** (T34): `git/accepted-guard.ts` answers 409 `accepted-project` pointing at History → Restore; `test/git-accepted-guard.test.ts` |
| H10 | `gitCommit`, `gitCreateBranch`, `gitPush`, `gitFetchRemote`; HTTP git `/commit`, `/branch`, `/push`, `/fetch`; `gitClone` through GitHub setup routes | Git graph/network or initial checkout operations, not new accepted revisions by implication. T21/T27/T30; F,R; commit cannot claim pending content accepted |
| H11 | [hub/src/design-sync.mjs](../../apps/hub/src/design-sync.mjs): `runDesignSync`; [cell-ops.mjs](../../apps/hub/src/cell-ops.mjs): `scheduleMirror`; [cloud/design-sync.mjs](../../apps/cloud/design-sync.mjs) builds steps | Outbound Git mirror/export of accepted state; any checkout manipulation fenced from live serving. T14/T27/T30; F,R |
| H12 | [cloud/project-routes.mjs](../../apps/cloud/project-routes.mjs): `handleProjectRoutes` `/projects/:id/people`, invitation/member role/removal writes to D1; `member_revocations`; [hub/src/cell-ops.mjs](../../apps/hub/src/cell-ops.mjs): `scheduleRevocationSweep` | Control authority must reach every proposal and already-open socket. Current revocation write is best-effort, sweep/token expiry is not immediate per-write membership validation. T12/T20; F |
| H13 | Hub [auth-routes.mjs](../../apps/hub/src/auth-routes.mjs), [tokens.mjs](../../apps/hub/src/tokens.mjs), [users.mjs](../../apps/hub/src/users.mjs), [invites.mjs](../../apps/hub/src/invites.mjs), admin bootstrap/token/rotation/deletion/settings routes | Credential/membership control, no project body writes. Keep secrets outside manifest; project gateway resolves current authenticated actor/capabilities. T12/T20; F,E |
| H14 | [cells/worker.mjs](../../apps/cells/worker.mjs), [cell-do.mjs](../../apps/cells/cell-do.mjs): `routeToCell`, DO `fetch`, tenant identity storage, container/tunnel proxy | Today content requests reach the hub container; existing DO storage is not a project accepted revision store. T8/T10/T12 must add and prove that authority. A,F,R and cross-tenant isolation |

[hub/src/history.mjs](../../apps/hub/src/history.mjs) currently exposes log/file **reads** (`handleHistoryRoutes`, `handleLog`, `handleFile`), not a server history-restore mutation. The future restore API must not be described as already present.

## Persistent local state deliberately excluded from project actions

The following concrete writes were inspected to avoid turning every disk write into shared content. **E** applies to each row. If a future feature changes one into shared product data, it needs a declared operation and taxonomy/classifier change first.

| Writer | Local-only purpose / boundary |
|---|---|
| `api.saveCanvasView`, `saveCanvasOverlays`, camera/locked migration inside `patchCanvasMeta`, `saveCanvasState`; `inspect.ts` active-state save | Per-user camera, visibility/selection/editor state; `_canvas-state`, `_active` |
| `api.timelineMediaSave`, `client/panels/timeline-media-cache.js` | Derived image strips/audio peaks under runtime storage |
| `api.saveChatAttachment`, `acp/transcript.ts`, `transcript-io.ts`, `bridge.ts` session store | ACP chat/history/attachment runtime; moving an attachment into canvas content requires a separate asset action |
| `collab/room.ts:setAgentEditing`, `collab/ai-activity.ts`, `use-artboard-drag.tsx` awareness, `cursors-overlay.tsx` | Presence/gesture previews only, no saved history; actual layout commit uses S19 |
| `history.writeSnapshot`, `sync/source-recovery.ts` candidate backups, `_trash` quarantine, `sync/untrusted.ts` index | Local recovery/support evidence; not permission to overwrite accepted content |
| `sync/file-ledger.ts`, `sync/journal.ts`, `_sync.json`/`_state` writes in `sync/index.ts`, `locator.ts`, server info | Local receipts, cache and process discovery; saved labels must use actual authoritative receipts |
| `sync/hub-link.ts`, `sync/settings.ts`, cloud endpoint credentials/attach/detach, `sync/index.ts` config cleanup, CLI hubs config and design ownership | Link/trust/local credentials must be excluded from any shared configuration projection even when physically stored beside public config |
| `generation/keys.ts`, `ui-prefs.ts`, GitHub identity cache, provider model downloads | Secrets, user preference/cache, local tool/model installation |
| `exporters/jobs.ts` history/job outputs, `generation/jobs.ts` job history, report/debug/shell-shot endpoints, `handoff.ts` | Runtime output/metadata; generated content goes through S29 separately; eligible user-selected output follows I14 |
| `build.ts`, `_ensure-browser.mjs`, ACP login/bootstrap, CLI harness/cache/preflight/install, `bin/scenario-report.mjs`, test fixture helpers | Tooling/install/test state; no canonical project content authority |

Cloud accounts/billing/provisioning/reconcile/purge tables are control-plane lifecycle data, not editor action history. Destructive project lifecycle must fence/revoke the project epoch before deletion/restore (T20/T30/T32); this registry does not claim a complete billing/auth security review.

## Coverage evidence and remaining T6 gates

The inventory was built by reading route dispatch and API bodies, searching concrete disk sinks (`Bun.write`, write/copy/rename helpers, streams), tracing Yjs mutation roots and classifying Git/restore/CLI subprocess writers. It explicitly covers all twelve persistent-input categories in the plan, all fifteen current `clipEditOp` verbs, and the API/source-helper alternate invocation paths listed above. Pure source transforms are not separate writers until called through a disk or accepted-state wrapper.

Knowledge lookup: `kg search 'project transactions multiplayer writer'` returned the full-plan records `d_b0962418966f4c04843393a7` / `d_988d0aa65be5a7e1b98dd32d` and execution checkpoint `d_033665574c6bfd7d01572e76`. Those records locate history; this inventory's claims derive from current files, not search snippets or a deployment inspection.

Three of the reasons this section listed have since been answered, and the
answer to two of them was a design decision rather than more schema. Recorded
here because the open list is only useful if it is current — a stale blocker
reads exactly like a real one (it cost a later audit a verdict of "five
categories still lack adapter-grade schemas", which is no longer what is true).

1. ~~No executable operation registry.~~ **Answered.**
   `apps/studio/sync/writer-registry.ts` is that registry, and
   `apps/studio/test/sync-writer-registry.test.ts` is the gate this item asked
   for: every `/_api/*` route the studio serves must be classified or the test
   fails, no classified route may be stale, and every lane/structural writer
   must name both HOW its effect travels and a test file that exists and proves
   it. A new mutating route cannot ship unclassified.
2. ~~The operation union lacks supporting-file replacement, public project
   configuration, footage-analysis and EDL variants.~~ **Answered.** Supporting
   files replace, move and delete through the file plane (S27/S28) with
   referential refusal when a canvas still names one; the project's public
   configuration travels in the accepted bootstrap as a validated projection
   (`acceptedProjectConfig()` — names and contained relative paths only, never
   the file, which is a trust anchor); footage analysis and EDLs are derived
   sidecars on the file plane (S26), not canvas actions.
3. ~~Artboard guide/print payloads, every clip verb, photo reset/mask,
   annotation stroke operations and comment author permissions need complete
   protocol schemas.~~ **Answered by the accepted design, which does not need
   them.** DDR-241 carries a whole LANE, not a per-operation payload: every one
   of those writers is a `lane.replace` against an announced base (guides/print
   S17, clip verbs V07–V10, annotation strokes S23, comments S24) or a file-plane
   object (photo S25), each with its `via` and a proving test in the registry
   module. Identity is the document `entry` plus element print addressing
   (`docs/architecture/source-vocabulary.md`), not a per-operation id; the
   inverse is the effect-aware compensating action personal undo already
   builds, not a hand-written inverse rule per verb. Comment author permission
   is enforced on the author of the comment, with executed rows in both
   directions. A per-verb schema corpus would be a second, weaker source of
   truth for identity and inversion — the thing DDR-241 exists to avoid.

Still open, for specific and actionable reasons:

4. External shell/agent writers require a candidate workspace or instrumentation plus a durable base receipt. Static source scanning cannot enumerate arbitrary future shell programs; X01/I01 are the explicit ingress for those bytes, with unproven bases retained rather than inferred.
5. Public configuration and local link/trust settings share physical configuration files. An accepted manifest must project only the approved public schema. Literal whole-file config copying would leak/override local policy.
6. Hocuspocus/publication fencing, two actual durable storage adapters, finite sizes/dependency limits/idempotency horizon, crash windows and the browser→commit→desktop→personal-undo walkthrough remain separate T7/T8/T9 evidence. No current watcher, SQLite after-store hook or backup proves these.
7. This inventory was read against a live dirty worktree while independent implementation continues. It is not a frozen-source conformance run, a complete call-graph proof, or a live AWS/Cloudflare audit. T34 must re-run the registry/reachability gate against the final immutable build and every supported compatibility lane.
