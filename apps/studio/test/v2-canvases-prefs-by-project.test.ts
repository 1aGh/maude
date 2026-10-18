// S1.1 — the Canvases sort is remembered per PROJECT. The prefs-follow-port bug (inventory): a preference
// keyed by the page's origin followed the port away, so the next launch (a new port) lost it and a second
// project on the same port inherited it. The key is the project id the index mints, nothing else.
import { afterEach, describe, expect, test } from 'bun:test';

import {
  DEFAULT_SORT,
  isProjectId,
  readSortPref,
  SORT_PREF_KEY,
  sortPrefPatch,
} from '../client/v2/canvases/sort.js';

const A = 'l0123456789abcdef';
const B = 'lfedcba9876543210';

const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
afterEach(() => {
  if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
  else Reflect.deleteProperty(globalThis, 'location');
});
const onPort = (port: string) =>
  Object.defineProperty(globalThis, 'location', {
    value: { port, origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` },
    configurable: true,
  });

describe('the stored sort', () => {
  const prefs = {
    [SORT_PREF_KEY]: {
      [A]: { by: 'name', foldersOnTop: false },
      [B]: { by: 'kind', foldersOnTop: true },
    },
    theme: 'dark',
  };

  test('one entry per project in one map', () => {
    expect(readSortPref(prefs, A)).toEqual({ by: 'name', foldersOnTop: false });
    expect(readSortPref(prefs, B)).toEqual({ by: 'kind', foldersOnTop: true });
    expect(readSortPref(prefs, 'l0000000000000000')).toEqual(DEFAULT_SORT);
  });

  test('the same project reads the same sort on any port (a relaunch picks a new one)', () => {
    onPort('4399');
    const first = readSortPref(prefs, A);
    onPort('51877');
    expect(readSortPref(prefs, A)).toEqual(first);
    expect(sortPrefPatch(A, first)).toEqual({ canvasesSort: { [A]: first } });
    onPort('51878');
    expect(sortPrefPatch(A, first)).toEqual({ canvasesSort: { [A]: first } });
  });

  test('two projects on one port do not share a sort', () => {
    onPort('4399');
    expect(readSortPref(prefs, A)).not.toEqual(readSortPref(prefs, B));
  });

  test('a project that is not identified yet reads the default and writes nothing', () => {
    expect(readSortPref(prefs, null)).toEqual(DEFAULT_SORT);
    expect(readSortPref(prefs, '')).toEqual(DEFAULT_SORT);
    expect(sortPrefPatch(null, DEFAULT_SORT)).toBeNull();
    expect(sortPrefPatch(undefined, DEFAULT_SORT)).toBeNull();
  });

  test('a patch carries this project only, and only a valid sort', () => {
    expect(sortPrefPatch(A, { by: 'colour', foldersOnTop: 3 })).toEqual({
      canvasesSort: { [A]: DEFAULT_SORT },
    });
    expect(isProjectId('../etc')).toBe(false);
    expect(isProjectId('__proto__')).toBe(false);
    expect(isProjectId('constructor')).toBe(false);
  });

  test('prefs that are not an object, or a map that is not, read the default', () => {
    expect(readSortPref(null, A)).toEqual(DEFAULT_SORT);
    expect(readSortPref({ canvasesSort: [] }, A)).toEqual(DEFAULT_SORT);
    expect(readSortPref({ canvasesSort: { [A]: 'name' } }, A)).toEqual(DEFAULT_SORT);
  });
});
