// S9.12 — U3: every studio route's scope class (V2-1.16 §5.1 U3). The four names are the
// hub's (`apps/hub/src/routes-v2/index.mjs` SCOPES) and the socket frames' (WS_FRAME_CLASSES):
//   none      carries nothing about the project's canvases (Maude, the machine, the account,
//             per-user runtime) — a canvas-only session may read it as is
//   canvas    names ONE canvas (a target): refused `not-in-scope` outside the grants + closure,
//             byte-identical to a missing canvas (U1)
//   filtered  a listing / aggregate: narrowed to the session's canvases (U2, U4, U5)
//   project   about the whole project: a canvas-only session never gets a 2xx
// access-route-classes.test.ts holds this table to the route inventory (test/_acl-gate.ts),
// so a route added to any table and not classified here is a red test; the canary sweep
// holds `project` to its meaning.

export type ScopeClass = 'none' | 'canvas' | 'filtered' | 'project';

const NONE = [
  '/',
  '/index.html',
  '/_health',
  '/_active',
  '/_hmr',
  '/_client/:bundle',
  '/_canvas-runtime/:bundle',
  '/_stickers/:sticker',
  '/_media/:media',
  '/_api/git-user',
  '/_api/export-warmup',
  '/_api/preflight',
  '/_api/setup-readiness',
  '/_api/project/format',
  '/_api/stickers',
  '/_api/sync/ownership',
  '/_api/sync/settings',
  '/_api/tree-state',
  '/_api/ui-prefs',
  '/_api/timeline-media',
  '/_api/whats-new',
  // S11.17 — the crash line's last-work time and the full-disk hold's counts: no canvas in either
  '/_api/diagnostics/last-work',
  '/_api/diagnostics/disk',
  // A6b-2 — S11.13 Settings › Advanced reads: a number, plugin versions
  '/_api/kg/summary',
  '/_api/settings/about',
  '/_api/shell/status',
  '/_api/workspace/disclosure',
  '/_api/workspace/sign-in',
  '/_api/report',
  '/_api/report-fallback',
  '/_api/hub/link',
  '/_api/cloud/status',
  // S9.20b — the account's plan (state, days left, plan name): about the account, not the project
  '/_api/cloud/plan',
  // S11.14 — the linked team server's Advanced details: about this Mac's sign-in, not the project
  '/_api/connections/hub',
  '/_api/cloud/signin/start',
  '/_api/cloud/signin/poll',
  '/_api/cloud/signout',
  '/_api/cloud/detach',
  '/_api/claude/install',
  '/_api/claude/install-status',
  '/_api/claude/signin',
  '/_api/claude/signin-cancel',
  '/_api/claude/signin-status',
  '/_api/generate/providers',
  '/_api/generate/keys',
  '/_api/generate/prefs',
  '/_api/generate/whisper-model',
  '/_api/generate/keyframe-model',
  '/_api/generate/audio-search',
  '/_api/figma/status',
  '/_api/figma/connect',
  '/_api/github/identity',
  // A6b-3 — S9.19: the linked hub’s posture (is it linked, reachable, which roles exist); no canvas in it
  '/_api/share/posture',
  '/_api/git/fetch',
];

const FILTERED = [
  // S8.15 — Apply to every use: the canvases a picture is in, narrowed to the session's; the write is G2's
  // every-referrer rule on the every-use edit (routes/photo-every-use.ts)
  '/_api/photo-every-use',
  // A6a — S1.7 shared Trash list (L18: only the session's canvases); S1.18 link resolve (an ungranted entry reads `unknown`, as a missing one)
  '/_api/trash',
  '/_api/link/resolve',
  '/_config',
  '/_index-data',
  '/_system-data',
  '/_comments-all',
  '/_api/index',
  '/_api/assets',
  // S8.21 — an asset's details and the Generated runs: judged per asset like /_api/assets
  '/_api/asset-details',
  '/_api/asset-generated',
  '/_api/ai',
  '/_api/ai/runs',
  '/_api/outbox',
  '/_api/outbox/:id',
  '/_api/pins',
  '/_api/export-history',
  '/_api/export-jobs',
  '/_api/git-committers',
  '/_api/git/status',
  '/_api/git/branches',
  '/_api/git/log',
  '/_api/git/diff',
  '/_api/project/history',
  '/_api/project/undo-stack',
  '/_api/sync/trash',
  // A6b-1 — S11.4: listed ∖ on disk; a canvas-only session is narrowed to the canvas it names (routes/availability.ts)
  '/_api/sync/availability',
  '/_api/acp/chats',
  '/_api/acp/chats/search',
  '/_api/cloud/history',
  '/_api/generate-jobs',
  // A6b-2 — S8.1 estimate counts over the canvases the session sees; S8.4 retry of one of its jobs; S8.19 media
  // presence of a canvas it sees (routes/asset-state.ts refuses a canvas-only session everything else)
  '/_api/export-estimate',
  '/_api/export-jobs/retry',
  '/_api/export-preflight',
  '/_api/export-preview',
  // A6b-3 — S9.19 who has access (the hub narrows it to the session), S9.24 the conflicts THIS Mac lost, S10.3 a system is seen only through its DS canvas (routes/ds.ts: every other system answers like one that does not exist)
  '/_api/share/me',
  '/_api/share/people',
  // S9.21 — Ask to edit names `{ canvas? }` (the gate judges it like any target); the open list is the hub's, narrowed
  '/_api/share/requests',
  '/_api/sync/conflicts',
  '/_api/ds/state',
  '/_api/ds/board',
  '/_api/ds/revision',
  '/_api/ds/revisions',
  '/_api/ds/usage',
  '/_api/ds/make-state',
  // S10.17 — the nearest system colour, and the off-system colours of a canvas (reads)
  '/_api/ds/nearest',
  '/_api/ds/off-system',
  // S10.19 — the system's files view and Check the system answer like `state`: a system is seen only through its DS canvas
  '/_api/ds/system-files',
  '/_api/ds/check-system',
  '/_api/asset-state',
];

const CANVAS = [
  // A6a — one canvas each: S5.11b run copy, S4.7 sticky ↔ comment, S9.7b comment op, S3.10a on-click links (`file`), S1.12b/S1.13 version history (`path`), S1.17 Trash restore (the item's canvas)
  '/_api/ai/runs/:id/copy',
  '/_api/annotations/to-comment',
  '/_api/annotations/convert-undo',
  '/_api/annotations/figjam', // S4.16 - one canvas (`file`)
  // S4.14 — votes: each names one canvas (`file`); the vote door scopes by it (routes/votes.ts `scope`)
  '/_api/votes',
  '/_api/votes/start',
  '/_api/votes/ballot',
  '/_api/votes/end',
  '/_api/comments/to-sticky',
  '/_api/comments/op',
  '/_api/links',
  '/_api/project/versions',
  '/_api/project/changes',
  '/_api/project/source',
  '/_api/project/name',
  '/_api/project/aside',
  // A6b-1 — S1.16 object history (`path`) and S11.6 canvas build errors (`canvas`): each names one canvas
  '/_api/project/object-history',
  '/_api/canvas-errors',
  '/_api/trash/restore',
  // A6b-3 — S7.4 a comp’s words (`canvas`), S10.3 a canvas update / leave, S2.16 the Component picker (`file`), S9.24 a conflict pick (`slug`)
  '/_api/comp-media',
  '/_api/ds/canvas',
  '/_api/ds/components',
  // S7.20 the F size picker's catalogue (`file`, minRole edit)
  '/_api/kinds/presets',
  // S7.25 the things to check on an artboard and Change kind's plan (both name their canvas by `canvas`)
  '/_api/kinds/warnings',
  '/_api/kinds/convert-plan',
  '/_api/edit-instance',
  '/_api/sync/conflicts/resolve',
  // S9.12b — landed on feat with S3.5 (Present order + notes) and the edit-op lane: both
  // write the ONE canvas their JSON body's `file` names (PATCH / POST, main origin only).
  '/_api/present-meta',
  '/_api/edit-op',
  // S8.16 — Generate with N takes: the quote, the run and both reads name the canvas the takes go on
  '/_api/generate-takes',
  '/_api/generate-takes/quote',
  '/_api/generate-takes/of',
  // S8.10 — Handoff to production: the targets, the run and Copy code all name ONE canvas (or, for a
  // design system's tokens, the project: a canvas-only session is refused `not-in-scope`)
  '/_api/handoff/targets',
  '/_api/handoff',
  '/_api/handoff/result',
  '/.design/:rel',
  '/assets/:asset',
  '/_canvas-shell',
  '/_canvas-shell.html',
  '/_canvas-state',
  '/_comments',
  '/_api/comments/:id/reply',
  '/_api/thumb/:key',
  '/_api/thumbs/want',
  '/_api/canvas',
  '/_api/canvas-meta',
  '/_api/canvas-source',
  '/_api/component-map',
  '/_api/comp-clips',
  '/_api/edit-scope',
  '/_api/photo-edit',
  '/_api/footage',
  '/_api/annotations',
  '/_api/annotations/ops',
  '/_api/asset',
  '/_api/asset/chunk-start',
  '/_api/asset/chunk',
  '/_api/asset/chunk-finish',
  '/_api/import-asset',
  '/_api/export',
  '/_api/export-jobs/download',
  '/_api/export-assemble',
  '/_api/ai/start',
  '/_api/ai/heartbeat',
  '/_api/ai/end',
  '/_api/ai/runs/:id/stop',
  '/_api/ai/runs/:id/cancel',
  '/_api/ai/runs/:id/keep-going',
  '/_api/agent/run/begin',
  '/_api/agent/run/end',
  '/_api/agent/write/claim',
  '/_api/agent/bash/window',
  '/_api/agent/check',
  '/_api/agent/edit/check',
  '/_api/agent/edit/touched',
  '/_api/ui/open',
  '/_api/project/ai-action',
  '/_api/project/conflict',
  ...[
    'edit-css',
    'edit-text',
    'edit-attr',
    'edit-array-src',
    'reorder',
    'reorder-revert',
    'retime-sequence',
    'clip-edit',
    'remove-sequence',
    'insert-sequence',
    'reorder-sequence',
    'toggle-hide',
    'delete-element',
    'insert-element',
    'convert-to-absolute',
    'detach-component',
    'duplicate-element',
    'insert-artboard',
    'duplicate-artboard',
    'resize-artboard',
    'set-artboard-hug',
    'set-artboard-style',
    'set-artboard-kind',
    'set-artboard-label',
    'set-artboard-guides',
    'set-artboard-print',
    'delete-artboard',
  ].map((v) => `/_api/${v}`),
];

const PROJECT = [
  // S8.20 — search in pictures: the person's own consent, budget and describe search; canvas-only guests get no 2xx
  '/_api/describe',
  '/_api/describe/consent',
  '/_api/describe/stop',
  // S7.11b — a transcript / the beats of one project asset (routes/video.ts): the asset is the project's, so a
  // canvas-only session never gets a 2xx (Can edit on the whole project)
  '/_api/media-analysis',
  // A6b-2 — S6.0b: uploads the whole folder to the person's own cloud account (window-only, the owner's act)
  // A6b-3 — S10.3 design-system writes (Can edit on the whole project; clear is the owner’s), S9.19 who has access is the owner’s
  '/_api/ds/publish',
  '/_api/ds/pending',
  '/_api/ds/outside',
  '/_api/ds/pick',
  '/_api/ds/trash',
  '/_api/ds/restore',
  '/_api/ds/clear',
  '/_api/ds/make',
  // S10.13 — the project's default design system (config.json)
  '/_api/ds/default',
  // P8 round 7 — Rename… a system (its config.json label)
  '/_api/ds/rename',
  // S10.14 — move canvases to another design system
  '/_api/ds/switch',
  // S10.12 — convert system folders / Restore one (ds/convert.ts)
  '/_api/ds/convert',
  // S10.18b — team libraries: link / check / update / unlink (ds/library.ts)
  '/_api/ds/library',
  // S10.17 — Lighten to 4.5:1 and Add it to the system: waiting edits, judged on the DS canvas like `pending`
  '/_api/ds/fix-contrast',
  '/_api/ds/add-colour',
  // S10.15a — Bring it up to the schema (ds/upgrade*.ts)
  '/_api/ds/upgrade',
  '/_api/share/invites',
  '/_api/share/invites/:id/resend',
  '/_api/share/invites/:id/revoke',
  '/_api/share/people/:id',
  '/_api/share/people/:id/remove',
  // S9.20 — the link rules are project business: a canvas-only session sees no route
  '/_api/share/links',
  '/_api/share/links/:id',
  // S9.21 — Let … edit / Not now: the owner's
  '/_api/share/requests/:id/approve',
  '/_api/share/requests/:id/decline',
  '/_api/cloud/move',
  // S6.15 — Help adds the guide canvases: new canvases in the project, so a canvas-only session never gets a 2xx
  '/_api/help/add-guides',
  // A6a — S1.7b Clear out (owner); S5.10 AI attachments + folder consent (the AI chat is project-level, like /_api/acp/chat)
  '/_api/trash/clear',
  // S8.13 — Move assets to the trash: the whole `assets/` folder is the project's (a canvas-only session has no say)
  '/_api/assets/trash',
  // P8 round 7 — Rename… an asset: the same project-level say as Move to trash
  '/_api/assets/rename',
  '/_api/ai/attach/file',
  '/_api/ai/attach/folder',
  '/_api/ai/attach/folder/detach',
  '/_api/ai/attach/folder/list',
  '/_api/ai/attach/folder/revoke',
  '/_api/ai/attach/folders',
  '/_sync-status',
  '/_api/acp/status',
  '/_api/acp/focus',
  '/_api/acp/running',
  '/_api/acp/activity',
  '/_api/acp/chat',
  '/_api/acp/chat/session',
  '/_api/acp/attachment',
  '/_api/acp/chats/trash',
  '/_api/acp/chats/restore',
  '/_api/acp/chats/clear',
  '/_api/ai/runs/stop-all',
  '/_api/outbox/:id/cancel',
  '/_api/outbox/:id/retry',
  '/_api/diagnostics',
  '/_api/diagnostics/report',
  '/_api/debug-bundle',
  '/_api/shell-shot',
  '/_api/sync/offline',
  '/_api/sync/resync',
  // gate-b-sec4 — the parked committed link: its host, and Connect
  '/_api/sync/link',
  '/_api/sync/link/confirm',
  '/_api/diagnostics/disk-retry',
  '/_api/sync/cancel-assets',
  '/_api/fs-move',
  '/_api/fs-mkdir',
  '/_api/import-brand',
  '/_api/git/branch',
  '/_api/git/checkout',
  '/_api/git/fold',
  '/_api/git/commit',
  '/_api/git/discard',
  '/_api/git/push',
  '/_api/git/pull',
  '/_api/git/resolve',
  '/_api/cloud/projects',
  '/_api/cloud/attach',
  '/_api/cloud/attach/code',
  '/_api/project/restore',
  '/_api/project/migrate',
  '/_api/project/undo',
  '/_api/project/create-local',
  '/_api/projects/prepare',
  '/_api/design/init',
  '/_api/github/repos',
  '/_api/github/create-repo',
  '/_api/github/invite',
  '/_api/github/clone',
  '/_api/github/create-project',
  '/_api/figma/probe',
  '/_api/figma/import',
  '/_api/figma/explode',
  // S8.17 — the Import from Figma sheet: a new canvas in a folder is project business
  '/_api/figma/frames',
  '/_api/figma/import-frames',
  '/_api/generate/audio-reuse',
];

function table(): Record<string, ScopeClass> {
  const out: Record<string, ScopeClass> = {};
  for (const [cls, list] of [
    ['none', NONE],
    ['filtered', FILTERED],
    ['canvas', CANVAS],
    ['project', PROJECT],
  ] as const)
    for (const path of list) {
      if (path in out) throw new Error(`${path} is classified twice`);
      out[path] = cls;
    }
  return out;
}

export const ROUTE_CLASSES: Readonly<Record<string, ScopeClass>> = Object.freeze(table());
