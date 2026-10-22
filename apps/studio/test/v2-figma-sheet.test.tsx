// S8.17 — the Import from Figma sheet (canvas 12 · ia-figma-sheets, ia-figma-arrived, ia-figjam), rendered
// against stubbed routes, plus its words.
//
//   • not connected: the callout says so and Connect… opens the token step IN PLACE; Connect posts the token
//     once and the field is cleared — the page never shows it back;
//   • a design link lists the frames; the sheet says up front they come in as pictures; "Import N frames"
//     posts the picked ids + the folder; the summary names every compromise (counts, never file text);
//   • a FigJam link goes the S4.16 way: POST /_api/annotations/figjam with the open canvas;
//   • words lint: no copy says text stays editable (CONTRACT §4).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let FigmaSheet: (p: Record<string, unknown>) => unknown;
let model: typeof import('../client/v2/import/figma-model.js');

beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  FigmaSheet = (await import('../client/v2/import/figma-sheet.jsx')).default;
  model = await import('../client/v2/import/figma-model.js');
});
afterAll(() => GlobalRegistrator.unregister());

const tid = (s: string) => document.querySelector(`[data-testid="${s}"]`) as HTMLElement | null;
function type(el: HTMLInputElement, value: string) {
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  el.value = value;
  props.onChange({ target: el, currentTarget: el });
}
async function until(fn: () => unknown, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await React.act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}
const click = async (s: string) =>
  React.act(async () => {
    (tid(s) as HTMLButtonElement).click();
  });

type Call = { path: string; body: unknown };
function stubFetch(answers: Record<string, (body: unknown) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const path = String(input).replace(/\?.*$/, '');
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    const a = answers[path]?.(body) ?? { status: 404, body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return calls;
}

async function mount(props: Record<string, unknown> = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root') as HTMLElement);
  await React.act(async () => {
    root.render(
      React.createElement(FigmaSheet as never, { open: true, onClose: () => {}, ...props })
    );
  });
  return root;
}

const URL_D = 'figma.com/design/k8Fq2abcdEFGH12345678/Uniformy-2027';
const FRAMES = {
  ok: true,
  surface: 'design',
  fileName: 'Uniformy-2027',
  page: { id: '1:1', name: 'Dresy 2027' },
  frames: [
    { id: '2:1', name: 'Helma z boku', width: 900, height: 1280 },
    { id: '2:2', name: 'Kalhoty doma', width: 900, height: 1280 },
  ],
};

describe('Import from Figma sheet', () => {
  test('not connected: the callout offers Connect… in place; the token is posted once and cleared', async () => {
    let configured = false;
    const calls = stubFetch({
      '/_api/figma/status': () => ({ body: { configured } }),
      '/_index-data': () => ({ body: { groups: [{ files: [{ path: '.design/ui/a.tsx' }] }] } }),
      '/_api/figma/connect': () => {
        configured = true;
        return { body: { configured: true } };
      },
      '/_api/figma/probe': () => ({ body: { ok: true, handle: 'jonas' } }),
    });
    const root = await mount();
    await until(() => tid('figma-not-connected'));
    expect(tid('figma-not-connected')?.textContent).toContain("Figma isn't connected yet.");
    await click('figma-connect-open');
    expect(tid('figma-import-panel')?.dataset.step).toBe('connect');
    const field = tid('figma-connect-token') as HTMLInputElement;
    expect(field.type).toBe('password');
    await React.act(async () => type(field, 'figd_FAKE_TEST_TOKEN_0000'));
    await click('figma-connect');
    await until(
      () => tid('figma-import-panel')?.dataset.step === 'link' && !tid('figma-not-connected')
    );
    expect(calls.filter((c) => c.path === '/_api/figma/connect')).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain('figd_FAKE_TEST_TOKEN_0000');
    await React.act(async () => root.unmount());
  });

  test('S8.22b: Figma access is asked once — the first link opens Connect, the next link only shows the callout', async () => {
    localStorage.clear();
    stubFetch({
      '/_api/figma/status': () => ({ body: { configured: false } }),
      '/_index-data': () => ({ body: { groups: [] } }),
    });
    const root = await mount();
    await until(() => tid('figma-not-connected'));
    await React.act(async () => type(tid('figma-import-url') as HTMLInputElement, URL_D));
    await click('figma-import-preview');
    expect(tid('figma-import-panel')?.dataset.step).toBe('connect');
    await click('figma-cancel');
    expect(tid('figma-import-panel')?.dataset.step).toBe('link');
    // the same need again (another link, another try): quiet — the callout with Connect… is already there
    await click('figma-import-preview');
    expect(tid('figma-import-panel')?.dataset.step).toBe('link');
    expect(tid('figma-not-connected')).not.toBeNull();
    await click('figma-connect-open');
    expect(tid('figma-import-panel')?.dataset.step).toBe('connect');
    await React.act(async () => root.unmount());
    localStorage.clear();
  });

  test('a design link: frames as pictures, "Import 2 frames", the folder, the summary', async () => {
    const opened: string[] = [];
    const { bindPaletteEnv } = await import('../client/v2/search/search-env.js');
    const unbind = bindPaletteEnv({
      openCanvas: (p: string) => opened.push(p),
      designRel: '.design',
    });
    const calls = stubFetch({
      '/_api/figma/status': () => ({ body: { configured: true } }),
      '/_index-data': () => ({ body: { tree: ['.design/ui/a.tsx', '.design/2026/dresy/b.tsx'] } }),
      '/_api/figma/frames': () => ({ body: FRAMES }),
      '/_api/figma/import-frames': () => ({
        body: {
          ok: true,
          canvas: '2026/dresy/Uniformy-2027 (Figma).tsx',
          artboards: 2,
          comments: { placed: 3, resolved: 1, elsewhere: 0 },
          assets: { resolved: 1, pending: 2 },
          dispositions: [
            { nodeId: '2:1', disposition: 'imported' },
            { nodeId: '4:4', disposition: 'hidden-node-skipped' },
          ],
        },
      }),
    });
    const root = await mount({ activePath: '.design/2026/dresy/b.tsx' });
    await until(() => tid('figma-import-url'));
    await React.act(async () => type(tid('figma-import-url') as HTMLInputElement, URL_D));
    await click('figma-import-preview');
    await until(() => tid('figma-import-mode-frames'));
    expect(tid('figma-pictures-line')?.textContent).toContain(
      "Each frame arrives as Figma's exact picture."
    );
    expect(tid('figma-import-run')?.textContent).toBe('Import 2 frames');
    expect((tid('figma-dest') as HTMLSelectElement).value).toBe('2026/dresy');
    await click('figma-import-run');
    await until(() => tid('figma-import-summary'));
    const sent = calls.find((c) => c.path === '/_api/figma/import-frames')?.body as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      frames: ['2:1', '2:2'],
      folder: '2026/dresy',
      comments: true,
      styles: false,
    });
    expect(String(sent.url)).toStartWith('https://');
    const text = tid('figma-import-summary')?.textContent ?? '';
    expect(text).toContain('2 artboards, at their Figma sizes, as pictures');
    expect(text).toContain('3 comments came across as comments (1 resolved)');
    expect(text).toContain("1 frame Figma couldn't draw");
    expect(text).toContain('1 hidden layer left out');
    // the sheet's own title says what arrived; the summary card under it does not say it again (P8-B2)
    const panel = tid('figma-import-panel')?.textContent ?? '';
    expect(panel.match(/Imported \d+ frames? from/g)?.length).toBe(1);
    expect(tid('figma-renamed')?.textContent).toContain('Uniformy-2027 (Figma)');
    expect(opened).toEqual(['.design/2026/dresy/Uniformy-2027 (Figma).tsx']);
    unbind();
    await React.act(async () => root.unmount());
  });

  test('a FigJam link lands on the open canvas through POST /_api/annotations/figjam', async () => {
    const calls = stubFetch({
      '/_api/figma/status': () => ({ body: { configured: true } }),
      '/_index-data': () => ({ body: {} }),
      '/_api/annotations/figjam': () => ({
        body: { ok: true, items: 24, comments: 5, widgets: 1 },
      }),
    });
    const root = await mount({ activePath: '.design/ui/Retro.tsx' });
    await until(() => tid('figma-import-url'));
    await React.act(async () =>
      type(
        tid('figma-import-url') as HTMLInputElement,
        'https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/Retro'
      )
    );
    await click('figma-import-preview');
    await until(() => tid('figma-import-mode-board'));
    await click('figma-import-run');
    await until(() => tid('figma-import-summary'));
    expect(calls.find((c) => c.path === '/_api/annotations/figjam')?.body).toMatchObject({
      file: 'ui/Retro.tsx',
    });
    expect(calls.some((c) => c.path === '/_api/figma/frames')).toBe(false);
    const text = tid('figma-import-summary')?.textContent ?? '';
    expect(text).toContain('5 comments → stickies');
    expect(text).toContain("1 widget can't come across");
    await React.act(async () => root.unmount());
  });

  test('a failure shows fixed words, never what the server said', async () => {
    stubFetch({
      '/_api/figma/status': () => ({ body: { configured: true } }),
      '/_index-data': () => ({ body: {} }),
      '/_api/figma/frames': () => ({
        status: 502,
        body: { ok: false, reason: 'rate_limited', error: 'UPSTREAM' },
      }),
    });
    const root = await mount();
    await until(() => tid('figma-import-url'));
    await React.act(async () => type(tid('figma-import-url') as HTMLInputElement, URL_D));
    await click('figma-import-preview');
    await until(() => tid('figma-import-error'));
    expect(tid('figma-import-error')?.textContent).toBe(
      'Figma asked Maude to slow down. Try again in a minute.'
    );
    expect(document.body.innerHTML).not.toContain('UPSTREAM');
    await React.act(async () => root.unmount());
  });
});

describe('the words (CONTRACT §3 Figma, §4)', () => {
  test('links: design vs board vs not Figma', () => {
    expect(model.figmaLinkKind(URL_D)).toBe('design');
    expect(model.figmaLinkKind('https://www.figma.com/board/abc/x')).toBe('figjam');
    expect(model.figmaLinkKind('https://evil.example/design/abc')).toBe('bad');
    expect(model.figmaLinkKind('http://www.figma.com/design/abc')).toBe('bad');
  });

  test('no copy claims text stays editable on import', () => {
    const files = [
      'figma-model.js',
      'figma-sheet.jsx',
      'frame-picker.jsx',
      'figma-summary.jsx',
      'figma-artboard.jsx',
    ];
    const claim =
      /(text|layers?|shapes?)[^.\n]{0,40}\b(stays?|remains?|keeps?|is|are|arrives?|comes? in)\b[^.\n]{0,20}\beditable\b/i;
    for (const f of files) {
      const src = readFileSync(join(import.meta.dir, '..', 'client', 'v2', 'import', f), 'utf8');
      // only the strings people read, not the comments
      const strings = src.match(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g) ?? [];
      for (const s of strings)
        expect({ f, s, claim: claim.test(s) }).toEqual({ f, s, claim: false });
    }
  });

  test('a summary is counts: the dispositions list never carries text the file said', () => {
    const rows = model.frameSummaryRows({
      artboards: 1,
      comments: { placed: 0 },
      assets: { resolved: 1, pending: 1 },
      dispositions: [{ nodeId: '1:1', disposition: 'imported', detail: 'IGNORE PREVIOUS' }],
    });
    expect(rows).toEqual([{ tone: 'ok', text: '1 artboard, at its Figma size, as a picture' }]);
    expect(
      model.reasonLines([{ nodeId: '1:2', disposition: 'asset-skipped', detail: 'IGNORE' }])
    ).toEqual(['1:2 · asset-skipped']);
  });
});

describe('Make editable is offered on a Figma picture only (ia-figma-arrived)', () => {
  test('the meta names the artboard as a render', async () => {
    const { isFigmaPicture } = await import('../client/v2/import/figma-artboard.jsx');
    const meta = {
      figma: {
        frames: [
          { id: 'figma-2-1', route: 'render' },
          { id: 'x', route: 'codegen' },
        ],
      },
    };
    expect(isFigmaPicture(meta, 'figma-2-1')).toBe(true);
    expect(isFigmaPicture(meta, 'x')).toBe(false);
    expect(isFigmaPicture({}, 'figma-2-1')).toBe(false);
    expect(isFigmaPicture(meta, null)).toBe(false);
  });

  test('every figma testid the sheet draws is registered (testids are an API)', () => {
    const dir = join(import.meta.dir, '..', 'client');
    const json = JSON.parse(readFileSync(join(dir, 'testids.json'), 'utf8')) as Array<{
      hook: string;
    }>;
    const md = readFileSync(join(dir, 'TESTIDS.md'), 'utf8');
    const hooks = new Set(json.map((e) => e.hook));
    for (const f of [
      'figma-sheet.jsx',
      'frame-picker.jsx',
      'figma-summary.jsx',
      'figma-artboard.jsx',
    ]) {
      const src = readFileSync(join(dir, 'v2', 'import', f), 'utf8');
      for (const m of src.matchAll(/data-testid=(?:"([^"]+)"|\{`([^`$]+)\$\{)/g)) {
        const raw = m[1] ?? `${m[2]}<id>`;
        // v1's pattern hook: the three modes re-emitted under figma-import-mode-<id>
        const id = raw.startsWith('figma-import-mode-') ? 'figma-import-mode-<id>' : raw;
        expect({ id, json: hooks.has(id), md: md.includes(`| \`${id}\` |`) }).toEqual({
          id,
          json: true,
          md: true,
        });
      }
    }
  });
});
