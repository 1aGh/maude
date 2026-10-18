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
  // export — every download and export
  { method: 'POST', route: '/_api/export', refused: ['view'] },
  { method: 'POST', route: '/_api/export-jobs', refused: ['view'] },
  { method: 'POST', route: '/_api/export-history', refused: ['view'] },
  { method: 'POST', route: '/_api/export-assemble', refused: ['view'] },
  // S8.1 — the estimate is the export class too (numbers about an export)
  { method: 'POST', route: '/_api/export-estimate', refused: ['view'] },
  // annotate — stickies, marker, arrows (D5: Can comment may not annotate)
  { method: 'POST', route: '/_api/annotations/ops', refused: ['view', 'comment'] },
  { method: 'PUT', route: '/_api/annotations', refused: ['view', 'comment'] },
  // edit — the versioned layout lane, canvas writes, the AI chat (D2)
  {
    method: 'PATCH',
    route: '/_api/canvas-meta',
    refused: ['view', 'comment'],
    body: { file: '.design/ui/a.tsx', patch: { layout: { artboards: [] } } },
  },
  { method: 'POST', route: '/_api/edit-text', refused: ['view', 'comment'] },
  { method: 'POST', route: '/_api/acp/chats/trash', refused: ['view', 'comment'] },
  // delete — `/_api/trash/clear` (owner, §5.5) is S1's route; its row lands with it.
  // `writeCapability` already classes it `delete` (test/access-local-gate.test.ts).
  // S3.5 — `present.order-notes`: Present order, skip and notes are an edit (test/present-meta-route.test.ts).
  { method: 'PATCH', route: '/_api/present-meta', refused: ['view', 'comment'] },
];

export const refusalKey = (method: RefusalMethod, route: string): string => `${method} ${route}`;
