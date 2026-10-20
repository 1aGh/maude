// S8.14 — photos dropped from Finder (or added with Image I): the plan (place-plan.ts), its words, and the server write
// (`image.place` mode "auto" + emptyOnly). Six photos fill six empty frames in order; with none empty they become a tidy
// grid; one photo is put in loose. The canvas draws the hint with the same plan function the server writes with.

import { describe, expect, test } from 'bun:test';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { dropHint, planPlacement } from '../edit-ops/place-plan.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { walkIdElements } from '../element-ids.ts';

const FILE = 'ui/Match.tsx';
const SIX = [1, 2, 3, 4, 5, 6].map((n) => `assets/d000000${n}.jpg`);
const EMPTY6 = [1, 2, 3, 4, 5, 6]
  .map((n) => `<img data-cd-id="cell-${n}" alt="" />`)
  .join('\n          ');

const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Match() {
  return (
    <DesignCanvas>
      <DCArtboard id="match" label="Fotky ze zápasu" width={1080} height={1350}>
        <div data-cd-id="grid">
          ${EMPTY6}
        </div>
      </DCArtboard>
      <DCArtboard id="bare" label="Bare" width={400} height={400}>
        <div data-cd-id="title">ZÁPAS</div>
      </DCArtboard>
      <DCArtboard id="mixed" label="Mixed" width={400} height={400}>
        <div data-cd-id="row">
          <img data-cd-id="done" src="assets/aaaaaaaa.jpg" alt="" />
          <img data-cd-id="hole-a" src="" alt="" />
          <img data-cd-id="locked-hole" data-cd-locked alt="" />
          <img alt="" />
          <img data-cd-id="hole-c" alt="" />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial = SRC) {
  const files = new Map<string, string>([[FILE, initial]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      files.set(rel, after);
    },
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (artboard: string, params: Record<string, unknown>, target?: string) =>
    dispatchEditOp(
      {
        file: FILE,
        op: 'image.place',
        targets: target ? [{ artboard, element: target }] : [],
        params: target ? params : { ...params, artboard },
      },
      deps
    );
  return { run, src: () => files.get(FILE) as string };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const tagOf = (src: string, id: string): string => {
  const w = walkIdElements(src, FILE);
  if (!w.ok) throw new Error(w.error);
  const e = w.elements.find((x) => x.id === id);
  if (!e) throw new Error(`no ${id}`);
  return src.slice(e.start, e.end);
};

describe('the plan', () => {
  test('empty frames win, then a tidy grid, then loose', () => {
    expect(planPlacement('artboard', 6, 6)).toEqual({ mode: 'fill-in-order', fills: 6, rest: 0 });
    expect(planPlacement('artboard', 6, 2)).toEqual({ mode: 'fill-in-order', fills: 2, rest: 4 });
    expect(planPlacement('artboard', 1, 3)).toEqual({ mode: 'fill-in-order', fills: 1, rest: 0 });
    expect(planPlacement('artboard', 6, 0).mode).toBe('grid');
    expect(planPlacement('artboard', 1, 0).mode).toBe('loose');
    expect(planPlacement('frame', 1, 0).mode).toBe('fill');
    expect(planPlacement('frame', 3, 0).mode).toBe('grid');
    expect(planPlacement('picture', 1, 0).mode).toBe('fill');
  });
  test('the hint names what will happen', () => {
    expect(dropHint('artboard', 6, 6)).toBe('Drop to fill 6 empty frames in order');
    expect(dropHint('artboard', 1, 3)).toBe('Drop to fill the empty frame');
    expect(dropHint('artboard', 6, 2)).toBe(
      'Drop to fill 2 empty frames in order, then place 4 more'
    );
    expect(dropHint('artboard', 6, 0)).toBe('Drop to place 6 photos in a tidy grid');
    expect(dropHint('artboard', 1, 0)).toBe('Drop to place the photo here');
    expect(dropHint('frame', 1, 0)).toBe('Drop to fill the frame');
    expect(dropHint('picture', 1, 0)).toBe('Drop to replace the photo');
    // the browser hid the list (a count of 0): still honest
    expect(dropHint('artboard', 0, 0)).toBe('Drop to place the photo here');
    expect(dropHint('artboard', 0, 4)).toBe('Drop to fill 4 empty frames in order');
  });
});

describe('image.place mode auto', () => {
  test('six photos fill six empty frames in order, and every filled slot is reported for the selection', async () => {
    const h = harness();
    const r = good(await h.run('match', { assets: SIX, mode: 'auto' }));
    for (const [i, a] of SIX.entries())
      expect(tagOf(h.src(), `cell-${i + 1}`)).toContain(`src="${a}"`);
    expect(r.created?.map((c) => c.element)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `cell-${n}`));
  });

  test('a picture that already shows something is never replaced; locked and non-empty holes are skipped', async () => {
    const h = harness();
    const r = good(await h.run('mixed', { assets: SIX.slice(0, 3), mode: 'auto' }));
    expect(tagOf(h.src(), 'done')).toContain('src="assets/aaaaaaaa.jpg"');
    expect(tagOf(h.src(), 'locked-hole')).not.toContain('src=');
    expect(tagOf(h.src(), 'hole-a')).toContain(`src="${SIX[0]}"`);
    expect(r.created?.length).toBe(3);
    // the second empty slot had no id: it got one, and it is the one selected
    const second = r.created?.[1]?.element as string;
    expect(tagOf(h.src(), second)).toContain(`src="${SIX[1]}"`);
    expect(tagOf(h.src(), 'hole-c')).toContain(`src="${SIX[2]}"`);
  });

  test('more photos than empty frames: the empty ones fill, the rest go in after', async () => {
    const h = harness();
    const r = good(await h.run('mixed', { assets: SIX, mode: 'auto' }));
    expect(r.created?.length).toBe(6);
    expect(h.src().match(/src="assets\/d000000\d\.jpg"/g)?.length).toBe(6);
  });

  test('no empty frame: several photos become one tidy grid, one photo goes in loose', async () => {
    const h = harness();
    const g = good(await h.run('bare', { assets: SIX.slice(0, 4), mode: 'auto' }));
    expect(h.src()).toContain('gridTemplateColumns');
    expect(h.src()).toContain('"repeat(2, 1fr)"');
    expect(g.created?.length).toBe(5); // the wrapper + four pictures
    const l = good(await h.run('bare', { asset: SIX[4], mode: 'auto' }));
    expect(l.created?.length).toBe(1);
    expect(tagOf(h.src(), l.created?.[0]?.element as string)).toContain('maxWidth');
  });

  test('on a frame with no empty picture a single photo fills it', async () => {
    const h = harness();
    const r = good(await h.run('bare', { asset: SIX[0], mode: 'auto' }, 'title'));
    expect(tagOf(h.src(), r.created?.[0]?.element as string)).toContain('objectFit');
  });

  test('a forged path or a non-boolean emptyOnly writes nothing', async () => {
    const h = harness();
    const before = h.src();
    for (const params of [
      { assets: ['assets/../../etc/passwd'], mode: 'auto' },
      { assets: ['http://evil/x.png'], mode: 'auto' },
      { assets: [SIX[0]], mode: 'fill-in-order', emptyOnly: 'yes' },
      { assets: Array.from({ length: 51 }, (_, i) => `assets/e${i}.png`), mode: 'auto' },
    ]) {
      const r = await h.run('match', params);
      expect(r.ok).toBe(false);
    }
    expect(h.src()).toBe(before);
  });

  test('without emptyOnly fill-in-order keeps S2.15 behaviour (replaces the n-th picture, reports extras only)', async () => {
    const h = harness();
    const r = good(await h.run('mixed', { assets: SIX.slice(0, 2), mode: 'fill-in-order' }, 'row'));
    expect(tagOf(h.src(), 'done')).toContain(`src="${SIX[0]}"`);
    expect(r.created ?? []).toEqual([]);
  });
});
