// p8 c7 — the review / switch sheets' rows find their canvas's cover in the project index.
import { describe, expect, test } from 'bun:test';
import { coverUrlOf } from '../client/v2/ds/use-covers.js';

const index = {
  canvases: [
    { rel: 'ui/Homepage.tsx', cover: { key: 'abc' } },
    { rel: 'ui/Landing.tsx', cover: null },
  ],
};

describe('coverUrlOf', () => {
  test('a canvas with a cover → its thumb route', () => {
    expect(coverUrlOf(index, 'ui/Homepage.tsx')).toBe('/_api/thumb/abc');
    expect(coverUrlOf(index, '.design/ui/Homepage.tsx')).toBe('/_api/thumb/abc');
  });
  test('no cover yet, an unknown canvas or no index → null (the empty tile)', () => {
    expect(coverUrlOf(index, 'ui/Landing.tsx')).toBeNull();
    expect(coverUrlOf(index, 'ui/Missing.tsx')).toBeNull();
    expect(coverUrlOf(null, 'ui/Homepage.tsx')).toBeNull();
    expect(coverUrlOf(index, '')).toBeNull();
  });
});
