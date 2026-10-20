// S7.15 — the AI cut's chat cards (07 · ve-ai-watch, ve-ai-cut, ve-ai-scrub, ve-ai-proposal): the footage line,
// "Watching 12 clips… 7 done" with what AI liked, "Watched all 12. Left out 3: …", and Use them anyway. Every
// word is built from the run's derived `progress`; the model's label never reaches a card. The derivation itself
// (files → progress) is pinned in watch-progress-derive.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { registerRunCard, runCardFor, runCardKinds } from '../client/v2/ai/run-cards.js';
import { ringsFor, TAG_WATCHING } from '../client/v2/ai/runs-model.js';
import {
  anywayAsk,
  clipsAttachedModel,
  leftOutModel,
  leftOutSentence,
  mmss,
  nameList,
  watchModel,
} from '../client/v2/ai/video/card-model.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const A = (i: number) => `assets/a000000${i}.mp4`;
const NAMES = ['caaftv-td-run', 'caaftv-tackle', 'promo-runout-vlajka', 'archiv08-akce-1'];
const WATCH = {
  kind: 'watch',
  done: 2,
  total: 4,
  label: 'Watching 4 clips… 2 done',
  footageSec: 80,
  clips: NAMES.map((name, i) => ({
    asset: A(i),
    name,
    state: i < 2 ? 'done' : i === 2 ? 'now' : 'wait',
  })),
  found: [
    { asset: A(0), name: NAMES[0], at: 3, line: 'Touchdown run — caaftv-td-run' },
    { asset: A(1), name: NAMES[1], at: 2, line: 'The hardest hit — caaftv-tackle' },
  ],
};
const PLACE = {
  kind: 'place',
  done: 7,
  total: 14,
  label: 'Placing shots — 7 of 14',
  watched: 12,
  footageSec: 80,
  leftOut: [
    { asset: A(1), name: 'archiv-orange-nastup', why: 'too dark' },
    { asset: A(2), name: 'promo-kabina', why: 'too dark' },
    { asset: A(3), name: 'dron-areal-klesani', why: 'shaky' },
  ],
};

describe('the words, from the numbers and the footage’s own notes', () => {
  test('m:ss and the name list', () => {
    expect([mmss(3), mmss(65), mmss(4210)]).toEqual(['0:03', '1:05', '1:10:10']);
    expect([nameList(['a']), nameList(['a', 'b']), nameList(['a', 'b', 'c'])]).toEqual([
      'a',
      'a and b',
      'a, b and c',
    ]);
  });

  test('the footage line: count, length of all of it, where it came from', () => {
    expect(clipsAttachedModel(WATCH)).toMatchObject({
      title: '4 clips',
      meta: '1:20 of footage · from Assets',
    });
    expect(clipsAttachedModel({ ...WATCH, footageSec: undefined })?.meta).toBe('from Assets');
    expect(clipsAttachedModel(PLACE)).toMatchObject({ title: '12 clips' });
    expect(clipsAttachedModel(undefined)).toBeNull();
    expect(clipsAttachedModel({ kind: 'place', done: 1, total: 3 })).toBeNull();
  });

  test('the watch card: the title from the run, a tile per clip, the last three found lines as m:ss', () => {
    const m = watchModel({
      ...WATCH,
      found: [...WATCH.found, ...WATCH.found.map((f, i) => ({ ...f, asset: A(i + 2), at: 5 }))],
    });
    expect(m?.title).toBe('Watching 4 clips… 2 done');
    expect(m?.tiles.map((t) => t.state)).toEqual(['done', 'done', 'now', 'wait']);
    expect(m?.found).toHaveLength(3);
    expect(m?.found[0]).toMatchObject({ at: '0:02' });
    expect(watchModel(PLACE)).toBeNull();
  });

  test('left out, grouped by the note of the footage, in the order dropped', () => {
    expect(leftOutSentence(PLACE.leftOut)).toBe(
      'archiv-orange-nastup and promo-kabina are too dark; dron-areal-klesani is shaky'
    );
    expect(leftOutSentence([{ asset: A(0), name: 'solo' }])).toBe('solo had no usable shot');
  });

  test('while shots land: "Watched all 12. Left out 3: …"; once ended: "Left out: …" and the way back', () => {
    expect(leftOutModel(PLACE, { ended: false })?.text).toBe(
      'Watched all 12. Left out 3: archiv-orange-nastup and promo-kabina are too dark; dron-areal-klesani is shaky.'
    );
    expect(leftOutModel(PLACE, { ended: true })?.text).toBe(
      'Left out: archiv-orange-nastup and promo-kabina are too dark; dron-areal-klesani is shaky.'
    );
    // nothing left out: the first says so quietly, the second says nothing
    expect(leftOutModel({ ...PLACE, leftOut: [] }, { ended: false })?.text).toBe('Watched all 12.');
    expect(leftOutModel({ ...PLACE, leftOut: [] }, { ended: true })).toBeNull();
    expect(leftOutModel(WATCH, { ended: false })).toBeNull();
  });

  test('Use them anyway is a new ask that names them', () => {
    expect(anywayAsk(PLACE.leftOut)).toBe(
      'Use archiv-orange-nastup, promo-kabina and dron-areal-klesani anyway.'
    );
    expect(anywayAsk([])).toBe('');
  });
});

describe('run cards by kind (append-only)', () => {
  test('watch and place are registered; a kind keeps the first card it was given', () => {
    // the cards register themselves when the run surface loads
    return import('../client/v2/ai/video/cards.jsx').then(({ WatchCard, PlaceCard }) => {
      expect(runCardKinds()).toEqual(expect.arrayContaining(['watch', 'place']));
      expect(runCardFor('watch')).toBe(WatchCard);
      expect(runCardFor('place')).toBe(PlaceCard);
      const other = () => null;
      expect(registerRunCard('watch', other)).toBe(false);
      expect(runCardFor('watch')).toBe(WatchCard);
      expect(registerRunCard('watch', WatchCard)).toBe(true); // the same one again is fine
      expect(runCardFor('nope')).toBeNull();
      expect(registerRunCard('', other)).toBe(false);
    });
  });

  test('the run surface draws the card of the run’s progress kind, at the top and at the tail', () => {
    const src = readFileSync(
      path.join(import.meta.dir, '..', 'client', 'v2', 'ai', 'RunSurface.jsx'),
      'utf8'
    );
    expect(src).toContain('runCardFor(run?.progress?.kind)');
    expect(src).toContain("kindCard('top')");
    expect(src).toContain("kindCard('tail')");
  });
});

describe('the cards as a person meets them', () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  const draw = async (kind: string, props: Record<string, unknown>) => {
    const { WatchCard, PlaceCard } = await import('../client/v2/ai/video/cards.jsx');
    const Card = kind === 'watch' ? WatchCard : PlaceCard;
    await act(async () => {
      root.render(h(Card, { designRel: '.design', ...props } as never));
    });
  };

  test('watching: the footage line, the grid with a tick / spark / dimmed tile, the found lines', async () => {
    await draw('watch', {
      run: { progress: WATCH, label: 'Watched all 4. Left out 0.' },
      where: 'top',
    });
    expect(host.querySelector('[data-testid="ai-clips-attached"]')?.textContent).toContain(
      '4 clips'
    );
    expect(host.querySelector('[data-testid="ai-watch-title"]')?.textContent).toBe(
      'Watching 4 clips… 2 done'
    );
    const tiles = [...host.querySelectorAll('.ai-vwatch li')];
    expect(tiles.map((t) => t.getAttribute('data-state'))).toEqual(['done', 'done', 'now', 'wait']);
    expect(tiles[3]?.className).toContain('ai-vwatch-c--wait');
    expect(tiles[0]?.getAttribute('aria-label')).toBe('caaftv-td-run: watched');
    expect(host.querySelector('video')?.getAttribute('src')).toBe(
      '/.design/assets/a0000000.mp4#t=0.1'
    );
    expect(host.querySelector('[data-testid="ai-watch-found"]')?.textContent).toContain(
      '0:03Touchdown run — caaftv-td-run'
    );
    // the model’s own label never reaches the card
    expect(host.textContent).not.toContain('Left out 0');
  });

  test('watching draws nothing at the tail', async () => {
    await draw('watch', { run: { progress: WATCH }, where: 'tail' });
    expect(host.textContent).toBe('');
  });

  test('landing: the footage line and the "Watched all 12" message, no button yet', async () => {
    await draw('place', { run: { progress: PLACE }, where: 'top', ended: false });
    expect(host.querySelector('[data-testid="ai-left-out-live"]')?.textContent).toContain(
      'Watched all 12. Left out 3'
    );
    expect(host.querySelector('[data-testid="ai-left-out-use"]')).toBeNull();
  });

  test('done: Left out + Use them anyway sends the ask', async () => {
    const asks: string[] = [];
    await draw('place', {
      run: { progress: PLACE },
      where: 'tail',
      ended: true,
      onAsk: (t: string) => asks.push(t),
    });
    expect(host.querySelector('[data-testid="ai-left-out"]')?.textContent).toContain('Left out: ');
    const btn = host.querySelector('[data-testid="ai-left-out-use"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Use them anyway');
    await act(async () => {
      btn.click();
    });
    expect(asks).toEqual(['Use archiv-orange-nastup, promo-kabina and dron-areal-klesani anyway.']);
  });

  test('done with nothing left out: no row', async () => {
    await draw('place', {
      run: { progress: { ...PLACE, leftOut: [] } },
      where: 'tail',
      ended: true,
    });
    expect(host.textContent).toBe('');
  });
});

describe('the ring under the new artboard', () => {
  const run = (progress: unknown) => ({
    runId: 'r1',
    state: 'running',
    label: 'Say placing shot 14 of 14',
    scope: { canvas: 'ui/Recap.tsx', artboards: ['recap'] },
    leases: [{ canvas: 'path:.design/ui/Recap.tsx', artboard: 'recap', token: 1 }],
    waiting: [],
    progress,
  });
  test('"AI is watching footage" while clips are still being watched; the label never reaches it', () => {
    const rings = ringsFor(
      { mine: [run(WATCH)], others: [] },
      { activeCanvas: '.design/ui/Recap.tsx' }
    );
    expect(rings.recap?.tag).toBe(TAG_WATCHING);
    expect(TAG_WATCHING).toBe('AI is watching footage');
    expect(JSON.stringify(rings)).not.toContain('Say placing');
    // all watched, no shot yet: back to the plain tag
    const done = ringsFor(
      { mine: [run({ ...WATCH, done: 4, label: 'Watched all 4.' })], others: [] },
      { activeCanvas: '.design/ui/Recap.tsx' }
    );
    expect(done.recap?.tag).toBe('AI is working');
  });
});
