// P8 stage C round 8 (14 ed-inspector): a button / frame that holds text of its own shows the Style row in its Type
// group ("Aa Link"), like a text object does; a frame with no text of its own does not.
import { beforeAll, describe, expect, test } from 'bun:test';

import '../client/v2/inspector/sections/index.js';
import { slotsFor } from '../client/v2/inspector/slots.js';

const ids = (kind: string, selection: unknown) =>
  slotsFor('type', kind, selection, undefined).map((s: { id: string }) => s.id);

// The slot registry is process-wide and the section modules register ONCE, when first imported. A file that
// ran earlier in the same bun process and called `unregisterSections()` leaves this one with no Type slots
// (the import above is a cache hit). So this file takes whatever is left of the text slots out and registers
// its own copy from a fresh evaluation of the module. That copy STAYS registered afterwards (it is the same bodies
// the first import would have left), so a later file in the run still finds the text slots.
beforeAll(async () => {
  const original = await import('../client/v2/inspector/kinds/text.jsx');
  original.offTextStyle();
  original.offTextBody();
  await import('../client/v2/inspector/kinds/text.jsx?p8-c8-edit-frame-style');
});
describe('14 ed-inspector: the Style row of a frame that holds text', () => {
  test('a frame with textInfo gets type.style; one without does not', () => {
    expect(ids('frame', { textInfo: { role: null, differs: [] } })).toContain('type.style');
    expect(ids('frame', { tag: 'div' })).not.toContain('type.style');
    expect(ids('frame', [{ textInfo: {} }, { textInfo: {} }])).not.toContain('type.style');
  });
  test('a button that holds text gets it too', () => {
    expect(ids('button', { textInfo: { role: null, differs: [] } })).toContain('type.style');
    expect(ids('button', { tag: 'button' })).not.toContain('type.style');
  });
  test('a text object keeps it', () => {
    expect(ids('text', { tag: 'p' })).toContain('type.style');
  });
});
