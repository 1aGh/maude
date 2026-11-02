// Gate (wave B): `stashSlots()` restore keeps bodies a section module registered WHILE stashed. Those register
// once, at import; dropping them on restore left every later test file in the process with no Position / Size /
// Layout bodies (v2-inspector-render then v2-inspector-sections: 26 red, only when batched).
import { expect, test } from 'bun:test';

import { registerSlot, slotsFor, stashSlots } from '../client/v2/inspector/slots.js';

const Body = () => null;

test('a body registered during the stash survives the restore; one taken back does not', () => {
  const offBefore = registerSlot('position', { id: 'stash-before', Body });
  const restore = stashSlots();
  expect(slotsFor('position', 'element', []).some((e) => e.id === 'stash-before')).toBe(false);
  const offKept = registerSlot('position', { id: 'stash-during', Body, order: 1 });
  const offGone = registerSlot('position', { id: 'stash-during-off', Body });
  offGone();
  restore();
  const ids = slotsFor('position', 'element', []).map((e) => e.id);
  expect(ids).toContain('stash-before');
  expect(ids).toContain('stash-during');
  expect(ids).not.toContain('stash-during-off');
  expect(ids.indexOf('stash-during')).toBeLessThan(ids.indexOf('stash-before'));
  offKept();
  offBefore();
  expect(slotsFor('position', 'element', []).map((e) => e.id)).not.toContain('stash-during');
});
