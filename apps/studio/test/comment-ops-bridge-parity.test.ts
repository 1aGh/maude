// The dgn bridge's COMMENT_OPS allowlist must name exactly the ops the comment door takes
// (comments/ops.ts OP_NAMES). They drifted once: `reattach` was added to the door but the bridge
// refused it, so the Re-attach button silently did nothing (#151 T2.3).
import { expect, test } from 'bun:test';
import { COMMENT_OPS } from '../bridge/dgn-protocol.ts';
import { OP_NAMES } from '../comments/ops.ts';

test('the bridge comment allowlist equals the comment door ops', () => {
  expect([...COMMENT_OPS].sort()).toEqual([...OP_NAMES].sort());
});
