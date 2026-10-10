// actions/index.ts — the registry aggregate (V2-1.3 contract §5.1): every area's entries,
// concatenated and frozen. Lanes add entries to `defs/<area>.ts`; the lead owns this file.

import type { ActionDef, ActionId } from './types.ts';

export const ACTIONS: readonly ActionDef[] = Object.freeze([]);

export const ACTIONS_BY_ID: ReadonlyMap<ActionId, ActionDef> = new Map(
  ACTIONS.map((a) => [a.id, a])
);
