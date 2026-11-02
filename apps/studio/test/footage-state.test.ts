// S7.16 (07 · ve-footage) — footage that is not here yet is QUIET, footage that no device has is Missing, and a 4K clip
// still preparing shows its percent. The words are asset-placeholder.tsx's (S8.19) — a name only, never an address.
import { afterEach, describe, expect, test } from 'bun:test';
import { clearAssetAnswers, createAssetStateLane } from '../client/v2/assets/asset-state-lane.js';
import {
  clipNameWithState,
  FOOTAGE_WORDS,
  fileNameOf,
  footageForSrc,
  footageInspector,
  footageOf,
  preparingChip,
  preparingCount,
} from '../client/v2/timeline/footage-state.js';

const JONAS = { name: 'jonas', kind: 'mac', self: false };
afterEach(() => clearAssetAnswers());

describe('waiting is not missing', () => {
  test('a file on Jonas’s Mac: waiting, with his name, no Relink', () => {
    const f = footageOf({ rel: 'assets/a.mov', state: 'waiting', who: JONAS });
    expect(f).toEqual({
      kind: 'waiting',
      line: "Waiting for Jonas's Mac",
      pct: null,
      relink: false,
    });
  });

  test('a file no device has: missing, and the only state that offers Relink…', () => {
    const f = footageOf({ rel: 'assets/a.mov', state: 'missing' });
    expect(f?.kind).toBe('missing');
    expect(f?.relink).toBe(true);
  });

  test('uncertain is "Not here yet", never missing; an e-mail is never said', () => {
    expect(footageOf({ rel: 'a', state: 'waiting' })?.line).toBe('Not here yet');
    const mail = footageOf({
      rel: 'a',
      state: 'waiting',
      who: { name: 'j@x.cz', kind: 'mac', self: false },
    });
    expect(mail?.line).toBe('Not here yet');
    expect(mail?.kind).toBe('waiting');
  });

  test('here, unknown and nothing at all say nothing', () => {
    expect(footageOf({ rel: 'a', state: 'here' })).toBeNull();
    expect(footageOf({ rel: 'a', state: 'unknown' as never })?.kind).not.toBe('missing');
    expect(footageOf(null)).toBeNull();
    expect(footageOf(undefined)).toBeNull();
  });
});

describe('the clip’s words', () => {
  test('the name carries the state: "Dron klesá · waiting for Jonas’s Mac"', () => {
    const f = footageOf({ rel: 'a', state: 'waiting', who: JONAS });
    expect(clipNameWithState('Dron klesá', f)).toBe("Dron klesá · waiting for Jonas's Mac");
    expect(clipNameWithState('Dron klesá', null)).toBe('Dron klesá');
    expect(clipNameWithState('Dron klesá', footageOf({ rel: 'a', state: 'missing' }))).toBe(
      'Dron klesá · missing'
    );
  });

  test('a preparing clip keeps its name and shows a percent chip', () => {
    const f = footageOf({ rel: 'a', state: 'uploading', progress: 0.62 });
    expect(f).toMatchObject({ kind: 'preparing', pct: 62 });
    expect(clipNameWithState('IMG_4471.mov · 4K', f)).toBe('IMG_4471.mov · 4K');
    expect(preparingChip(f)).toBe('62%');
    expect(preparingChip(footageOf({ rel: 'a', state: 'uploading' }))).toBe('…');
    expect(preparingChip(footageOf({ rel: 'a', state: 'uploading', progress: 0 }))).toBe('0%');
    expect(preparingChip(null)).toBeNull();
  });

  test('the header counts the clips still preparing', () => {
    const p = footageOf({ rel: 'a', state: 'uploading', progress: 0.1 });
    const w = footageOf({ rel: 'b', state: 'waiting' });
    expect(preparingCount([p, p, p, w, null])).toBe(3);
    expect(FOOTAGE_WORDS.preparing(3)).toBe('3 clips still preparing');
    expect(FOOTAGE_WORDS.preparing(1)).toBe('1 clip still preparing');
  });
});

describe('the Inspector', () => {
  test('waiting: File, Status and "Your edit is safe. It plays once the file arrives."', () => {
    const f = footageOf({ rel: 'a', state: 'waiting', who: JONAS });
    const v = footageInspector('assets/dron-areal-klesani-9s.mov', f);
    expect(v.rows).toEqual([
      ['File', 'dron-areal-klesani-9s.mov'],
      ['Status', "Waiting for Jonas's Mac"],
    ]);
    expect(v.note).toBe('Your edit is safe. It plays once the file arrives.');
    expect(v.advanced).toEqual([['status', "waiting · on Jonas's Mac"]]);
    expect(v.relink).toBe(false);
  });

  test('missing: the safe line names the one verb, and Relink… is offered', () => {
    const v = footageInspector('assets/a.mov', footageOf({ rel: 'a', state: 'missing' }));
    expect(v.note).toContain('Relink');
    expect(v.relink).toBe(true);
    expect(v.advanced).toEqual([['status', 'missing']]);
  });

  test('here: nothing', () => {
    expect(footageInspector('assets/a.mov', null)).toMatchObject({
      rows: [],
      note: null,
      advanced: [],
    });
  });

  test('a file name is the last piece of the src', () => {
    expect(fileNameOf('assets/9f3a.mov?v=2')).toBe('9f3a.mov');
  });
});

describe('the studio’s answer reaches the clip', () => {
  test('lane answer → footageForSrc by the canvas and the clip’s src; here again → nothing', async () => {
    const items: Array<Record<string, unknown>> = [
      { rel: 'assets/9f3a.mov', state: 'waiting', who: JONAS },
    ];
    const frame = {
      contentWindow: { postMessage: () => {} },
      getAttribute: () => 'ui/Touchdown.tsx',
    };
    const lane = createAssetStateLane({
      win: { addEventListener: () => {}, removeEventListener: () => {} } as unknown as Window,
      frames: () => [frame as unknown as Element],
      canvasOrigin: () => 'http://127.0.0.1:1',
      setTimer: () => 1,
      clearTimer: () => {},
      fetchImpl: (async () =>
        new Response(JSON.stringify({ items }), { status: 200 })) as unknown as typeof fetch,
    });
    await lane.refresh();
    expect(footageForSrc('ui/Touchdown.tsx', './assets/9f3a.mov?v=1')?.kind).toBe('waiting');
    expect(footageForSrc('ui/Other.tsx', 'assets/9f3a.mov')).toBeNull();
    items[0] = { rel: 'assets/9f3a.mov', state: 'here' };
    await lane.refresh();
    expect(footageForSrc('ui/Touchdown.tsx', 'assets/9f3a.mov')).toBeNull();
    lane.stop();
  });

  test('a refused answer (offline, a cell) is the quiet state — never Missing', async () => {
    const frame = {
      contentWindow: { postMessage: () => {} },
      getAttribute: () => 'ui/Touchdown.tsx',
    };
    const lane = createAssetStateLane({
      win: { addEventListener: () => {}, removeEventListener: () => {} } as unknown as Window,
      frames: () => [frame as unknown as Element],
      canvasOrigin: () => 'http://127.0.0.1:1',
      setTimer: () => 1,
      clearTimer: () => {},
      fetchImpl: (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch,
    });
    await lane.refresh();
    expect(footageForSrc('ui/Touchdown.tsx', 'assets/9f3a.mov')).toBeNull();
    lane.stop();
  });
});
