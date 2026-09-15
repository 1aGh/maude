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

export type WriterClass = 'read' | 'lane' | 'structural' | 'file-plane' | 'git' | 'local';

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
  '/_api/canvas-meta': {
    class: 'lane',
    rows: 'S19',
    via: 'onMetaChanged hook → meta lane.replace with the replaced file as base; camera/overlays/locked stay local',
    test: 'test/sync-accepted-runtime.test.ts',
  },
  '/_api/annotations': {
    class: 'lane',
    rows: 'S23',
    via: 'onAnnotationsChanged hook → annotations lane.replace with the base the layer sent',
    test: 'test/sync-accepted-projection.test.ts',
  },
  // --- accepted history (T27/T28)
  '/_api/project/history': { class: 'read' },
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
    via: 'history.undo/redo — effect-aware compensation of one of this actor’s actions',
    test: 'test/sync-accepted-runtime.test.ts',
  },
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
  '/_api/projects/prepare': { class: 'local', rows: 'H13 (credential + project description for a managed copy)' },
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
  // --- this machine only
  '/_api/acp/activity': { class: 'local' },
  '/_api/acp/attachment': { class: 'local' },
  '/_api/acp/chat': { class: 'local' },
  '/_api/acp/chats': { class: 'local' },
  '/_api/acp/focus': { class: 'local' },
  '/_api/acp/running': { class: 'local' },
  '/_api/acp/status': { class: 'local' },
  '/_api/ai': { class: 'local', rows: 'I02' },
  '/_api/ai/end': { class: 'local', rows: 'I02' },
  '/_api/ai/heartbeat': { class: 'local', rows: 'I02' },
  '/_api/ai/start': { class: 'local', rows: 'I02' },
  '/_api/claude/install': { class: 'local' },
  '/_api/claude/install-status': { class: 'local' },
  '/_api/claude/signin': { class: 'local' },
  '/_api/claude/signin-cancel': { class: 'local' },
  '/_api/claude/signin-status': { class: 'local' },
  '/_api/cloud/attach': { class: 'local' },
  '/_api/cloud/attach/code': { class: 'local' },
  '/_api/cloud/detach': { class: 'local' },
  '/_api/cloud/history': { class: 'read' },
  '/_api/cloud/projects': { class: 'read' },
  '/_api/cloud/signin/poll': { class: 'local' },
  '/_api/cloud/signin/start': { class: 'local' },
  '/_api/cloud/signout': { class: 'local' },
  '/_api/cloud/status': { class: 'read' },
  '/_api/debug-bundle': { class: 'local' },
  '/_api/export': { class: 'local' },
  '/_api/export-assemble': { class: 'local' },
  '/_api/export-jobs': { class: 'local' },
  '/_api/export-jobs/download': { class: 'local' },
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
  '/_api/ui-prefs': { class: 'local' },
  '/_api/workspace/disclosure': { class: 'local' },
  '/_api/workspace/sign-in': { class: 'local' },
};
