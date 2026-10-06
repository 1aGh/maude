/**
 * @file       annotations/ops-merge.ts — wire the 3-way text merge into ops.ts
 * @scope      apps/studio/annotations/ops-merge.ts
 * @purpose    Side-effect import for SERVER entry points only (api, collab,
 *             codec, ai-write, the hub's accepted lane). `sync/source-merge.ts`
 *             needs the `diff` package, which the canvas iframe cannot resolve,
 *             so ops.ts takes the merge by injection instead of importing it.
 *             Never import this from anything in the canvas-lib graph —
 *             `test/canvas-lib-graph.test.ts` fails if `diff` gets back in.
 */

import { mergeSource } from '../sync/source-merge.ts';
import { setTextMerge } from './ops.ts';

setTextMerge(mergeSource);
