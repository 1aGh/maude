// S8.3 — Export: many at once + Advanced (client/v2/export/{sections/batch.jsx, advanced/*}).
//
//   • groups by kind each keep their kind's default; changing one leaves the others alone
//   • shared-parts canvases are left out BY NAME; a big export says it is big, then gets out of the way
//   • Advanced shows only the part for what is selected; a change in it reaches the spec
//   • the file-name preview is live; the command lines replay the exact export — each printed line goes
//     back through the CLI's own parser (planExportArgv) and comes out as the same spec
//   • mono only inside the fold (the words lint)
//
// Two halves like v2-export-sheet.test.tsx: the pure model, then the real sheet under happy-dom.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { parseKindFormats, planExportArgv } from '../../../cli/lib/export-spec.mjs';
import {
  commandLines,
  shellQuote,
  specArgs,
  splitCommand,
} from '../client/v2/export/advanced/command.js';
import {
  advancedParts,
  applyAdvanced,
  nameSamples,
  overridesFor,
} from '../client/v2/export/advanced/model.js';
import {
  batchPart,
  bigWords,
  choiceFor,
  formatSkipLine,
  isBatch,
  orderKinds,
  picksForOther,
  sharedPartsLine,
} from '../client/v2/export/sections/batch-model.js';
import { buildSpec } from '../client/v2/export/use-export-spec.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// ── the batch model ──────────────────────────────────────────────────────────────────────────────
describe('groups by kind', () => {
  const KINDS = ['video', 'print', 'digital'];

  test('each kind keeps its own default, whatever order the estimate names them in', () => {
    expect(orderKinds(KINDS)).toEqual(['digital', 'print', 'video']);
    const part = batchPart({}, KINDS);
    expect(part?.format).toBe('png');
    expect(part?.byKind).toEqual({
      digital: { format: 'png', options: { size: { scale: 1 } } },
      print: { format: 'pdf', options: { print: { bleed: true, marks: 'crop' } } },
      video: { format: 'mp4' },
    });
    // web pages are 2×, not 1× — a kind's default is the kind's
    expect(choiceFor('web', {}).options).toEqual({ size: { scale: 2 } });
  });

  test('changing one kind leaves the others alone', () => {
    const before = batchPart({}, KINDS);
    const after = batchPart({ print: 'pdf' }, KINDS);
    expect(after?.byKind?.print).toEqual({ format: 'pdf' });
    expect(after?.byKind?.digital).toEqual(before?.byKind?.digital);
    expect(after?.byKind?.video).toEqual(before?.byKind?.video);
    const jpg = batchPart({ digital: 'jpg-2' }, KINDS);
    expect(jpg?.byKind?.digital).toEqual({ format: 'jpg', options: { size: { scale: 2 } } });
    expect(jpg?.byKind?.print).toEqual(before?.byKind?.print);
    // an unknown pick falls back to the kind's default, never to another kind's
    expect(batchPart({ print: 'nonsense' }, KINDS)?.byKind?.print).toEqual(before?.byKind?.print);
  });

  test('one kind stays a flat spec; a folder or the whole project is a batch even then', () => {
    expect(batchPart({}, ['digital'])).toEqual({
      format: 'png',
      options: { size: { scale: 1 } },
    });
    expect(isBatch(['digital'], 'selection', 'png')).toBe(false);
    expect(isBatch(['digital'], 'folder', 'png')).toBe(true);
    expect(isBatch(['digital'], 'project', 'png')).toBe(true);
    expect(isBatch(['digital', 'print'], 'selection', 'png')).toBe(true);
    // a deck or a ZIP is one format for everything
    expect(isBatch(['digital', 'print'], 'canvas', 'pptx')).toBe(false);
    expect(isBatch(['digital'], 'project', 'zip')).toBe(false);
  });

  test('Other… in a batch lands on every kind that can take it; a deck/ZIP takes none', () => {
    const kinds = ['digital', 'print', 'video'];
    const row = (id: string, format: string | null) => ({ id, format });
    expect(picksForOther(row('jpg', 'jpg'), kinds, {})).toEqual({ digital: 'jpg-1' });
    expect(picksForOther(row('pdf', 'pdf'), kinds, { video: 'gif' })).toEqual({
      digital: 'pdf',
      print: 'pdf',
      video: 'gif',
    });
    expect(picksForOther(row('mp4', 'mp4'), kinds, {})).toEqual({ video: 'mp4' });
    // Print PDF is a print-kind choice, not a plain PDF for a fixed-size post
    expect(picksForOther(row('print-pdf', 'pdf'), kinds, {})).toEqual({ print: 'print-pdf' });
    expect(picksForOther(row('pptx', 'pptx'), kinds, {})).toBeNull();
    expect(picksForOther(row('zip', 'zip'), kinds, {})).toBeNull();
  });
});

describe('what a batch says about itself', () => {
  test('shared-parts canvases are left out by name', () => {
    expect(
      sharedPartsLine([
        { name: '_broadcast', reason: 'shared-part' },
        { name: '_social', reason: 'shared-part' },
        { name: '_video', reason: 'shared-part' },
        { name: 'x', reason: 'format-unit' },
      ])
    ).toBe('_broadcast, _social and _video hold shared parts, not artboards — left out.');
    expect(sharedPartsLine([{ name: '_one', reason: 'shared-part' }])).toBe(
      '_one holds shared parts, not artboards — left out.'
    );
    expect(sharedPartsLine([])).toBeNull();
    expect(formatSkipLine([{ name: 'Recap', reason: 'format-unit' }])).toBe(
      'Recap can’t be made in the format picked — left out.'
    );
  });

  test('a big export says it is big — counts, size and time — and what the window may do next', () => {
    const big = { files: 524, bytes: 5_900_000_000, seconds: 720, lane: 'cloud' };
    const words = bigWords(big, {
      summary: '524 files · about 5.9 GB · about 12 min in the cloud',
      hasVideo: true,
    });
    expect(words).toContain('big export');
    expect(words).toContain('524 files');
    expect(words).toContain('5.9 GB');
    expect(words).toContain('you can close the window — the cloud finishes the videos');
    // on this Mac the window has to stay: no promise about a cloud that is not rendering
    const mac = bigWords({ ...big, lane: 'this-mac' }, { summary: 'x', hasVideo: true });
    expect(mac).toContain('Keep this window open');
    expect(mac).not.toContain('cloud');
    // a small one says nothing
    expect(bigWords({ files: 5, bytes: 34_000_000, seconds: 8, lane: 'this-mac' }, {})).toBeNull();
  });
});

// ── Advanced as spec fields ──────────────────────────────────────────────────────────────────────
const CTX = {
  designRel: '.design',
  activePath: '.design/ui/combine.tsx',
  artboards: ['a1', 'a2', 'a3', 'a4', 'a5'],
  elements: [],
};
const BASE = {
  scope: 'selection',
  format: 'png',
  scale: null,
  annotations: false,
  region: null,
  at: null,
};

describe('Advanced reaches the spec', () => {
  test('an untouched fold changes nothing', () => {
    const plain = buildSpec(BASE, CTX);
    expect(buildSpec({ ...BASE, adv: {} }, CTX)).toEqual(plain);
    expect(buildSpec({ ...BASE, adv: undefined }, CTX)).toEqual(plain);
  });

  test('exact scale, dpi, colour, JPG quality and background land in options', () => {
    expect(buildSpec({ ...BASE, adv: { scale: 2.5 } }, CTX).options).toEqual({
      size: { scale: 2.5 },
    });
    expect(buildSpec({ ...BASE, adv: { sizeBy: 'dpi', dpi: 300 } }, CTX).options).toEqual({
      size: { dpi: 300 },
    });
    expect(
      buildSpec(
        {
          ...BASE,
          format: 'jpg',
          adv: { colorProfile: 'display-p3', jpgQuality: 70, background: 'white' },
        },
        CTX
      ).options
    ).toEqual({
      size: { scale: 1 },
      colorProfile: 'display-p3',
      jpgQuality: 70,
      background: 'white',
    });
    // the defaults say nothing (sRGB, JPG 85, as-on-the-artboard are what the engine does anyway)
    expect(
      overridesFor('jpg', { colorProfile: 'srgb', jpgQuality: 85, background: 'artboard' })
    ).toEqual({});
  });

  test('a size from the fold wins over the sheet’s 1× / 2×; in a batch it wins over every picture pick', () => {
    expect(buildSpec({ ...BASE, scale: 2, adv: { scale: 3 } }, CTX).options).toEqual({
      size: { scale: 3 },
    });
    const spec = buildSpec(
      { ...BASE, adv: { scale: 3 } },
      { ...CTX, kinds: ['digital', 'print', 'video'], batch: true }
    );
    expect(spec.byKind.digital.options.size).toEqual({ scale: 3 });
    // the video and the print PDF are not pictures: the exact scale does not touch them
    expect(spec.byKind.video.options).toBeUndefined();
    expect(spec.byKind.print.options.size).toBeUndefined();
  });

  test('print, video and where it renders', () => {
    const spec = buildSpec(
      {
        ...BASE,
        adv: { printDpi: 600, bleed: false, crop: true, fps: 60, vquality: 'high', lane: 'cloud' },
      },
      { ...CTX, kinds: ['print', 'video'], batch: true }
    );
    expect(spec.byKind.print.options).toEqual({
      size: { dpi: 600 },
      print: { bleed: false, marks: 'crop' },
    });
    expect(spec.byKind.video.options).toEqual({ video: { fps: 60, quality: 'high' } });
    expect(spec.options).toEqual({ lane: 'cloud' });
    // “Suggest each time” is the default: it says nothing
    expect(
      applyAdvanced({ v: 2, scope: 'canvas', format: 'png' }, { lane: 'auto' }).options
    ).toBeUndefined();
  });

  test('a file-name pattern lands as nameTemplate; the default pattern says nothing', () => {
    expect(
      buildSpec({ ...BASE, adv: { nameTemplate: '{project} {kind}' } }, CTX).options?.nameTemplate
    ).toBe('{project} {kind}');
    expect(
      buildSpec({ ...BASE, adv: { nameTemplate: '{canvas} — {artboard}@{scale}' } }, CTX).options
    ).toEqual({
      size: { scale: 1 },
    });
  });

  test('Advanced shows only the part for what is selected', () => {
    const kinds = (...k: string[]) => new Set(k);
    const parts = (formats: string[], k: string[], lane = 'local') =>
      advancedParts({ formats: new Set(formats), kinds: kinds(...k), exportLane: lane });
    expect(parts(['png'], ['digital'])).toEqual({
      image: true,
      print: false,
      video: false,
      render: false,
    });
    expect(parts(['pdf'], ['print'])).toEqual({
      image: false,
      print: true,
      video: false,
      render: false,
    });
    expect(parts(['pdf'], ['web'])).toEqual({
      image: false,
      print: false,
      video: false,
      render: false,
    });
    expect(parts(['mp4'], ['video'])).toEqual({
      image: false,
      print: false,
      video: true,
      render: true,
    });
    expect(parts(['png', 'pdf', 'mp4'], ['digital', 'print', 'video'])).toEqual({
      image: true,
      print: true,
      video: true,
      render: true,
    });
    // a workspace without the render service always owes the answer
    expect(parts(['png'], ['digital'], 'none').render).toBe(true);
  });
});

describe('the file-name preview', () => {
  test('is the server’s own naming run on examples, and changes with the pattern', () => {
    const spec = { v: 2, scope: 'canvas', format: 'png', options: { size: { scale: 2 } } } as const;
    const facts = {
      project: 'Alligators',
      canvas: '2026/Combine-kampan.tsx',
      date: new Date(2026, 9, 6),
    };
    expect(nameSamples(spec, undefined, ['digital'], { ...facts, label: 'Slide 01' })).toEqual([
      'Combine-kampan — Slide 01@2x.png',
    ]);
    expect(nameSamples(spec, '{project} {date} {kind}', ['digital', 'video'], facts)).toEqual([
      'Alligators 2026-10-06 digital.png',
      'Alligators 2026-10-06 video.png',
    ]);
    // unsafe characters never reach a sample (the server strips them the same way)
    expect(nameSamples(spec, 'a/b:c', ['digital'], facts)[0]).toBe('abc.png');
  });
});

// ── the command lines ────────────────────────────────────────────────────────────────────────────
const CLI_WORDS = 3; // maude design export
function replay(line: { id: string; text: string }) {
  const words = splitCommand(line.text);
  const rest = line.id === 'cli' ? words.slice(CLI_WORDS) : words.slice(1);
  expect(line.id === 'cli' ? words.slice(0, CLI_WORDS) : words[0]).toEqual(
    line.id === 'cli' ? ['maude', 'design', 'export'] : '/design:export'
  );
  return planExportArgv(rest).plan;
}

describe('the command lines replay the exact export', () => {
  const specs = {
    'a batch of three kinds with Advanced on': buildSpec(
      {
        ...BASE,
        annotations: true,
        adv: {
          scale: 2.5,
          colorProfile: 'display-p3',
          printDpi: 600,
          crop: true,
          fps: 30,
          vquality: 'high',
          lane: 'cloud',
          nameTemplate: `{canvas} — {artboard}@{scale} it's`,
        },
      },
      { ...CTX, kinds: ['digital', 'print', 'video'], batch: true }
    ),
    'one artboard as a JPG': buildSpec(
      { ...BASE, format: 'jpg', scale: 2, adv: { jpgQuality: 70, background: 'white' } },
      { ...CTX, artboards: ['hero'] }
    ),
    'this canvas, exact dpi': buildSpec(
      { ...BASE, scope: 'canvas', adv: { sizeBy: 'dpi', dpi: 150 } },
      CTX
    ),
    'a folder, one kind': buildSpec(
      { ...BASE, scope: 'folder' },
      { ...CTX, activePath: '.design/ui/2026/combine/a.tsx', kinds: ['digital'], batch: true }
    ),
    'the whole project, three kinds': buildSpec(
      { ...BASE, scope: 'project', kindPicks: { print: 'pdf', digital: 'jpg-2' } },
      { ...CTX, kinds: ['print', 'digital', 'web'], batch: true }
    ),
    'a past version, a region': buildSpec(
      {
        ...BASE,
        scope: 'canvas',
        region: { rect: { x: -10, y: 20, w: 300, h: 200.5 } },
        at: { sha: 'abc1234' },
      },
      CTX
    ),
    'a project ZIP': buildSpec({ ...BASE, scope: 'project', format: 'zip' }, CTX),
  };

  for (const [name, spec] of Object.entries(specs)) {
    test(`${name}: both lines go through the CLI parser and come out as the same spec`, () => {
      for (const line of commandLines(spec)) {
        const plan = replay(line) as { mode: string; spec: unknown; error?: string };
        expect(plan.error).toBeUndefined();
        expect(plan.mode).toBe('v2');
        expect(plan.spec).toEqual(spec);
      }
    });
  }

  test('the lines read as a terminal and as Claude Code, with the same words', () => {
    const [cli, claude] = commandLines(buildSpec({ ...BASE, scope: 'canvas' }, CTX));
    expect(cli?.text.startsWith('maude design export png --scope canvas')).toBe(true);
    expect(claude?.text.startsWith('/design:export png --scope canvas')).toBe(true);
    expect(cli?.text.replace('maude design export', '')).toBe(
      claude?.text.replace('/design:export', '')
    );
  });

  test('--kind: a kind keeps its format and its options', () => {
    expect(
      parseKindFormats(['print=pdf:bleed=true,marks=crop', 'web=png:scale=2', 'video=mp4'])
    ).toEqual({
      byKind: {
        print: { format: 'pdf', options: { print: { bleed: true, marks: 'crop' } } },
        web: { format: 'png', options: { size: { scale: 2 } } },
        video: { format: 'mp4' },
      },
    });
    expect(parseKindFormats(['print']).error).toContain('expected kind=format');
    expect(parseKindFormats(['print=docx']).error).toContain('expected kind=format');
    expect(
      specArgs({ v: 2, scope: 'canvas', format: 'png', options: { nameTemplate: 'a b' } })
    ).toEqual(['png', '--scope', 'canvas', '--name', 'a b']);
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

// ── the sheet ────────────────────────────────────────────────────────────────────────────────────
interface Call {
  method: string;
  url: string;
  body?: { v?: number; spec?: Record<string, any>; format?: string };
}
let calls: Call[] = [];
let estimate: Record<string, unknown> = {};
const realFetch = globalThis.fetch;

const EST_BATCH = {
  counts: { selection: 5, canvas: 21, folder: 38, project: 524 },
  files: 5,
  bytes: 34_000_000,
  seconds: 8,
  lane: 'this-mac',
  byKind: {
    digital: { artboards: 4, files: 4, format: 'png' },
    print: { artboards: 1, files: 1, format: 'pdf' },
  },
  skipped: [],
};

function stubFetch() {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/_api/export-history')) return json({ history: [] });
    if (url.endsWith('/_api/export-estimate')) return json(estimate);
    if (url.endsWith('/_api/export-jobs')) return json({ jobId: 'job-1' }, 202);
    return json({}, 404);
  }) as typeof fetch;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(async () => {
  estimate = EST_BATCH;
  try {
    localStorage.clear();
  } catch {}
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('export', false);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const click = async (sel: string) => {
  const el = $(sel);
  expect(el !== null).toBe(true);
  await act(async () => {
    el?.click();
    await tick(10);
  });
};
const choose = async (sel: string, value: string) => {
  const el = $(sel) as HTMLSelectElement | null;
  expect(el !== null).toBe(true);
  await act(async () => {
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await tick(10);
  });
};
const type = async (sel: string, value: string) => {
  const el = $(sel) as HTMLInputElement | null;
  expect(el !== null).toBe(true);
  await act(async () => {
    if (el) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      el.focus();
      set?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await tick(20);
  });
  await act(async () => {
    await tick(20);
  });
};
const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/_api/export-jobs'));
const posted = () => posts()[0]?.body?.spec as Record<string, any>;

async function mountSheet(props: Record<string, unknown> = {}) {
  stubFetch();
  const { ExportDialog } = await import('../client/dialogs/export-dialog.jsx');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ExportDialog
        mode="export"
        activePath=".design/ui/combine.tsx"
        designRel=".design"
        exportLane="local"
        hasSelection
        selectedArtboards={['a1', 'a2', 'a3', 'a4', 'a5']}
        onClose={() => {}}
        {...props}
      />
    );
    await tick();
  });
  // the first estimate names the kinds; the sheet asks again for the batch it then is
  await act(async () => {
    await tick();
  });
  await act(async () => {
    await tick();
  });
}

describe('the sheet: many at once', () => {
  test('five artboards of two kinds: a group each, each on its own default', async () => {
    await mountSheet();
    expect($('[data-testid="export-rows"]')?.getAttribute('data-section')).toBe('batch');
    expect(text('[data-testid="export-group-digital-title"]')).toBe('Fixed size · 4 artboards');
    expect(text('[data-testid="export-group-print-title"]')).toBe('Print · 1 page');
    expect(($('[data-testid="export-group-digital-format"]') as HTMLSelectElement).value).toBe(
      'png-1'
    );
    expect(($('[data-testid="export-group-print-format"]') as HTMLSelectElement).value).toBe(
      'print-pdf'
    );
    expect(text('[data-testid="export-group-print"]')).toContain('Bleed + crop marks');
    // 09: the kind's icon tile is always first; the still stack (when there is one) sits after the names, before the value
    const row = $('[data-testid="export-group-digital"]') as HTMLElement;
    expect(row.firstElementChild?.className).toBe('ex-grp-ic');
    expect(
      row.querySelector('.ex-grp-v [data-testid="export-group-digital-format"]')
    ).not.toBeNull();
    expect($('[data-testid="export-row-folders"] [data-testid="export-folders"]')).not.toBeNull();
    await click('[data-testid="export-submit"]');
    expect(posted()).toMatchObject({
      v: 2,
      scope: 'selection',
      format: 'png',
      byKind: {
        digital: { format: 'png', options: { size: { scale: 1 } } },
        print: { format: 'pdf', options: { print: { bleed: true, marks: 'crop' } } },
      },
    });
  });

  test('changing one group leaves the other alone — in the select and in the posted spec', async () => {
    await mountSheet();
    await choose('[data-testid="export-group-digital-format"]', 'jpg-2');
    expect(($('[data-testid="export-group-print-format"]') as HTMLSelectElement).value).toBe(
      'print-pdf'
    );
    await click('[data-testid="export-submit"]');
    const spec = posted();
    expect(spec.byKind.digital).toEqual({ format: 'jpg', options: { size: { scale: 2 } } });
    expect(spec.byKind.print).toEqual({
      format: 'pdf',
      options: { print: { bleed: true, marks: 'crop' } },
    });
  });

  test('a folder: shared-parts canvases are left out by name', async () => {
    estimate = {
      ...EST_BATCH,
      skipped: [
        { name: '_broadcast', reason: 'shared-part' },
        { name: '_social', reason: 'shared-part' },
        { name: '_video', reason: 'shared-part' },
      ],
    };
    await mountSheet({ hasSelection: false, selectedArtboards: [] });
    await click('[data-testid="export-scope-folder"]');
    expect(text('[data-testid="export-shared-parts"]')).toBe(
      '_broadcast, _social and _video hold shared parts, not artboards — left out.'
    );
  });

  test('Whole project says it is big, then the window may close while the cloud finishes video', async () => {
    estimate = {
      counts: { selection: null, canvas: 21, folder: 38, project: 524 },
      files: 524,
      bytes: 5_900_000_000,
      seconds: 720,
      lane: 'cloud',
      byKind: {
        digital: { artboards: 424, files: 424, format: 'png' },
        print: { artboards: 46, files: 46, format: 'pdf' },
        video: { artboards: 24, files: 24, format: 'mp4' },
      },
      skipped: [],
    };
    await mountSheet({ hasSelection: false, selectedArtboards: [] });
    await click('[data-testid="export-scope-project"]');
    expect(text('[data-testid="export-summary"]')).toBe(
      '524 files · about 5.9 GB · about 12 min in the cloud'
    );
    const big = text('[data-testid="export-big"]');
    expect(big).toContain('big export');
    expect(big).toContain('524 files');
    expect(big).toContain('close the window');
    expect(big).toContain('the cloud finishes the videos');
    expect(text('[data-testid="export-group-video"]')).toContain('In the cloud');
    // Project ZIP instead is one press away
    await click('[data-testid="export-project-zip"] button');
    await click('[data-testid="export-submit"]');
    expect(posted()).toMatchObject({ scope: 'project', format: 'zip' });
  });

  test('Other… in a batch puts the format on every kind that can take it', async () => {
    await mountSheet();
    // V2-8.5 C4 (09 ex-canvas): the batch sheet draws no "Other format" row — it sits under Advanced
    expect($('[data-testid="export-row-other"]')).toBeNull();
    expect($('[data-testid="export-row-annotations"]')).toBeNull();
    await click('[data-testid="export-advanced-toggle"]');
    expect($('[data-testid="export-row-annotations"]')).not.toBeNull();
    await click('[data-testid="export-other"]');
    await click('[data-testid="export-other-menu"] [data-testid="export-format-pdf"]');
    expect(($('[data-testid="export-group-digital-format"]') as HTMLSelectElement).value).toBe(
      'pdf'
    );
    expect(($('[data-testid="export-group-print-format"]') as HTMLSelectElement).value).toBe('pdf');
  });
});

describe('the sheet: Advanced', () => {
  test('closed by default: the row alone, no part and no mono', async () => {
    await mountSheet({ selectedArtboards: ['a1'] });
    // the row alone: its toggle sits in the sheet's footer (09), the body is not drawn
    expect($('[data-testid="export-advanced-toggle"]')).not.toBeNull();
    expect($('[data-testid="export-advanced"]')).toBeNull();
    expect($('[data-testid="export-adv-parts"]')).toBeNull();
    expect($$('.ex-mono')).toHaveLength(0);
  });

  test('shows only the part for what is selected', async () => {
    estimate = { ...EST_BATCH, byKind: { digital: { artboards: 1, files: 1, format: 'png' } } };
    await mountSheet({ selectedArtboards: ['a1'] });
    await click('[data-testid="export-advanced-toggle"]');
    expect($('[data-testid="export-adv-image"]')).not.toBeNull();
    expect($('[data-testid="export-adv-print"]')).toBeNull();
    expect($('[data-testid="export-adv-video"]')).toBeNull();
    expect($('[data-testid="export-adv-render"]')).toBeNull();
    // five artboards of three kinds: all four parts
    estimate = {
      ...EST_BATCH,
      byKind: {
        digital: { artboards: 2, files: 2, format: 'png' },
        print: { artboards: 1, files: 1, format: 'pdf' },
        video: { artboards: 1, files: 1, format: 'mp4' },
      },
    };
    act(() => root?.unmount());
    host?.remove();
    await mountSheet();
    expect($('[data-testid="export-adv-image"]')).not.toBeNull();
    expect($('[data-testid="export-adv-print"]')).not.toBeNull();
    expect($('[data-testid="export-adv-video"]')).not.toBeNull();
    expect($('[data-testid="export-adv-render"]')).not.toBeNull();
  });

  test('an Advanced change reaches the spec: exact scale', async () => {
    estimate = { ...EST_BATCH, byKind: { digital: { artboards: 1, files: 1, format: 'png' } } };
    await mountSheet({ selectedArtboards: ['a1'] });
    await click('[data-testid="export-advanced-toggle"]');
    await type('[data-testid="export-adv-scale"]', '2.5');
    await click('[data-testid="export-submit"]');
    expect(posted().options.size).toEqual({ scale: 2.5 });
  });

  test('an Advanced change reaches the spec: dpi (the old PNG resolution), colour and the pattern', async () => {
    estimate = { ...EST_BATCH, byKind: { digital: { artboards: 1, files: 1, format: 'png' } } };
    await mountSheet({ selectedArtboards: ['a1'] });
    await click('[data-testid="export-advanced-toggle"]');
    await click('[data-testid="export-adv-size-by-dpi"]');
    await click('[data-testid="export-adv-dpi-300"]');
    await click('[data-testid="export-adv-color-display-p3"]');
    await type('[data-testid="export-adv-name-template"]', '{project} — {artboard}');
    await click('[data-testid="export-submit"]');
    expect(posted().options).toEqual({
      size: { dpi: 300 },
      colorProfile: 'display-p3',
      nameTemplate: '{project} — {artboard}',
      saveTo: 'downloads',
    });
  });

  test('a number outside the spec’s range never reaches it', async () => {
    estimate = { ...EST_BATCH, byKind: { digital: { artboards: 1, files: 1, format: 'png' } } };
    await mountSheet({ selectedArtboards: ['a1'] });
    await click('[data-testid="export-advanced-toggle"]');
    await type('[data-testid="export-adv-scale"]', '9');
    expect($('[data-testid="export-adv-scale"]')?.getAttribute('aria-invalid')).toBe('true');
    await click('[data-testid="export-submit"]');
    expect(posted().options).toEqual({ size: { scale: 1 }, saveTo: 'downloads' });
  });

  test('the file-name preview is live', async () => {
    estimate = { ...EST_BATCH, byKind: { digital: { artboards: 1, files: 1, format: 'png' } } };
    await mountSheet({
      selectedArtboards: ['a1'],
      selectionLabel: 'Hero',
      projectName: 'Alligators',
    });
    await click('[data-testid="export-advanced-toggle"]');
    expect(text('[data-testid="export-adv-name-preview"]')).toBe('combine — Hero@1x.png');
    await type('[data-testid="export-adv-name-template"]', '{project} {kind}');
    expect(text('[data-testid="export-adv-name-preview"]')).toBe('Alligators digital.png');
    await click('[data-testid="export-adv-token-scale"]');
    expect(text('[data-testid="export-adv-name-preview"]')).toContain('1x');
  });

  test('the command lines are the export, live', async () => {
    estimate = { ...EST_BATCH, byKind: { digital: { artboards: 1, files: 1, format: 'png' } } };
    await mountSheet({ selectedArtboards: ['a1'] });
    await click('[data-testid="export-advanced-toggle"]');
    expect(text('[data-testid="export-adv-cmd-cli"]')).toBe(
      'maude design export png --scope selection --canvas ui/combine.tsx --artboard a1 --option scale=1'
    );
    await type('[data-testid="export-adv-scale"]', '2.5');
    expect(text('[data-testid="export-adv-cmd-cli"]')).toContain('--option scale=2.5');
    expect(text('[data-testid="export-adv-cmd-claude"]')).toStartWith('/design:export png');
  });

  test('a workspace without the render service answers in Where it renders', async () => {
    estimate = { ...EST_BATCH, byKind: { digital: { artboards: 1, files: 1, format: 'png' } } };
    await mountSheet({ selectedArtboards: ['a1'], exportLane: 'none' });
    await click('[data-testid="export-advanced-toggle"]');
    expect($('[data-testid="export-adv-render"]')).not.toBeNull();
    expect(text('[data-testid="export-adv-render-status"]')).toBe('Not set up here');
    expect(text('[data-testid="export-adv-lane-note"]')).toContain('render service');
  });
});

// ── the words lint: mono only inside the fold ────────────────────────────────────────────────────
const EXPORT_DIR = join(import.meta.dir, '../client/v2/export');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : [p];
  });
}

describe('mono only inside the fold (words lint)', () => {
  test('with the fold open every mono element is inside it', async () => {
    estimate = {
      ...EST_BATCH,
      byKind: {
        digital: { artboards: 2, files: 2, format: 'png' },
        video: { artboards: 1, files: 1, format: 'mp4' },
      },
    };
    await mountSheet();
    await click('[data-testid="export-advanced-toggle"]');
    const mono = $$('.ex-mono');
    expect(mono.length).toBeGreaterThan(3);
    const body = $('[data-testid="fold-export-body"]');
    for (const el of mono) expect(body?.contains(el)).toBe(true);
    // and nothing outside the fold is set in the mono family by the sheet's own classes
    for (const el of $$('.ex-sheet *')) {
      if (body?.contains(el)) continue;
      expect(el.className?.toString?.() ?? '').not.toMatch(/mono/);
    }
  });

  test('only the fold’s own stylesheet and files name the mono family or class', () => {
    const files = sources(EXPORT_DIR).filter((p) => /\.(jsx?|css)$/.test(p));
    const offenders = files.filter((p) => {
      const rel = p.slice(EXPORT_DIR.length + 1);
      if (rel.startsWith('advanced/')) return false;
      return /font-mono|ex-mono|k-mono|monospace/.test(
        readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      );
    });
    expect(offenders).toEqual([]);
    const css = readFileSync(join(EXPORT_DIR, 'advanced/advanced.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    );
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*font-family:[^{}]*mono[^{}]*)\}/g)];
    expect(rules.map((r) => r[1]?.trim())).toEqual(['.ex-mono']);
  });

  test('the fold’s words say nothing the contract bans', () => {
    const FILES = ['advanced/advanced-copy.js', 'sections/batch-model.js'];
    const BANNED = /\b(board|screens?|repo|workspace|island|dock|assistant|oops|we|i)\b|!/i;
    for (const f of FILES) {
      const src = readFileSync(join(EXPORT_DIR, f), 'utf8')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const strings = [...src.matchAll(/(['`])((?:\\.|(?!\1)[^\\\n])+)\1/g)].map((m) => m[2] ?? '');
      for (const s of strings) {
        if (!/\s/.test(s)) continue; // ids, tokens, paths — not sentences
        expect(`${f}: ${s}`).not.toMatch(BANNED);
      }
    }
  });
});
