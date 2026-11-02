// S10.16b — the Design system canvas of a system being made: the three `ds-dir-*` direction artboards (13 · 14, 15)
// drawn from the draft revisions' own tokens, and the sections that have not been drawn yet as quiet outlines
// (13 · 16). The model is derived from the files each time: nothing is stored on the canvas (S10 Q7 / Q8).
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBoardModel } from '../ds/board/build-model.ts';
import { DSDirection, DSSection } from '../ds/board/index.tsx';
import {
  __resetOutlineStates,
  cleanOutlineStates,
  OUTLINE_WORDS,
  setOutlineStates,
} from '../ds/board/outline.tsx';
import {
  DIR_ARTBOARD,
  designSystemCanvasMeta,
  designSystemCanvasSource,
} from '../ds/board/template.ts';
import type { BoardModel } from '../ds/board/types.ts';
import { createDsMake } from '../ds/make.ts';
import { cleanup, makeProject } from './_ds-engine-fixture.ts';

afterAll(cleanup);
beforeEach(__resetOutlineStates);

const NEW = 'forge';
const AI = { kind: 'ai', name: 'Claude' } as const;

const warm = {
  '--bg-0': { light: '#fbf3e4', dark: '#2a211a', valueNames: { light: 'Cream', dark: 'Cocoa' } },
  '--fg-0': { light: '#3b2a1a', dark: '#f5e9d3' },
  '--accent': { light: '#c4562d', dark: '#e07a50', valueNames: { light: 'Terracotta' } },
  '--accent-fg': '#ffffff',
  '--font-display': '"New York", serif',
  '--font-body': 'system-ui, sans-serif',
  '--radius-md': '2px',
};
const cool = {
  '--bg-0': { light: '#ffffff', dark: '#10141a' },
  '--fg-0': { light: '#111827', dark: '#eef2f7' },
  '--accent': { light: '#2563eb', dark: '#60a5fa', valueNames: { light: 'Azure' } },
  '--accent-fg': '#ffffff',
  '--font-body': 'system-ui, sans-serif',
  '--radius-md': '10px',
};

async function made() {
  const p = await makeProject();
  const mk = createDsMake(p.engine);
  await mk.make({ ds: NEW, label: 'Forge', by: AI });
  const sys = () => p.engine.systems().find((s) => s.name === NEW)!;
  const model = () => buildBoardModel(p.designRoot, sys());
  return { p, mk, model };
}

describe('the canvas of a system being made carries the three direction artboards', () => {
  test('the source and the meta name ds-dir-a|b|c above the seven sections; a plain canvas has none', async () => {
    const { p } = await made();
    const tsx = p.read(`system/${NEW}/design-system.tsx`) as string;
    for (const d of ['a', 'b', 'c']) {
      expect(tsx).toContain(`<DCArtboard id="ds-dir-${d}" label="Direction ${d.toUpperCase()}"`);
      expect(tsx).toContain(`<DSDirection id="${d}" />`);
    }
    expect(tsx).toContain('import { DSSection, DsBar, DSDirection } from "@maude/ds/board";');
    const layout = (
      p.meta(`system/${NEW}/design-system.tsx`).layout as { artboards: { id: string; y: number }[] }
    ).artboards;
    expect(layout.map((a) => a.id)).toEqual([
      'ds-dir-a',
      'ds-dir-b',
      'ds-dir-c',
      'ds-brand',
      'ds-colour',
      'ds-type',
      'ds-space',
      'ds-motion',
      'ds-components',
      'ds-patterns',
    ]);
    expect(layout.slice(0, 3).every((a) => a.y === DIR_ARTBOARD.y && a.y < 0)).toBe(true);
    // a converted system's canvas (S10.12) is the seven sections, as it was
    expect(designSystemCanvasSource('acme', 'Acme')).not.toContain('ds-dir-');
    expect(JSON.stringify(designSystemCanvasMeta('acme'))).not.toContain('ds-dir-');
    // own specimen artboards and directions live together
    const both = designSystemCanvasSource(
      'acme',
      'Acme',
      [{ id: 'ds-own-x', label: 'X', src: 'preview/x.tsx' }],
      { directions: true }
    );
    expect(both).toContain(
      'import { DSSection, DsBar, DSDirection, Specimen } from "@maude/ds/board";'
    );
  });
});

describe('directions are the draft revisions, drawn from their own tokens', () => {
  test('the model carries a direction per draft, with its name, its mood and only plain values', async () => {
    const { mk, model } = await made();
    expect(model().directions).toEqual([]);
    expect(model().making).toBe(true);
    await mk.draft({ ds: NEW, direction: 'b', label: 'Warm paper', tokens: warm, by: AI });
    await mk.draft({ ds: NEW, direction: 'a', label: 'Calm daylight', tokens: cool, by: AI });
    const dirs = model().directions ?? [];
    expect(dirs.map((d) => [d.direction, d.label])).toEqual([
      ['a', 'Calm daylight'],
      ['b', 'Warm paper'],
    ]);
    const b = dirs[1];
    expect(b.mood).toBe('Cream · Terracotta · New York');
    expect(b.vars.light['--accent']).toBe('#c4562d');
    expect(b.vars.dark['--accent']).toBe('#e07a50');
    // a plain string is the same in every theme
    expect(b.vars.dark['--accent-fg']).toBe('#ffffff');
    expect(dirs[0].mood).toBe('Azure · System sans');
    expect(dirs.every((d) => !d.picked)).toBe(true);
  });

  test('Use marks the picked direction; a mix of two is neither', async () => {
    const { mk, model } = await made();
    await mk.draft({ ds: NEW, direction: 'a', label: 'Calm daylight', tokens: cool, by: AI });
    await mk.draft({ ds: NEW, direction: 'b', label: 'Warm paper', tokens: warm, by: AI });
    await mk.use({ ds: NEW, direction: 'a', by: AI });
    expect(model().directions?.map((d) => [d.direction, d.picked])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    await mk.mix({ ds: NEW, base: 'a', take: { type: 'b' }, by: AI });
    expect(model().directions?.every((d) => !d.picked)).toBe(true);
  });

  test('a made system keeps its directions but is no longer "making"', async () => {
    const { mk, model } = await made();
    await mk.draft({ ds: NEW, direction: 'a', tokens: cool, by: AI });
    await mk.use({ ds: NEW, direction: 'a', by: AI });
    await mk.done({ ds: NEW, by: AI });
    expect(model().making).toBe(false);
    expect(model().directions).toHaveLength(1);
  });

  test('an agent cannot put markup or a url in a tile: unsafe values are dropped', async () => {
    const { mk, model } = await made();
    await mk.draft({
      ds: NEW,
      direction: 'a',
      tokens: { '--accent': '#2563eb', '--bg-0': 'url(https://evil.test/x.png)' },
      by: AI,
    });
    const v = model().directions?.[0].vars.light ?? {};
    expect(v['--accent']).toBe('#2563eb');
    expect(v['--bg-0']).toBeUndefined();
  });

  test('DSDirection draws the tile from the direction, in the mode asked; one not drafted yet is an outline', async () => {
    const { mk, model } = await made();
    await mk.draft({ ds: NEW, direction: 'b', label: 'Warm paper', tokens: warm, by: AI });
    const m = model();
    const light = renderToStaticMarkup(<DSDirection id="b" model={m} mode="light" />);
    expect(light).toContain('data-ds-direction="b"');
    expect(light).toContain('Warm paper');
    expect(light).toContain('--accent:#c4562d');
    expect(light).toContain('Cream · Terracotta · New York');
    const dark = renderToStaticMarkup(<DSDirection id="b" model={m} mode="dark" />);
    expect(dark).toContain('--accent:#e07a50');
    const waiting = renderToStaticMarkup(<DSDirection id="c" model={m} mode="light" />);
    expect(waiting).toContain('data-ds-direction-wait="c"');
    expect(waiting).toContain('Direction C — next');
    expect(waiting).not.toContain('data-ds-direction="c"');
  });
});

describe('sections that have not been drawn yet are outlines (13 · ds-make-filling)', () => {
  const section = (m: BoardModel, kind: 'brand' | 'colour' | 'type' | 'patterns') =>
    renderToStaticMarkup(<DSSection kind={kind} model={m} mode="light" />);

  test('while a system is being made an empty section waits as an outline; what landed draws', async () => {
    const { mk, model } = await made();
    const empty = model();
    for (const k of ['brand', 'colour', 'type', 'patterns'] as const) {
      const html = section(empty, k);
      expect(html).toContain('data-ds-state="waiting"');
      expect(html).toContain(
        OUTLINE_WORDS.waiting(k === 'patterns' ? 'Patterns' : k[0].toUpperCase() + k.slice(1))
      );
    }
    await mk.draft({ ds: NEW, direction: 'a', tokens: cool, by: AI });
    await mk.use({ ds: NEW, direction: 'a', by: AI });
    const filled = model();
    // Colour and Type landed with the direction: they are the section, not an outline
    expect(section(filled, 'colour')).not.toContain('ds-outline');
    expect(section(filled, 'type')).not.toContain('ds-outline');
    // Brand has no logo or brand colour yet, Patterns follows everything else
    expect(section(filled, 'brand')).toContain('data-ds-state="waiting"');
    expect(section(filled, 'patterns')).toContain('data-ds-state="waiting"');
  });

  test('the shell says which section is being drawn right now, and a finished one is never an outline', async () => {
    const { mk, model } = await made();
    await mk.draft({ ds: NEW, direction: 'a', tokens: cool, by: AI });
    await mk.use({ ds: NEW, direction: 'a', by: AI });
    const m = model();
    setOutlineStates({ type: 'drawing', brand: 'drawing', colour: 'done' });
    const type = section(m, 'type');
    expect(type).toContain('data-ds-state="drawing"');
    expect(type).toContain('Type — drawing now');
    // "drawing" wins over content; "done" wins over emptiness
    expect(section(m, 'brand')).toContain('data-ds-state="drawing"');
    expect(section(m, 'colour')).not.toContain('ds-outline');
  });

  test("a system that is made draws every section as it did; the shell's words are cleaned", async () => {
    const { mk, model } = await made();
    await mk.draft({ ds: NEW, direction: 'a', tokens: cool, by: AI });
    await mk.use({ ds: NEW, direction: 'a', by: AI });
    await mk.done({ ds: NEW, by: AI });
    setOutlineStates({ brand: 'waiting' });
    expect(section(model(), 'brand')).not.toContain('ds-outline');
    expect(section(model(), 'patterns')).not.toContain('ds-outline');
    expect(
      cleanOutlineStates({ type: 'drawing', evil: 'done', brand: 'x"><script>', colour: 'waiting' })
    ).toEqual({ type: 'drawing', colour: 'waiting' });
    expect(cleanOutlineStates('nope')).toBeNull();
  });
});
