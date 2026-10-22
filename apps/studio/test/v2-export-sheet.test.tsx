// S8.2 — the one Export sheet (client/v2/export/): Scope on top with every count, the kind's own
// section (post → PNG/JPG, web → full page or PDF), Other… with a reason on every disabled row, the
// title's verb equal to the button's, ↵ runs it, a one-time Copy link line, the v1 testids re-emitted.
//
// Two halves: the pure model (use-export-spec.js / export-copy.js, no DOM) and the real sheet mounted
// under happy-dom + React with a recording `fetch` stub.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { estimateWords as cliEstimateWords } from '../../../cli/lib/export-spec.mjs';
import {
  estimateWords,
  matchOther,
  OTHER_GROUPS,
  otherFormats,
  peopleWords,
  primaryLabel,
  sheetTitle,
} from '../client/v2/export/export-copy.js';
import {
  browserLaneRequest,
  buildSpec,
  initialState,
  openExport,
  quickExport,
  registerExportOpener,
  scopeAvailability,
  scopeForFormat,
  sectionKind,
  setExportPeople,
} from '../client/v2/export/use-export-spec.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// ── the model ────────────────────────────────────────────────────────────────────────────────────
describe('the sheet model', () => {
  test('⇧⌘E with nothing selected opens This canvas — never the project', () => {
    expect(initialState({ mode: 'export' }, { hasSelection: false }).scope).toBe('canvas');
    expect(initialState({ mode: 'export' }, { hasSelection: true }).scope).toBe('selection');
    expect(initialState({}, { hasSelection: false }).nothingSelected).toBe(true);
  });

  test('P8 B1: ⇧⌘E with no canvas open opens Whole project — there is no “this canvas” to name', () => {
    // it opened on `Export “”` with This canvas on, and the button answered {"error":"bad-spec"}
    const s = initialState({ mode: 'export' }, { hasSelection: false, canvasOpen: false });
    expect([s.scope, s.nothingSelected]).toEqual(['project', false]);
    // a stale ask for the canvas or a selection moves too
    expect(
      initialState({ scope: 'canvas' }, { canvasOpen: false, hasSelection: false }).scope
    ).toBe('project');
    expect(initialState({}, { canvasOpen: false, hasSelection: true }).scope).toBe('project');
    // a canvas open: untouched
    expect(initialState({}, { canvasOpen: true, hasSelection: false }).scope).toBe('canvas');
  });

  test('S2.13: the Export area opens This canvas with its region as ONE picture (unit one)', () => {
    const region = { rect: { x: 10, y: 20, w: 300, h: 200 } };
    const s = initialState(
      { mode: 'export', scope: 'canvas', region, unit: 'one' },
      { hasSelection: true }
    );
    expect([s.scope, s.region, s.unit]).toEqual(['canvas', region, 'one']);
    const spec = buildSpec(s, { designRel: '.design', activePath: '.design/a.tsx' });
    expect([spec.scope, spec.region, spec.unit]).toEqual(['canvas', region, 'one']);
    // no region: a unit alone is never sent
    const bare = initialState({ scope: 'canvas', unit: 'one' }, { hasSelection: false });
    expect(
      buildSpec(bare, { designRel: '.design', activePath: '.design/a.tsx' }).unit
    ).toBeUndefined();
  });

  test('the world menu’s Export project ZIP opens Whole project on ZIP', () => {
    const s = initialState({ scope: 'project', format: 'zip' }, { hasSelection: true });
    expect([s.scope, s.format]).toEqual(['project', 'zip']);
    // the v1 spelling of the same entry
    const legacy = initialState({ scope: 'project-raw' }, { hasSelection: false });
    expect([legacy.scope, legacy.format]).toEqual(['project', 'zip']);
  });

  test('the inspector’s buttons carry format and scale', () => {
    const s = initialState({ scope: 'selection', format: 'png', scale: 2 }, { hasSelection: true });
    expect([s.scope, s.format, s.scale]).toEqual(['selection', 'png', 2]);
  });

  test('a format that cannot take the scope moves the scope (zip → project, pptx → canvas)', () => {
    expect(scopeForFormat('zip', 'selection')).toBe('project');
    expect(scopeForFormat('pptx', 'selection')).toBe('canvas');
    expect(scopeForFormat('png', 'folder')).toBe('folder');
  });

  test('buildSpec: designRoot-relative canvas, selection ids, size only for raster', () => {
    const ctx = {
      designRel: '.design',
      activePath: '.design/2026/combine/Kampan.tsx',
      artboards: ['a1', 'a2'],
      elements: [],
    };
    const base = { annotations: false, region: null, at: null };
    expect(buildSpec({ ...base, scope: 'selection', format: 'png', scale: 2 }, ctx)).toEqual({
      v: 2,
      scope: 'selection',
      format: 'png',
      canvas: '2026/combine/Kampan.tsx',
      selection: { artboards: ['a1', 'a2'] },
      options: { size: { scale: 2 } },
    });
    expect(buildSpec({ ...base, scope: 'folder', format: 'pdf', scale: null }, ctx)).toEqual({
      v: 2,
      scope: 'folder',
      format: 'pdf',
      folder: '2026/combine',
    });
    expect(buildSpec({ ...base, scope: 'project', format: 'zip', scale: null }, ctx)).toEqual({
      v: 2,
      scope: 'project',
      format: 'zip',
    });
    // elements win over artboards (V2-1.4 ids, never CSS)
    const el = buildSpec(
      { ...base, scope: 'selection', format: 'svg', scale: null },
      { ...ctx, elements: ['e1'] }
    );
    expect(el.selection).toEqual({ elements: ['e1'] });
    // annotations only when asked
    expect(
      buildSpec({ ...base, annotations: true, scope: 'canvas', format: 'png', scale: 1 }, ctx)
        .options
    ).toEqual({ size: { scale: 1 }, annotations: true });
  });

  test('a web page defaults to 2×, a post to 1×', () => {
    const ctx = { designRel: '.design', activePath: '.design/a.tsx' };
    const base = {
      annotations: false,
      region: null,
      at: null,
      scope: 'canvas',
      format: 'png',
      scale: null,
    };
    expect(buildSpec(base, { ...ctx, kind: 'web' }).options).toEqual({ size: { scale: 2 } });
    expect(buildSpec(base, { ...ctx, kind: 'digital' }).options).toEqual({ size: { scale: 1 } });
  });

  test('every scope shows its count; "—" and off for an empty one', () => {
    const counts = { selection: null, canvas: 21, folder: 38, project: 524 };
    expect(scopeAvailability(counts)).toEqual({
      selection: false,
      canvas: true,
      folder: true,
      project: true,
    });
    // before the server answers the facts around the sheet decide
    expect(scopeAvailability(null, { hasSelection: false }).selection).toBe(false);
    expect(scopeAvailability(null, { hasSelection: true }).selection).toBe(true);
  });

  test('the section follows the artboards the spec reaches', () => {
    expect(sectionKind({ byKind: { web: { artboards: 1 } } })).toBe('web');
    expect(sectionKind({ byKind: { web: { artboards: 1 }, digital: { artboards: 2 } } })).toBe(
      'image'
    );
    expect(sectionKind(null)).toBe('image');
  });

  test('the browser lane takes png/svg of one artboard and the deck, nothing else', () => {
    const ctx = { exportLane: 'none', activePath: '.design/a.tsx', artboards: ['b1'] };
    const base = { annotations: false, scale: null };
    expect(browserLaneRequest({ ...base, scope: 'selection', format: 'png' }, ctx)).toEqual({
      format: 'png',
      scope: 'artboard',
      options: { artboardId: 'b1', scale: 1, canvasFile: '.design/a.tsx' },
    });
    expect(browserLaneRequest({ ...base, scope: 'canvas', format: 'pptx' }, ctx)?.scope).toBe(
      'canvas-as-separate'
    );
    expect(browserLaneRequest({ ...base, scope: 'canvas', format: 'pdf' }, ctx)).toBeNull();
    expect(
      browserLaneRequest(
        { ...base, scope: 'selection', format: 'png' },
        { ...ctx, exportLane: 'local' }
      )
    ).toBeNull();
  });
});

describe('the words', () => {
  test('the title’s verb is the button’s verb', () => {
    const cases = [
      { scope: 'selection', label: 'DOMA · Post', canvas: 'matchday', count: 1 },
      { scope: 'selection', canvas: 'kampan', count: 5 },
      { scope: 'canvas', canvas: 'Combine-kampan', count: 21 },
      { scope: 'folder', canvas: 'x', folder: 'combine', count: 38 },
      { scope: 'project', canvas: 'x', count: 524 },
    ];
    for (const c of cases) {
      const title = sheetTitle(c);
      const button = primaryLabel({ count: c.count });
      expect(title.split(' ')[0]).toBe(button.split(' ')[0]);
    }
    expect(sheetTitle({ scope: 'canvas', canvas: 'Combine-kampan', count: 21 })).toBe(
      'Export “Combine-kampan” — 21 artboards'
    );
    expect(primaryLabel({ count: 21 })).toBe('Export 21 artboards');
    expect(primaryLabel({ count: 1 })).toBe('Export');
  });

  test('the estimate sentence equals the CLI’s (one set of words)', () => {
    for (const est of [
      { files: 1, bytes: 1_400_000, seconds: 1, lane: 'this-mac' },
      { files: 21, bytes: 140_000_000, seconds: 20, lane: 'this-mac' },
      { files: 3, bytes: 9_100_000, seconds: 8, lane: 'cloud' },
      { files: 115, bytes: 2_400_000_000, seconds: 300, lane: 'this-mac' },
    ])
      expect(estimateWords(est)).toBe(cliEstimateWords(est));
    expect(estimateWords({ files: 21, bytes: 140_000_000, seconds: 20, lane: 'this-mac' })).toBe(
      '21 files · about 140 MB · about 20 seconds on this Mac'
    );
  });

  test('Other… lists every old format; a disabled one says why; search finds all', () => {
    const groups = otherFormats({ kinds: new Set(['digital']), laneBlocked: () => false });
    const rows = groups.flatMap((g) => g.items);
    const ids = rows.map((r) => r.id);
    for (const id of [
      'png',
      'jpg',
      'svg',
      'pdf',
      'print-pdf',
      'pptx',
      'mp4',
      'gif',
      'webm',
      'audio',
      'canva',
      'html',
      'shadcn',
      'zip',
    ])
      expect(ids).toContain(id);
    const off = rows.filter((r) => r.disabled);
    expect(off.map((r) => r.id).sort()).toEqual(['audio', 'gif', 'mp4', 'print-pdf', 'webm']);
    for (const r of off) expect(r.reason).toMatch(/^Needs a (print|video) artboard$/);
    // with a video artboard in scope the video rows come on
    const withVideo = otherFormats({ kinds: new Set(['video']), laneBlocked: () => false })
      .flatMap((g) => g.items)
      .filter((r) => r.disabled)
      .map((r) => r.id);
    expect(withVideo).toEqual(['print-pdf']);
    // search finds every row, enabled or not
    for (const r of rows)
      expect(matchOther(groups, r.label).flatMap((g) => g.items.map((i) => i.id))).toContain(r.id);
    expect(matchOther(groups, 'sound').flatMap((g) => g.items.map((i) => i.id))).toEqual(['audio']);
    expect(matchOther(groups, 'zzz')).toEqual([]);
    expect(OTHER_GROUPS.map((g) => g.group)).toEqual([
      'Image',
      'Document',
      'Video',
      'For other tools',
      'Whole project',
    ]);
  });

  test('a lane that cannot render a format says so on the row', () => {
    const groups = otherFormats({
      kinds: new Set(['digital']),
      laneBlocked: (f: string) => f === 'pdf' || f === 'canva',
    });
    const byId = Object.fromEntries(groups.flatMap((g) => g.items).map((r) => [r.id, r]));
    expect(byId.pdf.disabled).toBe(true);
    expect(byId.pdf.reason).toContain('render service');
    expect(byId.canva.reason).toBe('Needs the desktop app');
  });

  test('people read as a sentence', () => {
    expect(peopleWords(['Tereza'])).toBe('Tereza');
    expect(peopleWords(['Tereza', 'Jonas'])).toBe('Tereza and Jonas');
    expect(peopleWords(['A', 'B', 'C', 'D'])).toBe('A, B and 2 others');
  });
});

describe('openExport / quickExport', () => {
  test('openExport hands the shell the spec; false when no shell is there', () => {
    expect(openExport({ scope: 'project', format: 'zip' })).toBe(false);
    const seen: unknown[] = [];
    const off = registerExportOpener((r: unknown) => seen.push(r));
    expect(openExport({ scope: 'project', format: 'zip' })).toBe(true);
    expect(seen).toEqual([{ mode: 'export', scope: 'project', format: 'zip' }]);
    off();
    expect(openExport({})).toBe(false);
  });

  test('quickExport posts the v2 body with no sheet and returns the job', async () => {
    let sent: { url: string; body: unknown } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ jobId: 'j1' }), { status: 202 });
    }) as unknown as typeof fetch;
    const spec = { v: 2, scope: 'selection', format: 'png' };
    expect(await quickExport(spec as never, fake)).toEqual({ jobId: 'j1' });
    expect(sent).toEqual({ url: '/_api/export-jobs', body: { v: 2, spec } });
  });
});

// ── the sheet ────────────────────────────────────────────────────────────────────────────────────
interface Call {
  method: string;
  url: string;
  body?: { v?: number; spec?: Record<string, unknown>; format?: string };
}
let calls: Call[] = [];
let estimate: Record<string, unknown> = {};
const realFetch = globalThis.fetch;

const EST_CANVAS = {
  counts: { selection: null, canvas: 21, folder: 38, project: 524 },
  files: 21,
  bytes: 140_000_000,
  seconds: 20,
  lane: 'this-mac',
  byKind: { digital: { artboards: 19, files: 19, format: 'png' } },
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
beforeEach(() => {
  estimate = EST_CANVAS;
  try {
    localStorage.clear();
  } catch {}
  setExportPeople([]);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const tick = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const has = (sel: string) => $(sel) !== null;
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const click = async (sel: string) => {
  const el = $(sel);
  expect(el !== null).toBe(true);
  await act(async () => {
    el?.click();
    await tick(10);
  });
};
const specOptions = () =>
  (posts()[0].body?.spec?.options ?? {}) as { annotations?: boolean; size?: unknown };
const posts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/_api/export-jobs'));

async function mountSheet(props: Record<string, unknown> = {}) {
  stubFetch();
  const { ExportDialog } = await import('../client/dialogs/export-dialog.jsx');
  let closed = 0;
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
        onClose={() => {
          closed++;
        }}
        {...props}
      />
    );
    await tick();
  });
  // effects flush when act exits: the estimate's debounce starts there, so settle once more
  await act(async () => {
    await tick();
  });
  return { closed: () => closed };
}

describe('the sheet: Scope', () => {
  test('nothing selected → This canvas, with every count and "—" for the empty one', async () => {
    await mountSheet();
    expect($('[data-testid="export-scope"]')?.getAttribute('data-value')).toBe('canvas');
    expect(text('[data-testid="export-scope-selection"]')).toContain('—');
    expect(text('[data-testid="export-scope-canvas"]')).toContain('21');
    expect(text('[data-testid="export-scope-folder"]')).toContain('38');
    expect(text('[data-testid="export-scope-project"]')).toContain('524');
    expect(($('[data-testid="export-scope-selection"]') as HTMLButtonElement).disabled).toBe(true);
    expect($('[data-testid="export-sub"]')?.textContent).toContain('nothing was selected');
  });

  test('title = button verb; the count is on both; the summary is the server’s numbers', async () => {
    await mountSheet();
    expect(text('[data-testid="export-title"]')).toBe('Export “combine” — 21 artboards');
    expect(text('[data-testid="export-submit-label"]')).toBe('Export 21 artboards');
    expect(text('[data-testid="export-summary"]')).toBe(
      '21 files · about 140 MB · about 20 seconds on this Mac'
    );
  });

  test('a selection opens Selection; a canvas-only session has Folder and Whole project off', async () => {
    estimate = {
      ...EST_CANVAS,
      counts: { selection: 1, canvas: 3, folder: null, project: null },
      files: 1,
      bytes: 1_400_000,
      seconds: 1,
    };
    await mountSheet({ hasSelection: true, selectedArtboards: ['a1'], selectionLabel: 'Hero' });
    expect($('[data-testid="export-scope"]')?.getAttribute('data-value')).toBe('selection');
    expect(text('[data-testid="export-title"]')).toBe('Export “Hero”');
    expect(text('[data-testid="export-submit-label"]')).toBe('Export');
    expect(($('[data-testid="export-scope-folder"]') as HTMLButtonElement).disabled).toBe(true);
    expect(($('[data-testid="export-scope-project"]') as HTMLButtonElement).disabled).toBe(true);
    expect(text('[data-testid="export-scope-folder"]')).toContain('—');
  });

  test('picking a scope moves the title and the posted spec', async () => {
    await mountSheet();
    await click('[data-testid="export-scope-project"]');
    expect($('[data-testid="export-scope"]')?.getAttribute('data-value')).toBe('project');
    expect(text('[data-testid="export-title"]')).toBe('Export the whole project — 524 artboards');
    await click('[data-testid="export-submit"]');
    expect(posts().map((c) => c.body?.spec)).toEqual([
      { v: 2, scope: 'project', format: 'png', options: { size: { scale: 1 } } },
    ]);
  });
});

describe('the sheet: Social → PNG or JPG, 1× or 2×', () => {
  test('offers PNG/JPG and 1×/2×; picking JPG 2× posts exactly that', async () => {
    await mountSheet();
    for (const id of ['export-format-png', 'export-format-jpg', 'export-size-1x', 'export-size-2x'])
      expect(has(`[data-testid="${id}"]`)).toBe(true);
    await click('[data-testid="export-format-jpg"]');
    await click('[data-testid="export-size-2x"]');
    await click('[data-testid="export-submit"]');
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body?.spec).toEqual({
      v: 2,
      scope: 'canvas',
      format: 'jpg',
      canvas: 'ui/combine.tsx',
      options: { size: { scale: 2 } },
    });
  });

  test('annotations are opt-in and ride the spec', async () => {
    await mountSheet();
    const box = $('[data-testid="export-include-annotations"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await click('[data-testid="export-include-annotations"]');
    await click('[data-testid="export-submit"]');
    expect(specOptions().annotations).toBe(true);
  });

  test('the inspector’s PNG 2× opens with 2× picked', async () => {
    await mountSheet({
      hasSelection: true,
      selectedArtboards: ['a1'],
      request: { mode: 'export', scope: 'selection', format: 'png', scale: 2 },
    });
    expect($('[data-testid="export-size-2x"]')?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('the sheet: Web → full page, or PDF', () => {
  test('a web artboard shows Image/PDF and the size choices; PDF posts a pdf', async () => {
    estimate = {
      ...EST_CANVAS,
      byKind: { web: { artboards: 3, files: 3, format: 'png' } },
      counts: { selection: 1, canvas: 3, folder: null, project: 11 },
    };
    await mountSheet({ hasSelection: true, selectedArtboards: ['d'] });
    expect($('[data-testid="export-rows"]')?.getAttribute('data-section')).toBe('web');
    expect($('[data-testid="export-format-web-image"]')?.getAttribute('aria-checked')).toBe('true');
    expect(text('[data-testid="export-row-size"]')).toContain('PNG 2×');
    expect(text('[data-testid="export-row-area"]')).toContain('Full page');
    expect(has('[data-testid="export-code-line"]')).toBe(true);
    await click('[data-testid="export-format-pdf"]');
    expect(has('[data-testid="export-row-size"]')).toBe(false);
    await click('[data-testid="export-submit"]');
    expect(posts()[0].body?.spec?.format).toBe('pdf');
  });

  test('the web default is PNG 2×', async () => {
    estimate = { ...EST_CANVAS, byKind: { web: { artboards: 3, files: 3, format: 'png' } } };
    await mountSheet();
    await click('[data-testid="export-submit"]');
    expect(specOptions().size).toEqual({ scale: 2 });
  });
});

describe('the sheet: Other…', () => {
  test('opens a list with the v1 hooks; disabled rows carry their reason; search finds them', async () => {
    await mountSheet();
    expect(has('[data-testid="export-other-menu"]')).toBe(false);
    await click('[data-testid="export-other"]');
    expect(has('[data-testid="export-other-menu"]')).toBe(true);
    for (const f of ['png', 'pdf', 'svg', 'html', 'pptx', 'mp4', 'gif', 'canva', 'zip', 'shadcn'])
      expect(has(`[data-testid="export-format-${f}"]`)).toBe(true);
    const mp4 = $('[data-testid="export-format-mp4"]');
    expect(mp4?.getAttribute('aria-disabled')).toBe('true');
    expect(mp4?.getAttribute('data-reason')).toBe('Needs a video artboard');
    expect($('[data-testid="export-format-print-pdf"]')?.getAttribute('data-reason')).toBe(
      'Needs a print artboard'
    );
    // search
    const search = $('[data-testid="export-other-search"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'sound');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(10);
    });
    expect(has('[data-testid="export-format-audio"]')).toBe(true);
    expect(has('[data-testid="export-other-menu"] [data-testid="export-format-png"]')).toBe(false);
  });

  test('picking SVG there exports SVG; the row shows the chip', async () => {
    await mountSheet();
    await click('[data-testid="export-other"]');
    await click('[data-testid="export-format-svg"]');
    expect(has('[data-testid="export-other-menu"]')).toBe(false);
    expect($('[data-testid="export-format-svg"]')?.getAttribute('aria-checked')).toBe('true');
    await click('[data-testid="export-submit"]');
    expect(posts()[0].body?.spec?.format).toBe('svg');
  });

  test('Project ZIP there moves the scope to Whole project', async () => {
    await mountSheet();
    await click('[data-testid="export-other"]');
    await click('[data-testid="export-format-zip"]');
    expect($('[data-testid="export-scope"]')?.getAttribute('data-value')).toBe('project');
    await click('[data-testid="export-submit"]');
    expect(posts()[0].body?.spec).toMatchObject({ scope: 'project', format: 'zip' });
  });

  test('Code… switches the sheet to the handoff view; its verb is Copy', async () => {
    await mountSheet();
    await click('[data-testid="export-other"]');
    await click('[data-testid="export-format-shadcn"]');
    expect($('[data-testid="export-sheet"]')?.getAttribute('data-mode')).toBe('handoff');
    expect(text('[data-testid="export-title"]').split(' ')[0]).toBe(
      text('[data-testid="export-submit-label"]').split(' ')[0]
    );
  });

  test('esc closes the menu first, then the sheet', async () => {
    const sheet = await mountSheet();
    await click('[data-testid="export-other"]');
    await act(async () => {
      $('[data-testid="export-other-search"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await tick(10);
    });
    expect(has('[data-testid="export-other-menu"]')).toBe(false);
    expect(sheet.closed()).toBe(0);
    await act(async () => {
      $('[data-testid="export-sheet"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await tick(10);
    });
    expect(sheet.closed()).toBe(1);
  });
});

describe('the sheet: esc with focus on <body>', () => {
  test('P8 B1: the Export button disables itself while it works and focus drops to <body>; esc still closes', async () => {
    const sheet = await mountSheet();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await tick(10);
    });
    expect(sheet.closed()).toBe(1);
  });
});

describe('the sheet: ↵ runs it', () => {
  test('return on a segment submits once and closes the sheet on enqueue', async () => {
    const sheet = await mountSheet();
    await act(async () => {
      $('[data-testid="export-size-2x"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      await tick(20);
    });
    expect(posts()).toHaveLength(1);
    expect(sheet.closed()).toBe(1);
  });

  test('a refused job keeps the sheet open and says why', async () => {
    const sheet = await mountSheet();
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/_api/export-jobs')
        ? new Response('nope', { status: 500 })
        : real(input, init)) as typeof fetch;
    await click('[data-testid="export-submit"]');
    expect(sheet.closed()).toBe(0);
    expect($('[data-testid="export-status"]')?.getAttribute('data-ok')).toBe('0');
    expect(text('[data-testid="export-status"]')).toContain('nope');
  });
});

describe('the sheet: Share vs Export', () => {
  test('when people are in the project, one line offers Copy link — once', async () => {
    setExportPeople(['Tereza', 'Jonas']);
    await mountSheet();
    expect(text('[data-testid="export-share-hint"]')).toContain(
      'Tereza and Jonas are in this project. A link shows them the latest, with comments.'
    );
    expect(text('[data-testid="export-share-hint"]')).toContain('Copy link');
    // the next opening does not repeat it
    act(() => root?.unmount());
    host?.remove();
    await mountSheet();
    expect(has('[data-testid="export-share-hint"]')).toBe(false);
  });

  test('alone in the project: no line', async () => {
    await mountSheet();
    expect(has('[data-testid="export-share-hint"]')).toBe(false);
  });
});

describe('the v1 testids are re-emitted', () => {
  test('export-scope · export-submit · export-include-annotations · export-format-* all exist', async () => {
    await mountSheet();
    for (const id of [
      'export-scope',
      'export-submit',
      'export-include-annotations',
      'export-format-png',
    ])
      expect(has(`[data-testid="${id}"]`)).toBe(true);
  });

  test('the lane note is still shown on a workspace with no render service', async () => {
    await mountSheet({ exportLane: 'none' });
    expect(has('[data-testid="export-lane-note"]')).toBe(true);
    await click('[data-testid="export-other"]');
    expect($('[data-testid="export-format-pdf"]')?.getAttribute('aria-disabled')).toBe('true');
    expect($('[data-testid="export-format-pdf"]')?.getAttribute('data-reason')).toContain(
      'render service'
    );
  });
});
