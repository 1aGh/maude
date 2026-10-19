// _role-refusals.ts — the ONE table of per-role refusal cases for action `server` routes
// (contract V2-1.11 §5.7 rule 7; V2-1.7 rule 12: whatever the UI hides for a role, the server
// refuses too).
//
// A row is how test/ai-parity-coverage.test.ts RECOGNISES a refusal test: every action whose AI
// entry (actions/agents.ts) or definition declares `server: { route, method }` needs a row here,
// and the row's `refused` must hold every role ranked below the action's `minRole`.
//
// The V2-1.7/S9 role suite (test/access-local-gate.test.ts) imports this table and generates one
// case per (row, refused role): boot the studio, send `method route` as that role, expect the
// refusal. Rule 7 also fails while the table has rows and no test file imports it, so a row is
// never coverage on paper only. Add the row in the same change that adds the `server` field.
//
// S9.9 seeds it with the local gate's own classes (one row per capability the studio
// enforces — V2-1.7 §5.7): no action declares `server` yet, so these rows are the server
// half that the actions will point at. Roles are the registry's (`view` = Can view =
// wire `observer`, `comment` = viewer, `edit` = member).
// S1.7b: `trash.clear` (owner) adds a row; test/acl-l18-trash.test.ts consumes the table.

import type { ActionDefAI, Role } from '../actions/types.ts';

export type RefusalMethod = NonNullable<ActionDefAI['server']>['method'];

export interface RoleRefusal {
  method: RefusalMethod;
  /** The route exactly as the action's `server.route` spells it. */
  route: string;
  /** The roles the server must refuse on this route (at least every role below `minRole`). */
  refused: readonly Role[];
  /** The JSON body sent (the refusal answers before any handler reads it). */
  body?: unknown;
}

export const ROLE_REFUSALS: readonly RoleRefusal[] = [
  // comment — Can comment and up (D5: Can view may not comment)
  { method: 'POST', route: '/_comments', refused: ['view'] },
  { method: 'POST', route: '/_api/comments/c1/reply', refused: ['view'] },
  // S9.7b — the comment door (routes/comments.ts): every op needs `comment`
  {
    method: 'POST',
    route: '/_api/comments/op',
    refused: ['view'],
    body: { op: 'add', file: '.design/ui/a.tsx', text: 'x' },
  },
  // S4.14 — formal votes (routes/votes.ts): a ballot needs `vote` (Can view refused, Can comment may);
  // starting and ending one need `edit` (`annotations.start-vote` / `annotations.end-vote`).
  {
    method: 'POST',
    route: '/_api/votes/ballot',
    refused: ['view'],
    body: { file: '.design/ui/a.tsx', id: 'vote-aaaaaaaaaa', picks: {} },
  },
  {
    method: 'POST',
    route: '/_api/votes/start',
    refused: ['view', 'comment'],
    body: { file: '.design/ui/a.tsx', targets: ['ab:a'] },
  },
  {
    method: 'POST',
    route: '/_api/votes/end',
    refused: ['view', 'comment'],
    body: { file: '.design/ui/a.tsx', id: 'vote-aaaaaaaaaa' },
  },
  // export — every download and export
  { method: 'POST', route: '/_api/export', refused: ['view'] },
  { method: 'POST', route: '/_api/export-jobs', refused: ['view'] },
  { method: 'POST', route: '/_api/export-history', refused: ['view'] },
  { method: 'POST', route: '/_api/export-assemble', refused: ['view'] },
  // S8.1 — the estimate is the export class too (numbers about an export)
  { method: 'POST', route: '/_api/export-estimate', refused: ['view'] },
  // S8.4 — Retry is the export class too
  { method: 'POST', route: '/_api/export-jobs/retry', refused: ['view'] },
  // annotate — stickies, marker, arrows (D5: Can comment may not annotate)
  { method: 'POST', route: '/_api/annotations/ops', refused: ['view', 'comment'] },
  { method: 'PUT', route: '/_api/annotations', refused: ['view', 'comment'] },
  // S4.13 — Turn into a comment writes the comment and removes the sticky: an edit (Q6, hub `annotate`)
  {
    method: 'POST',
    route: '/_api/annotations/to-comment',
    refused: ['view', 'comment'],
    body: { file: '.design/ui/a.tsx', id: 'st-1' },
  },
  // sec-a L7 — the other direction (comment → sticky) and the conversion's undo token are board writes
  // too (access/request.ts ANNOTATE_WRITES): refused below `edit`, before the body is read
  {
    method: 'POST',
    route: '/_api/comments/to-sticky',
    refused: ['view', 'comment'],
    body: { commentId: 'c_1' },
  },
  {
    method: 'POST',
    route: '/_api/annotations/convert-undo',
    refused: ['view', 'comment'],
    body: { token: 'tok-1' },
  },
  // S4.16 - a FigJam board arrives as annotations: an edit (hub `annotate`), refused before the body is read
  {
    method: 'POST',
    route: '/_api/annotations/figjam',
    refused: ['view', 'comment'],
    body: { file: '.design/ui/a.tsx', url: 'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/x' },
  },
  // edit — the versioned layout lane, canvas writes, the AI chat (D2)
  {
    method: 'PATCH',
    route: '/_api/canvas-meta',
    refused: ['view', 'comment'],
    body: { file: '.design/ui/a.tsx', patch: { layout: { artboards: [] } } },
  },
  { method: 'POST', route: '/_api/edit-text', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/acp/chats/trash', refused: ['view', 'comment'] },
  // S3.5 — `present.order-notes`: Present order, skip and notes are an edit (test/present-meta-route.test.ts).
  { method: 'PATCH', route: '/_api/present-meta', refused: ['view', 'comment'] },
  // S7.6c — the video tools' edit ops (`video.*` server: POST /_api/edit-op): a clip op from a
  // Can comment session is the gate's 403, whatever the Timeline shows.
  {
    method: 'POST',
    route: '/_api/edit-op',
    refused: ['view', 'comment'],
    body: {
      file: '.design/ui/a.tsx',
      op: 'video.reframe',
      targets: [],
      params: { artboard: 'reel', stableId: 'name:one', zoom: 2 },
    },
  },
  // S9.24 — `sync.conflict.keep-*`: a conflict pick is a board edit (test/sync-conflicts-route.test.ts).
  {
    method: 'POST',
    route: '/_api/sync/conflicts/resolve',
    refused: ['view', 'comment'],
    body: { slug: 'ui-a', id: 's1', choice: 'mine' },
  },
  // delete — Clear-out is the project owner's (V2-1.7 §5.2 `delete`, decision:maude/v2-lead-trash-clear-human-only);
  // `writeCapability` classes it `delete` (test/access-local-gate.test.ts).
  { method: 'POST', route: '/_api/trash/clear', refused: ['view', 'comment', 'edit'] },
  // S3.10a — `element.set-link` / `element.clear-link`: one dispatch route for every structural edit (test/edit-op-route.test.ts;
  // the viewer's 403 through a booted studio is a row of test/access-role-matrix.test.ts).
  { method: 'POST', route: '/_api/edit-op', refused: ['view', 'comment'] },
  // S1.13 — history.restore / restore-artboard / restore-object / go-back (test/restore-artboard.test.ts).
  { method: 'POST', route: '/_api/project/restore', refused: ['view', 'comment'] },
  // S1.17 — trash.restore: the Trash row's Restore (an edit; test/acl-l18-trash.test.ts consumes it).
  {
    method: 'POST',
    route: '/_api/trash/restore',
    refused: ['view', 'comment'],
    body: { id: 'canvas:n_a' },
  },
  // S11.10 — Version history › Advanced's git buttons (history.branch-switch · continue-draft · new-branch · publish ·
  // save-with-note · open-pr · discard-file) and a row's Undo (history.undo-action). The fold is hidden below edit;
  // these rows are the server half (test/access-role-matrix.test.ts pins the same routes).
  { method: 'POST', route: '/_api/git/checkout', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/git/branch', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/git/push', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/git/commit', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/git/fold', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/git/discard', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/project/undo', refused: ['view', 'comment'] },
  // history.fetch moves remote refs only: the role matrix allows it for a viewer, so the fold hides it and
  // the server refuses no one (no `minRole` on the action, so no role is below it).
  { method: 'POST', route: '/_api/git/fetch', refused: [] },
  // S11.6 — the code view: source text is a download (Can view refused; test/canvas-source-route.test.ts).
  { method: 'GET', route: '/_api/canvas-source', refused: ['view'] },
  { method: 'GET', route: '/_api/canvas-errors', refused: ['view'] },
  // S11.11 — `sync.resync`: Resync now re-compares every file with the cloud copy and sends what is newer
  // here, so it is an edit (routes/sync.ts is `readOnly: 'refused'`; the cloud cell refuses it outright).
  { method: 'POST', route: '/_api/sync/resync', refused: ['view', 'comment'] },
  // S11.17 — `save.retry-held`: Retry writes the canvas files a full disk held (`readOnly: 'refused'`).
  { method: 'POST', route: '/_api/diagnostics/disk-retry', refused: ['view', 'comment'] },
  // S9.19 — who has access is the owner's (`invite`, V2-1.7 §5.5): routes/share.ts refuses every
  // session without it before the linked hub hears anything (test/share-route.test.ts).
  { method: 'POST', route: '/_api/share/invites', refused: ['view', 'comment', 'edit'] },
  {
    method: 'PATCH',
    route: '/_api/share/people/:id',
    refused: ['view', 'comment', 'edit'],
    body: { role: 'viewer' },
  },
  { method: 'POST', route: '/_api/share/people/:id/remove', refused: ['view', 'comment', 'edit'] },
  { method: 'POST', route: '/_api/share/invites/:id/resend', refused: ['view', 'comment', 'edit'] },
  // S10.3b — the design-system writes (routes/ds.ts, Q15): every one is a project edit; a token's
  // clear-out is the owner's (`writeCapability` classes /_api/ds/clear `delete`).
  ...[
    '/_api/ds/publish',
    '/_api/ds/pending',
    '/_api/ds/outside',
    '/_api/ds/pick',
    '/_api/ds/canvas',
    '/_api/ds/trash',
    '/_api/ds/restore',
  ].map((route) => ({ method: 'POST' as const, route, refused: ['view', 'comment'] as const })),
  { method: 'POST', route: '/_api/ds/clear', refused: ['view', 'comment', 'edit'] },
];

export const refusalKey = (method: RefusalMethod, route: string): string => `${method} ${route}`;
