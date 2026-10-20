// S7.16 (07 · ve-long) — a 40-clip, 4-minute match: tracks fold to "Text · 18", a narrow block hides its name and says it on
// hover, ⌘K finds a clip by name. Folding is a per-viewer view (like "+ track"): nothing is written, nothing reaches a peer.
import { afterEach, describe, expect, test } from 'bun:test';
import { trackKey } from '../client/v2/timeline/advanced/advanced-store.js';
import { bindClips, clipSearchRows } from '../client/v2/timeline/clip-search.js';
import { createFoldStore, FOLD_WORDS, foldAtFollowed } from '../client/v2/timeline/fold.js';
import { defaultLabel, jumpTarget, sortedMarkers } from '../client/v2/timeline/markers.js';
import { clipTip, NAME_MIN_PX, nameVisible } from '../client/v2/timeline/zoom.js';

const memory = (initial: string | null = null) => {
  let text = initial;
  return {
    read: () => text,
    write: (t: string) => {
      text = t;
    },
    get text() {
      return text;
    },
  };
};
const AT = {
  file: 'ui/Zapas.tsx',
  artboardId: 'zapas',
  counts: { text: 18, gfx: 6, music: 1 },
  labels: { text: 'Text', gfx: 'Graphics', music: 'Music' },
};
const KEY = trackKey(AT.file, AT.artboardId);

describe('the fold store', () => {
  test('fold and show one track; the same call twice changes nothing', () => {
    const io = memory();
    const s = createFoldStore(io);
    expect(s.set(KEY, 'text', true)).toBe(true);
    expect(s.set(KEY, 'text', true)).toBe(false);
    expect(s.isFolded(KEY, 'text')).toBe(true);
    expect(s.isFolded(KEY, 'gfx')).toBe(false);
    expect(s.toggle(KEY, 'text')).toBe(true);
    expect(s.isFolded(KEY, 'text')).toBe(false);
  });

  test('the Video storyline cannot be folded (it is the video)', () => {
    const s = createFoldStore(memory());
    expect(s.set(KEY, 'video', true)).toBe(false);
    expect(s.isFolded(KEY, 'video')).toBe(false);
  });

  test('it is remembered in this browser, and tolerates whatever it finds there', () => {
    const io = memory();
    createFoldStore(io).set(KEY, 'gfx', true);
    expect(createFoldStore(memory(io.text)).isFolded(KEY, 'gfx')).toBe(true);
    expect(createFoldStore(memory('{not json')).isFolded(KEY, 'gfx')).toBe(false);
    expect(createFoldStore(memory('{"k":["nope","text"]}')).isFolded('k', 'text')).toBe(true);
    expect(createFoldStore(memory('{"k":["nope"]}')).isFolded('k', 'nope')).toBe(false);
  });

  test('subscribers hear a change, and only a change', () => {
    const s = createFoldStore(memory());
    let n = 0;
    s.subscribe(() => n++);
    s.set(KEY, 'text', true);
    s.set(KEY, 'text', true);
    expect(n).toBe(1);
  });
});

describe('timeline.fold-track', () => {
  test('a named track toggles, and the toast says which', () => {
    const s = createFoldStore(memory());
    expect(foldAtFollowed({ track: 'text' }, s, AT)).toBe('Text folded.');
    expect(s.isFolded(KEY, 'text')).toBe(true);
    expect(foldAtFollowed({ track: 'text' }, s, AT)).toBe('Text shown.');
    expect(foldAtFollowed({ track: 'text', folded: true }, s, AT)).toBe('Text folded.');
    expect(foldAtFollowed({ track: 'text', folded: true }, s, AT)).toBe('Text folded.');
    expect(s.isFolded(KEY, 'text')).toBe(true);
  });

  test('with no name it folds the busy tracks together (more than one thing), then shows them', () => {
    const s = createFoldStore(memory());
    expect(foldAtFollowed({}, s, AT)).toBe(FOLD_WORDS.allFolded);
    expect(s.isFolded(KEY, 'text')).toBe(true);
    expect(s.isFolded(KEY, 'gfx')).toBe(true);
    expect(s.isFolded(KEY, 'music')).toBe(false); // one thing: nothing to put away
    expect(foldAtFollowed({}, s, AT)).toBe(FOLD_WORDS.allShown);
    expect(s.isFolded(KEY, 'text')).toBe(false);
  });

  test('no video, a track that cannot fold, or nothing busy: a word, no write', () => {
    const io = memory();
    const s = createFoldStore(io);
    expect(foldAtFollowed({}, s, null)).toBe(FOLD_WORDS.none);
    expect(foldAtFollowed({ track: 'video' }, s, AT)).toBe(FOLD_WORDS.nothing);
    expect(foldAtFollowed({}, s, { ...AT, counts: { text: 1 } })).toBe(FOLD_WORDS.nothing);
    expect(io.text).toBeNull();
  });

  test('the folded line reads "Text · 18"', () => {
    expect(FOLD_WORDS.line('Text', 18)).toBe('Text · 18');
    expect(FOLD_WORDS.line('Graphics', 6)).toBe('Graphics · 6');
  });
});

describe('zoomed out', () => {
  test('a block narrower than the floor draws no name; a roomy one does', () => {
    expect(nameVisible(NAME_MIN_PX - 1)).toBe(false);
    expect(nameVisible(NAME_MIN_PX)).toBe(true);
    expect(nameVisible(Number.NaN)).toBe(false);
  });

  test('the hover line: name · the file it plays · how long', () => {
    expect(
      clipTip({ name: 'Akce 22', src: 'assets/caaftv-td-run.mp4', frames: 270, fps: 30 })
    ).toBe('Akce 22 · caaftv-td-run · 0:09');
    // a clip named like its file says it once
    expect(
      clipTip({ name: 'caaftv-td-run', src: 'assets/caaftv-td-run.mp4', frames: 90, fps: 30 })
    ).toBe('caaftv-td-run · 0:03');
    expect(clipTip({ name: 'Titulek', frames: 30, fps: 30 })).toBe('Titulek · 0:01');
  });
});

describe('⌘K finds a clip by name', () => {
  afterEach(() => bindClips(null));
  const CLIPS = [
    { id: 'a', name: 'Výkop', from: 0, frames: 300, src: 'assets/caaftv-kickoff.mp4' },
    { id: 'b', name: 'Akce 22', from: 300, frames: 270, src: 'assets/caaftv-td-run.mp4' },
  ];

  test('no video followed: no rows at all', () => {
    expect(clipSearchRows()).toEqual([]);
  });

  test('one row per clip, in the Clips group, by its name and its file', () => {
    bindClips({ fps: 30, clips: CLIPS, go: () => {} });
    const rows = clipSearchRows();
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['Výkop', 'Akce 22']);
    expect(rows[1]).toMatchObject({
      group: 'clips',
      id: 'clip:b',
      meta: 'Clip · 0:09 · at 0:10',
      searchRow: true,
      onlyWhenSearched: true,
    });
    expect(rows[1].keywords).toContain('caaftv-td-run');
  });

  test('picking a row hands the Timeline the clip to select and seek to', () => {
    const went: unknown[] = [];
    bindClips({ fps: 30, clips: CLIPS, go: (c: unknown) => went.push(c) });
    clipSearchRows()[1].run();
    expect(went).toEqual([CLIPS[1]]);
  });

  test('the same clips with a new closure keep the rows (and the latest go runs)', () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    bindClips({ fps: 30, clips: CLIPS, go: (c: unknown) => first.push(c) });
    bindClips({ fps: 30, clips: CLIPS, go: (c: unknown) => second.push(c) });
    clipSearchRows()[0].run();
    expect(first).toEqual([]);
    expect(second).toEqual([CLIPS[0]]);
  });
});

describe('markers (the pure half)', () => {
  const M = [
    { t: 202, label: 'TD 2' },
    { t: 14, label: 'Výkop' },
    { t: 44, label: 'TD 1' },
    { t: 98, label: 'Poločas' },
  ];

  test('time order; bad ones dropped; two at one moment keep the later write', () => {
    expect(sortedMarkers(M).map((m) => m.label)).toEqual(['Výkop', 'TD 1', 'Poločas', 'TD 2']);
    expect(sortedMarkers([{ t: -1, label: 'x' }, { t: Number.NaN, label: 'y' }, null])).toEqual([]);
    expect(
      sortedMarkers([
        { t: 5, label: 'a' },
        { t: 5, label: 'b' },
      ])
    ).toEqual([{ t: 5, label: 'b' }]);
  });

  test('jump goes to the next and the previous; standing on one jumps past it', () => {
    expect(jumpTarget(M, 0, 1)?.label).toBe('Výkop');
    expect(jumpTarget(M, 14, 1)?.label).toBe('TD 1');
    expect(jumpTarget(M, 133, -1)?.label).toBe('Poločas');
    expect(jumpTarget(M, 98, -1)?.label).toBe('TD 1');
    expect(jumpTarget(M, 202, 1)).toBeNull();
    expect(jumpTarget(M, 14, -1)).toBeNull();
    expect(jumpTarget([], 3, 1)).toBeNull();
  });

  test('the default name counts', () => {
    expect(defaultLabel(M)).toBe('Marker 5');
    expect(defaultLabel([])).toBe('Marker 1');
  });
});
