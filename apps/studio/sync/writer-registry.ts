// The executable half of the persistent-writer registry — DDR-241, plan T6.
//
// `docs/architecture/project-writer-registry.md` explains every writer; this
// module is the part a test can hold the code to. Every `/_api/*` route the
// studio serves is classified here by HOW its persistent effect reaches the
// project in accepted-revisions mode. A route that is not listed fails
// `test/sync-writer-registry.test.ts` — a new mutating route cannot ship
// without someone deciding which lane carries it.
//
// Classes:
//   read        — no persistent project effect.
//   lane        — rewrites canvas source/meta/annotations/comments; reaches the
//                 project as a `lane.replace` proposal (watcher import with the
//                 base announced by `activity:suppress`, or an API hook that
//                 hands the runtime its base).
//   structural  — canvas/folder create, move, delete: one manifest action.
//   file-plane  — assets, media sidecars, support files: the file plane's own
//                 CAS journal (DDR-226), not the canvas kernel (DDR-241 §8).
//   git         — operates on the checkout's Git graph; never a project action.
//   local       — this machine only: credentials, caches, jobs, activity, UI.
//   migration   — a whole-project format rewrite (V2-1.12): all-or-nothing, after the
//                 hub's format flip; peers get the rewritten files like an outside edit.
//
// Every route in routes/*.ts (the V2-2.5 table) is listed here too: the test scrapes
// http.ts AND routes/*.ts, so a table route cannot ship unclassified either.

export type WriterClass =
  | 'read'
  | 'lane'
  | 'structural'
  | 'file-plane'
  | 'git'
  | 'local'
  | 'migration';

export interface WriterEntry {
  class: WriterClass;
  /** Registry row(s) in project-writer-registry.md. */
  rows?: string;
  /** How the effect travels in accepted mode (lane / structural only). */
  via?: string;
  /** The test that proves it (lane / structural only). */
  test?: string;
}

const LANE_SOURCE = {
  class: 'lane',
  via: 'source write announced by activity:suppress → watcher import → html lane.replace with the announced base',
  test: 'test/sync-accepted-projection.test.ts',
} as const;

export const WRITER_REGISTRY: Record<string, WriterEntry> = {
  // --- canvas source edits (S01–S18, V01–V10)
  '/_api/edit-text': { ...LANE_SOURCE, rows: 'S01' },
  '/_api/edit-css': { ...LANE_SOURCE, rows: 'S02' },
  '/_api/edit-attr': { ...LANE_SOURCE, rows: 'S03' },
  // S2.1 — the one dispatch route for S2/S3 structural edits (routes/edit.ts, edit-ops/)
  // S2.10b — in accepted mode an op with a layout part (a copy and its place, an artboard moved to the
  // trash) is ONE proposal: proposeLanes, html + meta (kind / label / origin.trashed from the op).
  '/_api/edit-op': {
    ...LANE_SOURCE,
    rows: 'S2-ops',
    via: 'an op that places or removes artboards: proposeLanes → one action, html + meta lane.replace with the read bases, written raw after acceptance; any other op: the source write path',
    test: 'test/v2-artboard-one-step-hub.test.ts',
  },
  '/_api/reorder': { ...LANE_SOURCE, rows: 'S04' },
  '/_api/delete-element': { ...LANE_SOURCE, rows: 'S05' },
  '/_api/insert-element': { ...LANE_SOURCE, rows: 'S06' },
  '/_api/duplicate-element': { ...LANE_SOURCE, rows: 'S07' },
  '/_api/convert-to-absolute': { ...LANE_SOURCE, rows: 'S08' },
  '/_api/detach-component': { ...LANE_SOURCE, rows: 'S09' },
  '/_api/insert-artboard': { ...LANE_SOURCE, rows: 'S10' },
  '/_api/duplicate-artboard': { ...LANE_SOURCE, rows: 'S11' },
  '/_api/delete-artboard': { ...LANE_SOURCE, rows: 'S12' },
  '/_api/resize-artboard': { ...LANE_SOURCE, rows: 'S13' },
  '/_api/set-artboard-hug': { ...LANE_SOURCE, rows: 'S14' },
  '/_api/set-artboard-style': { ...LANE_SOURCE, rows: 'S15' },
  '/_api/set-artboard-kind': { ...LANE_SOURCE, rows: 'S16' },
  '/_api/set-artboard-label': { ...LANE_SOURCE, rows: 'S16' },
  '/_api/set-artboard-guides': { ...LANE_SOURCE, rows: 'S17' },
  '/_api/set-artboard-print': { ...LANE_SOURCE, rows: 'S17' },
  '/_api/reorder-revert': { ...LANE_SOURCE, rows: 'S18' },
  '/_api/retime-sequence': { ...LANE_SOURCE, rows: 'V01' },
  '/_api/remove-sequence': { ...LANE_SOURCE, rows: 'V02' },
  '/_api/insert-sequence': { ...LANE_SOURCE, rows: 'V03' },
  '/_api/reorder-sequence': { ...LANE_SOURCE, rows: 'V04' },
  '/_api/toggle-hide': { ...LANE_SOURCE, rows: 'V05' },
  '/_api/edit-array-src': { ...LANE_SOURCE, rows: 'V06' },
  '/_api/clip-edit': { ...LANE_SOURCE, rows: 'V07–V10' },
  // --- shared meta, annotations, comments (S19, S23, S24)
  // S9.7b — the comment door: one comments/ops.ts op as the session.
  '/_api/comments/op': {
    class: 'lane',
    rows: 'S24',
    via: 'api.commentOp → publishComments (onCommentsChanged, doc first) → comments lane',
    test: 'test/comments-op-route.test.ts',
  },
  '/_api/canvas-meta': {
    class: 'lane',
    rows: 'S19',
    // S2.9b — a PATCH with an `annotations` rider is ONE action: proposeLanes, meta + annotations.
    via: 'onMetaChanged hook → meta lane.replace with the replaced file as base; camera/overlays/locked stay local; with an annotations rider → proposeLanes, meta + annotations as one action',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/annotations': {
    class: 'lane',
    rows: 'S23',
    via: 'onAnnotationsChanged hook → annotations lane.replace with the base the layer sent',
    test: 'test/sync-accepted-projection.test.ts',
  },
  // DDR-242 §4 — the canvas's op batches. Same lane, same hook: the api applies
  // the ops to the board, then fires onAnnotationsChanged with the pre-batch
  // board as base (the kernel's `annotations.apply` replaces this in Task 12).
  '/_api/annotations/ops': {
    class: 'lane',
    rows: 'S23',
    via: 'onAnnotationsChanged hook → annotations lane.replace with the pre-batch board as base',
    test: 'test/sync-accepted-projection.test.ts',
  },
  // S4.7 — sticky ↔ comment: ONE action carrying the board and the thread list of one canvas
  // (contract S4-S9-votes-comments §3.2), so one undo restores both.
  '/_api/annotations/to-comment': {
    class: 'lane',
    rows: 'S23',
    via: 'proposeLanes → one action, annotations + comments lane.replace with the read bases',
    test: 'test/annotations-convert.test.ts',
  },
  '/_api/comments/to-sticky': {
    class: 'lane',
    rows: 'S23',
    via: 'proposeLanes → one action, comments + annotations lane.replace with the read bases',
    test: 'test/annotations-convert.test.ts',
  },
  // S4.14 — formal votes (routes/votes.ts). Local: the vote + your ballot element are board ops;
  // hub: the board gets the vote element (start) and its counts + the result section (end) only.
  '/_api/votes': { class: 'read' }, // the canvas's votes + the session's own picks
  '/_api/votes/start': {
    class: 'lane',
    rows: 'S23',
    via: 'api.applyAnnotationOps → onAnnotationsChanged hook → annotations lane.replace (the vote element)',
    test: 'test/votes-local.test.ts',
  },
  '/_api/votes/ballot': {
    class: 'lane',
    rows: 'S23',
    via: 'local: api.applyAnnotationOps (your ballot element) → annotations lane; hub: nothing on the board',
    test: 'test/votes-cloud-client.test.ts',
  },
  '/_api/votes/end': {
    class: 'lane',
    rows: 'S23',
    via: 'api.applyAnnotationOps → annotations lane (the counts + the result section)',
    test: 'test/votes-local.test.ts',
  },
  // No op log (a legacy link): the conversion's in-memory undo token puts both files back.
  '/_api/annotations/convert-undo': {
    class: 'lane',
    rows: 'S23',
    via: 'legacy only — both files written back through the comments/annotations hooks',
    test: 'test/annotations-convert.test.ts',
  },
  // --- accepted history (T27/T28)
  '/_api/project/history': { class: 'read' },
  '/_api/links': { class: 'read' }, // S3.10a routes/element-links.ts: where on-click links go, parsed from the TSX
  '/_api/project/restore': {
    class: 'lane',
    rows: 'X15',
    via: 'history.restore — a NEW action restoring the canvas lanes (not comments) to a revision',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/project/conflict': {
    class: 'lane',
    rows: 'X15',
    via: 'mine: html lane.replace on top of the accepted version (a new action); theirs: accepted body back to disk',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/project/ai-action': {
    class: 'lane',
    rows: 'I02',
    via: 'publish: the held AI stage as ONE history action (lane.replace ops); discard: accepted value back to disk',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/project/undo': {
    class: 'lane',
    rows: 'S18',
    via: 'history.undo/redo — effect-aware compensation of this actor’s actions: one id, several (actionIds), or a chat (S5.5)',
    test: 'test/project-undo-routes.test.ts',
  },
  '/_api/project/undo-stack': { class: 'read' },
  // S11.6 — the structured canvas errors (routes/canvas-source.ts, with /_api/canvas-source)
  '/_api/canvas-errors': { class: 'read' },
  // S1.12b routes/history.ts — Version history (V2-1.9 §5.11)
  '/_api/project/versions': { class: 'read' },
  '/_api/project/changes': { class: 'read' },
  '/_api/project/object-history': { class: 'read' },
  '/_api/project/source': { class: 'read' },
  '/_api/project/name': {
    class: 'structural',
    via: 'history.name { doc, revision, name|null } — one `name` action, an @name effect + names row, no head moves',
    test: 'test/history-routes-access.test.ts',
  },
  '/_api/project/aside': {
    class: 'structural',
    via: 'history.aside { doc, lane, content, label? } — one `aside` action, the body as an @aside blob, no head moves',
    test: 'test/history-routes-access.test.ts',
  },
  // S1.7 routes/trash.ts — the shared Trash over the one op log (S1-trash.md)
  '/_api/trash': { class: 'read' },
  '/_api/trash/restore': {
    class: 'structural',
    via: 'trash.restore { entry } — the canvas comes back with the same entry, in place or at "<name> 2"',
    test: 'test/trash-derive.test.ts',
  },
  '/_api/trash/clear': {
    class: 'structural',
    via: 'trash.clear { items? } — owner-only clear-out: @trash effects + trash_cleared rows, no head moves',
    test: 'test/acl-l18-trash.test.ts',
  },
  // S10.3 routes/ds.ts — a converted design system's reviews (V2-1.6 §5.11–§5.12)
  '/_api/ds/state': { class: 'read' },
  '/_api/ds/revision': { class: 'read' },
  '/_api/ds/revisions': { class: 'read' },
  '/_api/ds/usage': { class: 'read' },
  '/_api/ds/publish': {
    class: 'lane',
    via: 'ONE kernel action (proposeFiles: meta/TSX lane.replace ops) for the Plane-A half; revisions, working files and head.json ride the file plane, head.json last (ds/engine.ts, S10.2)',
    test: 'test/ds-publish.test.ts',
  },
  '/_api/ds/pending': {
    class: 'lane',
    via: 'the DS canvas meta (dsPending) as ONE kernel action (proposeFiles)',
    test: 'test/ds-routes-roles.test.ts',
  },
  '/_api/ds/outside': {
    class: 'file-plane',
    rows: 'keep: a revision + head.json base; undo: the working files from base — Plane B only',
  },
  '/_api/ds/pick': {
    class: 'lane',
    via: 'the pending entry dropped from the DS canvas meta (proposeFiles) + head.json base = K',
    test: 'test/ds-conflict-pick.test.ts',
  },
  '/_api/ds/canvas': {
    class: 'lane',
    via: 'a canvas meta dsRev (+ its data-ds-rev="head" strips) as ONE kernel action (proposeFiles)',
    test: 'test/ds-undo-hook.test.ts',
  },
  '/_api/ds/trash': {
    class: 'lane',
    via: 'ONE kernel action (proposeFiles: meta/TSX lane.replace ops) for the Plane-A half; revisions, working files and head.json ride the file plane, head.json last (ds/engine.ts, S10.2)',
    test: 'test/ds-trash-token.test.ts',
  },
  '/_api/ds/restore': {
    class: 'lane',
    via: 'ONE kernel action (proposeFiles: meta/TSX lane.replace ops) for the Plane-A half; revisions, working files and head.json ride the file plane, head.json last (ds/engine.ts, S10.2)',
    test: 'test/ds-trash-token.test.ts',
  },
  '/_api/ds/clear': {
    class: 'lane',
    via: 'ONE kernel action (proposeFiles: meta/TSX lane.replace ops) for the Plane-A half; revisions, working files and head.json ride the file plane, head.json last (ds/engine.ts, S10.2)',
    test: 'test/ds-trash-token.test.ts',
  },
  // S1.18 — a stable canvas link's entry → path (history/links.ts)
  '/_api/link/resolve': { class: 'read' },
  // --- manifest (S20–S22)
  '/_api/canvas': {
    class: 'structural',
    rows: 'S20',
    via: 'create: cold start doc.create; delete: canvas-deleted → doc.delete; folders: dir.delete',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/fs-move': {
    class: 'structural',
    rows: 'S21',
    via: 'retireForMove → doc.move; folders: proposeFolder dir.move',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/fs-mkdir': {
    class: 'structural',
    rows: 'S22',
    via: 'proposeFolder dir.create before mkdir',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/design/init': {
    class: 'structural',
    rows: 'I12',
    via: 'scaffolded canvases join by cold start doc.create',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  // --- file plane (S25–S30, I04–I11)
  '/_api/photo-edit': { class: 'file-plane', rows: 'S25' },
  '/_api/footage': { class: 'file-plane', rows: 'S26' },
  '/_api/asset': { class: 'file-plane', rows: 'S27' },
  // Issue #126 — chunks stay in this machine's `_state/asset-chunks/` scratch;
  // only the reassembled asset written by chunk-finish joins the file plane.
  '/_api/asset/chunk-start': { class: 'local' },
  '/_api/asset/chunk': { class: 'local' },
  '/_api/asset/chunk-finish': { class: 'file-plane', rows: 'S27' },
  '/_api/assets': { class: 'file-plane', rows: 'S27' },
  '/_api/import-asset': { class: 'file-plane', rows: 'S28/I08' },
  '/_api/import-brand': { class: 'file-plane', rows: 'S28/I07' },
  '/_api/figma/import': { class: 'file-plane', rows: 'I04/I05 (canvases join by cold start)' },
  '/_api/figma/explode': { class: 'file-plane', rows: 'I04/I05 (canvases join by cold start)' },
  '/_api/generate-jobs': { class: 'file-plane', rows: 'S29' },
  '/_api/generate/audio-reuse': { class: 'file-plane', rows: 'S30' },
  '/_api/stickers': { class: 'file-plane', rows: 'S27' },
  '/_api/generate/prefs': { class: 'local', rows: 'S31 (config.assign schema gap)' },
  // --- git (H09/H10)
  '/_api/git/branch': { class: 'git', rows: 'H10' },
  '/_api/git/branches': { class: 'read' },
  '/_api/git/checkout': { class: 'git', rows: 'H09' },
  '/_api/git/commit': { class: 'git', rows: 'H10' },
  '/_api/git/diff': { class: 'read' },
  '/_api/git/discard': { class: 'git', rows: 'H09' },
  '/_api/git/fetch': { class: 'git', rows: 'H10' },
  '/_api/git/fold': { class: 'git', rows: 'H09' },
  '/_api/git/log': { class: 'read' },
  '/_api/git/pull': { class: 'git', rows: 'H09' },
  '/_api/git/push': { class: 'git', rows: 'H10' },
  '/_api/git/resolve': { class: 'git', rows: 'H09' },
  '/_api/git/status': { class: 'read' },
  '/_api/github/clone': { class: 'git', rows: 'H10' },
  '/_api/github/create-project': { class: 'local', rows: 'I12' },
  '/_api/github/create-repo': { class: 'local' },
  '/_api/github/identity': { class: 'local' },
  '/_api/github/invite': { class: 'local' },
  '/_api/github/repos': { class: 'read' },
  '/_api/project/create-local': { class: 'local', rows: 'I12' },
  '/_api/projects/prepare': {
    class: 'local',
    rows: 'H13 (credential + project description for a managed copy)',
  },
  // --- reads
  '/_api/canvas-source': { class: 'read' },
  '/_api/comp-clips': { class: 'read' },
  '/_api/component-map': { class: 'read' },
  '/_api/edit-scope': { class: 'read' },
  '/_api/git-committers': { class: 'read' },
  '/_api/git-user': { class: 'read' },
  '/_api/preflight': { class: 'read' },
  '/_api/setup-readiness': { class: 'read' },
  '/_api/whats-new': { class: 'read' },
  '/_api/figma/probe': { class: 'read' },
  '/_api/figma/status': { class: 'read' },
  '/_api/generate/providers': { class: 'read' },
  '/_api/generate/audio-search': { class: 'read' },
  '/_api/export-history': { class: 'read' },
  '/_api/diagnostics': { class: 'read' }, // V2-2.9: this machine's logs, never written here
  '/_api/diagnostics/report': { class: 'read' },
  '/_api/index': { class: 'read' }, // V2-2.17: the in-memory index, persisted only to the user cache
  // V2-2.17: raises picture keys in this server's render queue; GET /_api/thumb/<key> (dynamic,
  // fetch-handled) reads the per-Mac picture cache — neither touches the project
  '/_api/thumbs/want': { class: 'local' },
  '/_api/ui/open': { class: 'local' }, // V2-2.4b `maude design open` → the shells (ws relay)
  '/_api/agent/run/begin': { class: 'local' }, // V2-2.4b the design plugin's hooks (V2-1.11 §5.4)
  '/_api/agent/edit/check': { class: 'local' }, // V2-2.4b the design plugin's hooks (V2-1.11 §5.4)
  '/_api/agent/check': { class: 'local' }, // V2-2.4b the design plugin's hooks (V2-1.11 §5.4)
  '/_api/agent/edit/touched': { class: 'local' }, // V2-2.4b the design plugin's hooks (V2-1.11 §5.4)
  '/_api/agent/run/end': { class: 'local' }, // V2-2.4b the design plugin's hooks (V2-1.11 §5.4)
  // --- this machine only
  '/_api/acp/activity': { class: 'local' },
  '/_api/acp/attachment': { class: 'local' },
  '/_api/acp/chat': { class: 'local' },
  '/_api/acp/chats': { class: 'local' },
  // S5.7 routes/chat.ts: chats are per Mac (`_chat/`, DDR-115) - search, Move to trash (a `trashedAt` in the
  // chat's own sidecar), Restore, Clear out, and the session id Open in terminal resumes
  '/_api/acp/chat/session': { class: 'local' },
  '/_api/acp/chats/clear': { class: 'local' },
  '/_api/acp/chats/restore': { class: 'local' },
  '/_api/acp/chats/search': { class: 'local' },
  '/_api/acp/chats/trash': { class: 'local' },
  // S5.10 routes/chat-attach.ts: a photo / footage / sound attachment lands in Assets (the same
  // writer as /_api/asset); a PDF and every folder grant are this Mac's (`_chat/`, `_state/`)
  '/_api/ai/attach/file': { class: 'file-plane', rows: 'S27' },
  '/_api/ai/attach/folder': { class: 'local' },
  '/_api/ai/attach/folder/detach': { class: 'local' },
  '/_api/ai/attach/folder/revoke': { class: 'local' },
  '/_api/ai/attach/folders': { class: 'local' },
  '/_api/ai/attach/folder/list': { class: 'local' },
  '/_api/acp/focus': { class: 'local' },
  '/_api/acp/running': { class: 'local' },
  '/_api/acp/status': { class: 'local' },
  '/_api/ai': { class: 'local', rows: 'I02' },
  '/_api/ai/end': { class: 'local', rows: 'I02' },
  '/_api/ai/heartbeat': { class: 'local', rows: 'I02' },
  '/_api/ai/start': { class: 'local', rows: 'I02' },
  // S5.3 — the AI run registry (routes/ai.ts): this Mac's `_state/runs/` + its lease home. A
  // stop's partial version publishes through the run's stage (S5.5), not through this route.
  '/_api/ai/runs': { class: 'read' },
  '/_api/ai/runs/stop-all': { class: 'local' },
  '/_api/ai/runs/:id/stop': { class: 'local' },
  '/_api/ai/runs/:id/cancel': { class: 'local' },
  '/_api/ai/runs/:id/keep-going': { class: 'local' },
  // S5.11b — Run on a copy writes the canvas source as the WAITING run's tool write: claimed for
  // that run's stage before it lands, so it is published with the run's own action (one version).
  '/_api/ai/runs/:id/copy': {
    class: 'lane',
    via: "copy write claimed for the waiting run's stage (claimAiWrite) → watcher import → staged into that run's action",
    test: 'test/ai-run-copy.test.ts',
  },
  '/_api/claude/install': { class: 'local' },
  '/_api/claude/install-status': { class: 'local' },
  '/_api/claude/signin': { class: 'local' },
  '/_api/claude/signin-cancel': { class: 'local' },
  '/_api/claude/signin-status': { class: 'local' },
  '/_api/cloud/attach': { class: 'local' },
  '/_api/cloud/attach/code': { class: 'local' },
  '/_api/cloud/detach': { class: 'local' },
  '/_api/cloud/history': { class: 'read' },
  // S6.0b routes/cloud-move.ts: creates the cloud project + links THIS folder (the attach lane);
  // the seed-up is the sync runtime's, never this route's
  '/_api/cloud/move': { class: 'local' },
  '/_api/cloud/projects': { class: 'read' },
  '/_api/cloud/signin/poll': { class: 'local' },
  '/_api/cloud/signin/start': { class: 'local' },
  '/_api/cloud/signout': { class: 'local' },
  '/_api/cloud/status': { class: 'read' },
  '/_api/debug-bundle': { class: 'local' },
  '/_api/export': { class: 'local' },
  '/_api/export-assemble': { class: 'local' },
  '/_api/export-estimate': { class: 'local' }, // S8.1 — numbers only, writes nothing
  '/_api/export-jobs': { class: 'local' },
  '/_api/export-jobs/download': { class: 'local' },
  '/_api/export-jobs/retry': { class: 'local' }, // S8.4 — re-runs a job's failed items; the files stay on this Mac
  '/_api/export-warmup': { class: 'local' },
  '/_api/figma/connect': { class: 'local' },
  '/_api/generate/keyframe-model': { class: 'local' },
  '/_api/generate/keys': { class: 'local' },
  '/_api/generate/whisper-model': { class: 'local' },
  '/_api/hub/link': { class: 'local' },
  '/_api/report': { class: 'local' },
  '/_api/report-fallback': { class: 'local' },
  '/_api/shell-shot': { class: 'local' },
  '/_api/sync/cancel-assets': { class: 'local' },
  '/_api/sync/ownership': { class: 'local' },
  '/_api/sync/resync': { class: 'local', rows: 'X16' },
  '/_api/sync/offline': { class: 'local', rows: 'T19 (pull the whole file plane now)' },
  '/_api/sync/settings': { class: 'local' },
  '/_api/sync/trash': { class: 'local', rows: 'X15 (restore re-enters through cold start)' },
  '/_api/timeline-media': { class: 'local' },
  '/_api/tree-state': { class: 'local' },
  '/_api/ui-prefs': { class: 'local' },
  '/_api/workspace/disclosure': { class: 'local' },
  '/_api/workspace/sign-in': { class: 'local' },
  // --- the V2-2.5 table (routes/*.ts) — classified by the lead (decision v2-2.5 classification)
  '/_api/outbox': { class: 'read' }, // routes/outbox.ts: the queue's view
  '/_api/outbox/:id': { class: 'read' },
  '/_api/outbox/:id/cancel': { class: 'local' }, // this machine's queue (_state/outbox)
  '/_api/outbox/:id/retry': { class: 'local' },
  '/_api/shell/status': { class: 'read' }, // routes/shell.ts: the desktop shell's probe — four counts, no effect
  '/_api/project/format': { class: 'read' }, // routes/project-format.ts
  '/_api/asset-state': { class: 'read' }, // routes/asset-state.ts (S8.19): disk + queue + hub presence, no effect
  '/_api/pins': { class: 'local' }, // routes/pins.ts: _canvas-state/_pins.json (DDR-115 runtime)
  // S11.13 routes/settings.ts — Settings › Advanced reads (a count; plugin versions)
  '/_api/kg/summary': { class: 'read' },
  '/_api/settings/about': { class: 'read' },
  '/_api/sync/availability': { class: 'read' }, // routes/availability.ts (S11.4): listed minus on disk, no effect
  '/_api/sync/conflicts': { class: 'read' }, // routes/sync-conflicts.ts (S9.24): this Mac's _state/conflicts/, no effect
  // S9.24 — a conflict pick is the canvas's own op path: one batch, one annotations lane.replace.
  '/_api/sync/conflicts/resolve': {
    class: 'lane',
    rows: 'S23',
    via: 'applyAnnotationOps → onAnnotationsChanged hook → annotations lane.replace with the pre-batch board as base',
    test: 'test/sync-conflicts-route.test.ts',
  },
  // S3.5 — routes/present.ts: Present order / skip / notes in the versioned .meta.json
  '/_api/present-meta': {
    class: 'lane',
    rows: 'S19',
    via: 'onMetaChanged hook → meta lane.replace with the replaced file as base (api writeCanvasMetaText, the layout lane writer)',
    test: 'test/present-meta-route.test.ts',
  },
  '/_api/ds/components': { class: 'read' }, // S2.16 routes/edit.ts: what the Component picker lists (minRole edit)
  '/_api/edit-instance': { class: 'read' }, // S2.17 routes/edit.ts: what an object is (instance of a component?) — read from the TSX, anyone who sees the canvas
  '/_api/comp-media': { class: 'read' }, // S7.4 routes/video.ts: the comp's words / speech / beats, derived from the cut
  // S9.19 — routes/share.ts: the desktop's door to the linked hub's /api/access/*. Who has access
  // lives on the hub (users / invites / grants), never in the project's files: no lane carries it.
  '/_api/share/posture': { class: 'read' },
  '/_api/share/me': { class: 'read' },
  '/_api/share/people': { class: 'read' },
  '/_api/share/invites': { class: 'local' }, // the hub's invitation (or this Mac's outbox while offline)
  '/_api/share/invites/:id/resend': { class: 'local' },
  '/_api/share/invites/:id/revoke': { class: 'local' },
  '/_api/share/people/:id': { class: 'local' },
  '/_api/share/people/:id/remove': { class: 'local' },
  '/_api/project/migrate': {
    class: 'migration',
    via: 'the migrate engine rewrites files after the hub format flip (V2-1.12 §5.10 I7, all-or-nothing with its own snapshot); peers receive the rewritten files through the file plane / watcher import like any outside edit',
    test: 'test/format-mixed-peer.test.ts',
  },
};
