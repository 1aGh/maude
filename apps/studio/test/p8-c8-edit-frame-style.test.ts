// P8 stage C round 8 (14 ed-inspector): a button / frame that holds text of its own shows the Style row in its Type
// group ("Aa Link"), like a text object does; a frame with no text of its own does not.
import { afterAll, describe, expect, test } from 'bun:test';

import '../client/v2/inspector/sections/index.js';
import { slotsFor } from '../client/v2/inspector/slots.js';

const ids = (kind: string, selection: unknown) =>
  slotsFor('type', kind, selection, undefined).map((s: { id: string }) => s.id);

afterAll(async () => {
  const { unregisterSections } = await import('../client/v2/inspector/sections/index.js');
  unregisterSections();
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
