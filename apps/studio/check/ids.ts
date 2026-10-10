// check/ids.ts — the V2-1.4 element-id check inside `maude design check` (contract V2-1.11 §5.2
// canvas-tsx row: "element-id preservation vs the pre-edit snapshot").
//
// The check is V2-2.19's `checkIds` (apps/studio/element-ids.ts); this adapter only narrows the
// options. Never pass `fix` from a hook (V2-1.4 §5.3) — it would fail Claude's next Edit. A new
// file (no `against`) runs only id-duplicate / id-expression / id-format; an unstamped element is
// valid (lazy stamping, V2-1.4 §4.3, §9 Q5).

import { type CheckIdsResult, checkIds } from '../element-ids.ts';

export type { CheckIdsResult, IdFinding } from '../element-ids.ts';

export const ID_CHECK_SOURCE: 'stub' | 'element-ids' = 'element-ids';

export function checkIdsAdapter(
  source: string,
  opts: { against?: string; path?: string }
): CheckIdsResult {
  return checkIds(source, { against: opts.against, path: opts.path });
}
