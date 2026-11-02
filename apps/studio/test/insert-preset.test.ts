// S7.20 — `artboard.insert-preset`: the F size picker's tile ends in ONE edit-op that adds a whole artboard of the
// preset's KIND (08 ak-picker). Goldens per kind, the custom print size, and the canvas-edit reader that has to
// read the `sizeMm` array back (opt-in — the default stays byte-identical to what a v1 peer reads).

import { describe, expect, test } from 'bun:test';

import { renderBlankCanvas } from '../canvas-create.ts';
import { readArtboardPrintProp } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { slugOf } from '../edit-ops/insert-preset.ts';
import { opLabel } from '../edit-ops/op-label.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult, LayoutPatch } from '../edit-ops/types.ts';
import { walkIdElements } from '../element-ids.ts';
import { readSizeMm, resolveCustomPrintArtboard } from '../kinds/print-custom.ts';

const FILE = 'ui/Home.tsx';

const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <section data-cd-id="hero" style={{ width: "600px", height: "400px" }} />
      </DCArtboard>
      <DCArtboard id="mobile" label="Mobile" width={390} height={800}></DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial: string = HOME) {
  const files = new Map<string, string>([[FILE, initial]]);
  const snapshots: string[] = [];
  const layouts: LayoutPatch[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, before, after) => {
      snapshots.push(before);
      files.set(rel, after);
    },
    writeLayout: async (_rel, patch) => {
      layouts.push(patch);
    },
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (params: Record<string, unknown>) =>
    dispatchEditOp({ file: FILE, op: 'artboard.insert-preset', targets: [], params }, deps);
  return { files, snapshots, layouts, run, src: () => files.get(FILE) as string };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const tagOf = (src: string, id: string) =>
  new RegExp(`<DCArtboard\\b[^>]*\\bid="${id}"[^>]*>`).exec(src)?.[0] ?? '';

test('the op is in the table', () => {
  expect(EDIT_OPS.some((o) => o.id === 'artboard.insert-preset')).toBe(true);
});

describe('a Fixed size preset (App, Social)', () => {
  test('FB event cover: kind digital, fixed, 1920 × 1005, one write, its place in the layout lane', async () => {
    const h = harness();
    const r = good(await h.run({ presetId: 'social-fb-event', at: { x: 1000.4, y: 150 } }));
    expect(h.snapshots).toEqual([HOME]);
    expect(r.created).toEqual([{ artboard: 'fb-event-cover', element: 'fb-event-cover' }]);
    expect(r.detail).toMatchObject({
      kind: 'digital',
      width: 1920,
      height: 1005,
      label: 'FB event cover',
    });
    const tag = tagOf(h.src(), 'fb-event-cover');
    for (const part of [
      'label="FB event cover"',
      'kind="digital"',
      'width={1920}',
      'height={1005}',
    ])
      expect(tag).toContain(part);
    expect(tag).toMatch(/\bfixed\b/);
    expect(h.layouts).toEqual([{ set: [{ id: 'fb-event-cover', x: 1000, y: 150 }] }]);
    // the two boards that were there are byte for byte what they were
    expect(h.src()).toContain(
      HOME.slice(
        HOME.indexOf('<DCArtboard id="desktop"'),
        HOME.indexOf('</DesignCanvas>')
      ).trimEnd()
    );
  });

  test('without `at` nothing goes to the layout lane (the default grid places it)', async () => {
    const h = harness();
    good(await h.run({ presetId: 'app-mobile' }));
    expect(h.layouts).toEqual([]);
  });

  test('the same preset twice: a fresh id and a numbered label', async () => {
    const h = harness();
    good(await h.run({ presetId: 'social-post-1-1' }));
    const second = good(await h.run({ presetId: 'social-post-1-1' }));
    expect(second.created?.[0]?.artboard).toBe('post-1-1-2');
    expect(tagOf(h.src(), 'post-1-1-2')).toContain('label="Post 1:1 2"');
  });

  test('a label that is already on the canvas ("Desktop") is numbered, the id too', async () => {
    const h = harness();
    const r = good(await h.run({ presetId: 'app-desktop' }));
    expect(r.created?.[0]?.artboard).toBe('desktop-2');
    expect(tagOf(h.src(), 'desktop-2')).toContain('label="Desktop 2"');
  });
});

describe('Web page, Print, Video', () => {
  test('a web preset hugs: kind web, no fixed, the width it names', async () => {
    const h = harness();
    const r = good(await h.run({ presetId: 'web-tablet' }));
    const tag = tagOf(h.src(), r.created?.[0]?.artboard as string);
    expect(tag).toContain('kind="web"');
    expect(tag).toContain('width={834}');
    expect(tag).not.toMatch(/\bfixed\b/);
  });

  test('A6: kind print, the paper, the px of trim + bleed (419 × 581)', async () => {
    const h = harness();
    const r = good(await h.run({ presetId: 'print-a6' }));
    const id = r.created?.[0]?.artboard as string;
    const tag = tagOf(h.src(), id);
    expect(tag).toContain('kind="print"');
    expect(tag).toContain('width={419}');
    expect(tag).toContain('height={581}');
    expect(readArtboardPrintProp(`/x/${FILE}`, h.src(), id)).toEqual({
      paper: 'a6',
      orientation: 'portrait',
    });
  });

  test('a video preset comes with its comp (30 fps) and the imports it needs', async () => {
    const h = harness();
    const r = good(await h.run({ presetId: 'video-landscape' }));
    const id = r.created?.[0]?.artboard as string;
    expect(tagOf(h.src(), id)).toContain('kind="video"');
    expect(h.src()).toContain('<VideoComp component={VideoCut}');
    expect(h.src()).toMatch(/fps=\{30\} width=\{1920\} height=\{1080\}/);
    expect(h.src()).toMatch(/import \{[^}]*VideoComp[^}]*\} from '@maude\/canvas-lib'/);
    const walk = walkIdElements(h.src(), FILE);
    expect(walk.ok).toBe(true);
  });
});

describe('Custom size…', () => {
  const CUSTOM = { presetId: 'print-custom', custom: { widthMm: 99, heightMm: 210, bleedMm: 3 } };

  test('sizeMm on the nearest larger paper — never paper "custom"', async () => {
    const h = harness();
    const r = good(await h.run(CUSTOM));
    const id = r.created?.[0]?.artboard as string;
    expect(id).toBe('99-210-mm'.replace(/^/, 'artboard-'));
    expect(h.src()).toContain('"sizeMm":[99,210]');
    expect(h.src()).not.toContain('"custom"');
    const tag = tagOf(h.src(), id);
    expect(tag).toContain('kind="print"');
    expect(tag).toContain('label="99 × 210 mm"');
    expect(r.detail).toMatchObject({ width: 396, height: 816 });
  });

  test('the reader returns the array on request, and drops it by default (what a v1 peer reads)', async () => {
    const h = harness();
    const id = good(await h.run(CUSTOM)).created?.[0]?.artboard as string;
    const withArrays = readArtboardPrintProp(`/x/${FILE}`, h.src(), id, { arrays: true });
    expect(readSizeMm(withArrays)).toEqual([99, 210]);
    expect(withArrays).toMatchObject({ paper: 'dl', orientation: 'portrait', bleedMm: 3 });
    // the trim round-trips through the v2 resolver
    const r = resolveCustomPrintArtboard(withArrays as never);
    expect([r.trimWidthMm, r.trimHeightMm]).toEqual([99, 210]);
    // default: byte-identical to before (S7.1's v1 reader test keeps its meaning)
    expect(readArtboardPrintProp(`/x/${FILE}`, h.src(), id)).toEqual({
      paper: 'dl',
      orientation: 'portrait',
      bleedMm: 3,
    });
  });

  test('an array that is not plain literals is not read (no eval, no guess)', () => {
    const src = `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
const W = 99;
export default function C() {
  return (<DesignCanvas>
    <DCArtboard id="a" kind="print" width={1} height={1} print={{ paper: 'a6', sizeMm: [W, 210], marks: [1, [2]] }} />
  </DesignCanvas>);
}
`;
    expect(readArtboardPrintProp('/x/C.tsx', src, 'a', { arrays: true })).toEqual({ paper: 'a6' });
  });
});

describe('refusals write nothing', () => {
  test.each([
    ['an unknown preset', { presetId: 'nope' }],
    ['no preset', {}],
    ['a custom size without mm', { presetId: 'print-custom' }],
    [
      'a custom size out of range',
      { presetId: 'print-custom', custom: { widthMm: 5, heightMm: 100 } },
    ],
    ['a position that is not a number', { presetId: 'app-mobile', at: { x: 'a', y: 1 } }],
  ])('%s', async (_name, params) => {
    const h = harness();
    const r = bad(await h.run(params as Record<string, unknown>));
    expect(r.code).toBe('invalid');
    expect(r.message.length).toBeGreaterThan(5);
    expect(h.snapshots).toEqual([]);
    expect(h.src()).toBe(HOME);
  });
});

describe('a blank canvas (G4, gate B)', () => {
  const BLANK = renderBlankCanvas({
    name: 'Untitled canvas',
    componentName: 'UntitledCanvas',
    dsName: 'maude-v2',
    platform: 'web',
    historyDir: '_history/untitled-canvas',
  });

  test('the size picker / AI op adds the first artboard, in a section, with its imports', async () => {
    const h = harness(BLANK);
    const r = good(await h.run({ presetId: 'app-mobile' }));
    const board = r.created?.[0]?.artboard as string;
    expect(board).toBeTruthy();
    expect(h.src()).toContain('<DCSection id="main" title="Main">');
    expect(tagOf(h.src(), board)).toContain('kind="digital"');
    expect(h.src()).toContain(
      'import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";'
    );
  });

  test('a file that does not parse is still refused, and nothing is written', async () => {
    const h = harness(BLANK.replace('</DesignCanvas>', ''));
    const r = bad(await h.run({ presetId: 'app-mobile' }));
    expect(r.message).toBe('This canvas does not parse; fix it before editing.');
    expect(h.snapshots).toEqual([]);
  });
});

describe('words', () => {
  test('the history line names the artboard', () => {
    expect(opLabel('artboard.insert-preset', { presetId: 'social-fb-event' }, [])).toBe(
      'Added FB event cover'
    );
    expect(opLabel('artboard.insert-preset', { presetId: 'print-custom' }, [])).toBe(
      'Added an artboard'
    );
  });

  test('ids are slugs that start with a letter', () => {
    expect(slugOf('FB event cover')).toBe('fb-event-cover');
    expect(slugOf('Příběh 9:16')).toBe('pribeh-9-16');
    expect(slugOf('99 × 210 mm')).toBe('artboard-99-210-mm');
  });
});
