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

import type { ActionDefAI, Role } from '../actions/types.ts';

export type RefusalMethod = NonNullable<ActionDefAI['server']>['method'];

export interface RoleRefusal {
  method: RefusalMethod;
  /** The route exactly as the action's `server.route` spells it. */
  route: string;
  /** The roles the server must refuse on this route (at least every role below `minRole`). */
  refused: readonly Role[];
}

export const ROLE_REFUSALS: readonly RoleRefusal[] = [
  // S3.5 — `present.order-notes`: Present order, skip and notes are an edit (test/present-meta-route.test.ts).
  { method: 'PATCH', route: '/_api/present-meta', refused: ['view', 'comment'] },
];

export const refusalKey = (method: RefusalMethod, route: string): string => `${method} ${route}`;
