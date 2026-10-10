// check/ids.ts — the V2-1.4 element-id check inside `maude design check` (contract V2-1.11 §5.2
// canvas-tsx row: "element-id preservation vs the pre-edit snapshot").
//
// The check itself is V2-2.19's `checkIds` (apps/studio/element-ids.ts, branch
// v2-2.19-element-ids, owner p2-element-ids). Its agreed shape is mirrored below. Until it lands on
// feat this adapter is a STUB that finds nothing, and test/maude-design-check.test.ts carries a
// red `test.todo` naming the branch. When it lands, replace the stub body with:
//
//   import { checkIds } from '../element-ids.ts';
//   export const ID_CHECK_SOURCE = 'element-ids';
//   export function checkIdsAdapter(source, opts) { return checkIds(source, { against: opts.against, path: opts.path }); }
//
// Never pass `fix` from a hook (V2-1.4 §5.3). A new file (no `against`) runs only id-duplicate /
// id-expression / id-format; an unstamped element is valid (lazy stamping, V2-1.4 §4.3, §9 Q5).

export interface IdFinding {
  code:
    | 'id-lost'
    | 'id-removed'
    | 'id-duplicate'
    | 'id-expression'
    | 'id-format'
    | 'locked-changed'
    | 'cd-attr-changed';
  /** block on 'error'; id-removed is 'info' */
  severity: 'error' | 'info';
  /** `${path}:${line}:${col}`, or `${path}#${artboard}` for an element that is gone */
  where: string;
  what: string;
  fix: string;
  id?: string;
  line: number;
  col: number;
  element: { tag: string; label: string; artboard: string | null };
}

export interface CheckIdsResult {
  findings: IdFinding[];
  lostIds: string[];
  reattach: Array<{ id: string; line: number }>;
  fixed?: string;
  parseError?: string;
}

/** 'stub' until V2-2.19's element-ids.ts is on feat; then 'element-ids'. */
export const ID_CHECK_SOURCE: 'stub' | 'element-ids' = 'stub';

export function checkIdsAdapter(
  _source: string,
  _opts: { against?: string; path?: string }
): CheckIdsResult {
  return { findings: [], lostIds: [], reattach: [] };
}
