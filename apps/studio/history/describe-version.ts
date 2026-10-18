// `describeVersion` — everything a version row needs from one canvas's before/after (S1.10): the TSX lane,
// the CSS / meta / annotations lanes, then the collapse ("Reworked …", V2-1.9 §5.5.3).
//
//   describeVersion(canvas, before, after, opts?) → { changes, detail, labels, ms }
//
// Scope policy (decided here, tested in `describe-lanes.test.ts`): a canvas-only session's words never name
// another canvas because NO lane reads or names one — each reads one canvas's own files and says only that
// canvas's artboards and elements (`links` by count, never by target). The words are therefore the same for
// every viewer, which is what lets the attribution cache key on `(actionId, canvas)` alone. What differs per
// viewer — an AI row's prompt — is chosen at read time by `rowTitle({ scope })`, never cached.

import {
  artboardLabel,
  type Change,
  type DescribeOptions,
  describeChanges,
  type LaneContext,
  type LaneDescriber,
  type Lanes,
} from './describe';
import { annotationsLane } from './describe-annotations';
import { type CssLaneOptions, cssLane } from './describe-css';
import { walkEls } from './describe-match';
import { metaLane } from './describe-meta';
import { nameInWords } from './describe-words';
import { collapseChanges } from './titles';

export interface DescribeVersionOptions extends DescribeOptions {
  css?: CssLaneOptions;
  /** Keep every line (Compare's expanded view). Default: collapse. */
  collapse?: boolean;
}

export interface VersionWords {
  changes: Change[];
  /** The original lines of each collapsed artboard. */
  detail: Record<string, Change[]>;
  /** Every artboard key either side holds → its name in words (Compare's headers, S1.15). */
  labels: Record<string, string>;
  ms: number;
}

export function describeVersion(
  canvas: string,
  before: Lanes,
  after: Lanes,
  opts: DescribeVersionOptions = {}
): VersionWords {
  const t0 = performance.now();
  let seen: LaneContext | null = null;
  const capture: LaneDescriber = (ctx) => {
    seen = ctx;
    return [];
  };
  const { css, collapse = true, lanes = [], ...rest } = opts;
  const r = describeChanges(canvas, before, after, {
    ...rest,
    lanes: [capture, cssLane(css), metaLane, annotationsLane, ...lanes],
  });
  if (!seen) return { changes: r.changes, detail: {}, labels: {}, ms: performance.now() - t0 };
  const ctx = seen as LaneContext;
  const labels: Record<string, string> = {};
  for (const m of [ctx.modelBefore, ctx.modelAfter])
    for (const a of m?.artboards ?? [])
      labels[a.key] = artboardLabel(m as NonNullable<typeof m>, a.key);
  if (!collapse) return { changes: r.changes, detail: {}, labels, ms: performance.now() - t0 };
  const c = collapseChanges(r.changes, {
    labelOf: (key) => {
      for (const m of [ctx.modelAfter, ctx.modelBefore])
        if (m?.artboards.some((a) => a.key === key)) return artboardLabel(m, key);
      return nameInWords(key) || 'Artboard';
    },
    elementCount: (key) => {
      const t = ctx.modelAfter?.tree(key);
      if (!t) return 0;
      let n = 0;
      walkEls(t, () => {
        n++;
      });
      return n;
    },
  });
  return {
    changes: c.changes,
    detail: Object.fromEntries(c.detail),
    labels,
    ms: performance.now() - t0,
  };
}
