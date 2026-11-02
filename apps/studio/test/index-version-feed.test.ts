// A6c-2 / S8.11 — a version recorded after the history scan joins the asset index (noteVersion).
import { describe, expect, test } from 'bun:test';

import { feedVersionsToIndex, type VersionFeedRuntime } from '../index/version-feed.ts';

function setup(rt: VersionFeedRuntime | null) {
  const noted: Array<{ canvas: string; ref: string; lanes: unknown }> = [];
  const subs = new Map<string, (p: unknown) => void>();
  const feed = feedVersionsToIndex({
    control: () => rt,
    designRel: '.design',
    index: { noteVersion: (canvas, ref, lanes) => noted.push({ canvas, ref, lanes }) },
    on: (ev, fn) => subs.set(ev, fn),
  });
  return { noted, feed, emit: (p: unknown) => subs.get('project:action')?.(p) };
}

describe('feedVersionsToIndex', () => {
  test('an accepted action notes each touched canvas version with its three lanes', async () => {
    const reads: string[] = [];
    const s = setup({
      async acceptedVersion(repoRel, rev, lane) {
        reads.push(`${repoRel}@${rev}:${lane}`);
        return lane === 'html' ? '<img src="../assets/aaaaaaaa.png">' : null;
      },
    });
    s.emit({ revision: 7, canvases: ['ui/a.tsx', 'ui/readme.md'] });
    await s.feed.settled();
    expect(s.noted).toEqual([
      {
        canvas: 'ui/a.tsx',
        ref: 'r7',
        lanes: { html: '<img src="../assets/aaaaaaaa.png">', css: null, meta: null },
      },
    ]);
    expect(reads).toContain('.design/ui/a.tsx@7:css');
  });

  test('a home with no history, a malformed action or an unreachable read notes nothing', async () => {
    const none = setup(null);
    none.emit({ revision: 1, canvases: ['ui/a.tsx'] });
    await none.feed.settled();
    expect(none.noted).toEqual([]);

    const bad = setup({ acceptedVersion: async () => 'x' });
    bad.emit({ canvases: ['ui/a.tsx'] });
    bad.emit({ revision: 2 });
    bad.emit(null);
    await bad.feed.settled();
    expect(bad.noted).toEqual([]);

    const down = setup({
      acceptedVersion: async () => {
        throw new Error('hub down');
      },
    });
    down.emit({ revision: 3, canvases: ['ui/a.tsx'] });
    await down.feed.settled();
    expect(down.noted).toEqual([]);
  });
});
