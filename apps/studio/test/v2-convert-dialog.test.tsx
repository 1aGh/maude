// S7.25 — Change kind in the inspector (08 ak-convert, ak-convert-after) and the one warning style's top rows (ak-warnings).
// Real markup, real registry; only fetch is faked. A paper picked in a fixed size's Size select opens a dialog that says what
// changes, and the write is ONE edit-op request; a warning the canvas stamped on the artboard is a row with one verb.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Sent = { url: string; method: string; body: unknown };
const sent: Sent[] = [];
const realFetch = globalThis.fetch;
let planCheck: unknown = { ok: true, measured: true, check: [] };
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('.css')) return new Response(':root{--space-4:16px}', { status: 200 });
    if (u.startsWith('/_api/kinds/convert-plan'))
      return new Response(JSON.stringify(planCheck), { status: 200 });
    sent.push({
      url: u,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (u === '/_api/edit-op')
      return new Response(
        JSON.stringify({
          ok: true,
          detail: {
            copy: true,
            artboard: 'ig-a6',
            label: 'Oznámení · A6',
            madeFrom: { artboard: 'ig', label: 'Oznámení' },
          },
        }),
        { status: 200 }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(async () => {
  for (const off of seated.splice(0)) off();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  sent.length = 0;
  planCheck = { ok: true, measured: true, check: [] };
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
const q = (id: string, host: ParentNode = document) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};
const click = async (el: Element | null, what = 'element') => {
  await act(async () => {
    must(el, what).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};

// the fold's own remembered state is not a write of the canvas
const writes = () => sent.filter((s) => s.method !== 'GET' && s.url !== '/_api/ui-prefs');

const FILE = '.design/ui/Kampan.tsx';
const CFG = { designRel: '.design', designSystems: [], defaultDesignSystem: null };
/** The Instagram post: a fixed size, 1080 × 1350, Ink behind it */
const POST = {
  selector: '[data-dc-screen="ig"]',
  tag: 'article',
  artboardId: 'ig',
  file: FILE,
  attrs: {
    'data-dc-kind': 'digital',
    'data-dc-fixed': 'true',
    'data-dc-bg': 'var(--ink)',
    'data-dc-label': 'Oznámení události',
    'data-dc-safe-zones': 'instagram-story',
  } as Record<string, string>,
  bounds: { x: 0, y: 0, w: 1080, h: 1350 },
  worldW: 1080,
  worldH: 1350,
};

const seated: Array<() => void> = [];
const undone: string[] = [];
async function seat() {
  if (seated.length) return;
  const art = await import('../client/v2/inspector/kinds/artboard.jsx');
  const fixed = await import('../client/v2/inspector/kinds/artboard-fixed.jsx');
  const web = await import('../client/v2/inspector/kinds/artboard-web.jsx');
  const video = await import('../client/v2/inspector/kinds/artboard-video.jsx');
  const print = await import('../client/v2/inspector/kinds/artboard-print.jsx');
  const warn = await import('../client/v2/inspector/sections/warnings.jsx');
  art.offArtboardSections();
  fixed.offArtboardFixed();
  web.offArtboardWeb();
  video.offArtboardVideo();
  print.offArtboardPrint();
  warn.offWarnings();
  seated.push(art.registerArtboardSlots());
  seated.push(fixed.registerArtboardFixedSlots());
  seated.push(web.registerArtboardWebSlots());
  seated.push(video.registerArtboardVideoSlots());
  seated.push(print.registerArtboardPrintSlots());
  seated.push(warn.registerWarningSlots());
}

const replaced: unknown[] = [];
const ran: unknown[] = [];
async function frame(el: Record<string, unknown> = {}) {
  await seat();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  return mount(
    <InspectorFrame
      {...({
        selected: { ...POST, ...el },
        layersTree: null,
        cfg: CFG,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: (e: unknown) => replaced.push(e),
        onRunAction: (m: unknown) => ran.push(m),
        onUndoRedo: (d: string) => undone.push(d),
        onResizeArtboard: () => {},
        onSetArtboardHug: () => {},
        onSetArtboardStyle: () => {},
        onSetArtboardKind: () => {},
        onSetArtboardPrint: () => {},
        onSetArtboardTheme: () => {},
        onDuplicateArtboard: () => {},
      } as never)}
    />
  );
}

describe('Change kind — after it', () => {
  test('the toast says a copy was made (copy glyph, the source called a post) with one Undo', async () => {
    const { NotificationHost } = await import('../notifications.tsx');
    const { notifyConverted } = await import('../client/v2/kinds/ConvertDialog.jsx');
    const host = await mount(<NotificationHost />);
    await act(async () => {
      notifyConverted({ plan: { paperName: 'A6' }, copy: true, sourceWord: 'post', onUndo: () => {} });
    });
    await new Promise((r) => setTimeout(r, 80));
    const card = host.ownerDocument.querySelector('[data-testid="notice-convert-kind"]');
    expect(card?.textContent).toContain('The A6 copy is beside the post. The post is unchanged.');
    expect(card?.querySelector('.maude-notice-ic svg')).toBeTruthy();
    expect(card?.querySelector('.maude-notice-ic--duplicate')).toBeTruthy();
  });
});

describe('Change kind — the dialog', () => {
  test('the Size select of a fixed size lists the papers; picking A6 asks first and resizes nothing', async () => {
    const host = await frame();
    const sel = must(q('insp-ab-preset', host), 'size select') as HTMLSelectElement;
    expect([...sel.options].some((o) => o.value === 'paper:a6')).toBe(true);
    await pick(sel, 'paper:a6');
    expect(must(q('convert-title'), 'title').textContent).toBe(
      'Make “Oznámení události” an A6 print?'
    );
    expect(q('convert-lead')?.textContent).toContain('Size becomes 105 × 148 mm with 3 mm bleed.');
    expect(q('convert-lead')?.textContent).toContain('filled with its background colour, Ink.');
    expect(q('convert-note')?.textContent).toBe(
      'Instagram safe zones turn off — print has its own safe margin.'
    );
    expect((q('convert-keep') as HTMLInputElement).checked).toBe(true);
    expect(must(q('convert-go'), 'primary').textContent).toBe('Make A6 print');
    expect(writes()).toEqual([]);
  });

  test('"Check after" lists what the render found, and says so quietly when it cannot look', async () => {
    planCheck = {
      ok: true,
      measured: true,
      check: [
        {
          id: 'soft-image:foto',
          code: 'soft-image',
          text: 'The picture is 640 px wide — at A6 it may print a little soft.',
          verb: 'Replace…',
        },
        {
          id: 'layers-at-cut',
          code: 'layers-at-cut',
          text: 'Two layers sit where the paper is cut.',
          verb: 'Show',
        },
      ],
    };
    const host = await frame();
    await pick(q('insp-ab-preset', host), 'paper:a6');
    expect(
      [...document.querySelectorAll('[data-testid="convert-check-line"]')].map((n) => n.textContent)
    ).toEqual([
      'The picture is 640 px wide — at A6 it may print a little soft.',
      'Two layers sit where the paper is cut.',
    ]);
    planCheck = { ok: true, measured: false, check: [] };
    await click(q('convert-cancel'));
    await pick(q('insp-ab-preset', host), 'paper:a5');
    expect(q('convert-check')?.textContent).toContain('can’t be checked right now');
  });

  test('Make A6 print is ONE edit-op request with the copy switch on; turned off it changes the artboard itself', async () => {
    const host = await frame();
    await pick(q('insp-ab-preset', host), 'paper:a6');
    await click(q('convert-go'));
    const ops = sent.filter((s) => s.url === '/_api/edit-op');
    expect(ops).toHaveLength(1);
    expect(ops[0]?.body).toMatchObject({
      file: FILE,
      op: 'artboard.convert-kind',
      params: { artboard: 'ig', paper: 'a6', keepOriginal: true },
    });
    // the copy remembers what it was made from — the "Made from" row
    const meta = sent.find((s) => s.url === '/_api/present-meta');
    expect(meta?.body).toEqual({
      file: FILE,
      madeFrom: { 'ig-a6': { artboard: 'ig', label: 'Oznámení' } },
    });
    expect(q('convert-dialog')).toBeNull();
    // V2-8.5 C4 (08 ak-convert-after): the new A6 copy is what gets selected; the toast wears the copy glyph
    expect(ran).toContainEqual({ dgn: 'select-by-id', artboardId: 'ig-a6' });

    sent.length = 0;
    await pick(q('insp-ab-preset', host), 'paper:a5');
    await click(q('convert-keep'));
    await click(q('convert-go'));
    expect(sent.find((s) => s.url === '/_api/edit-op')?.body).toMatchObject({
      params: { paper: 'a5', keepOriginal: false },
    });
  });

  test('Cancel changes nothing; a refusal stays in the dialog as one sentence', async () => {
    const host = await frame();
    await pick(q('insp-ab-preset', host), 'paper:a6');
    await click(q('convert-cancel'));
    expect(q('convert-dialog')).toBeNull();
    expect(writes()).toEqual([]);

    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) =>
      String(url) === '/_api/edit-op'
        ? new Response(JSON.stringify({ ok: false, code: 'held-by-ai', message: 'x' }), {
            status: 409,
          })
        : real(url, init)) as unknown as typeof fetch;
    await pick(q('insp-ab-preset', host), 'paper:a6');
    await click(q('convert-go'));
    expect(q('convert-error')?.textContent).toContain('belongs to AI');
    expect(q('convert-dialog')).not.toBeNull();
    globalThis.fetch = real;
  });
});

describe('the one warning style — the inspector rows', () => {
  const WARN = [
    {
      id: 'soft-image:foto',
      code: 'soft-image',
      text: 'The picture is 640 px wide — at A6 it may print a little soft.',
      verb: 'Replace…',
      fix: { kind: 'replace', element: 'foto' },
    },
    {
      id: 'layers-at-cut',
      code: 'layers-at-cut',
      text: 'Two layers sit where the paper is cut.',
      verb: 'Show',
      fix: { kind: 'show', elements: ['a', 'b'] },
    },
  ];
  const A6 = {
    ...POST,
    attrs: {
      'data-dc-kind': 'print',
      'data-dc-print': JSON.stringify({ paper: 'a6', bleedMm: 3 }),
      'data-dc-made-from': 'Oznámení události · 4:5',
      'data-dc-warnings': JSON.stringify(WARN),
    },
  };

  test('each warning is a row at the top with its sentence and ONE verb; "Made from" sits with the other rows', async () => {
    const host = await frame(A6);
    const rows = [...host.querySelectorAll('.insp-warn')];
    expect(rows.map((r) => r.querySelector('.insp-warn-t')?.textContent)).toEqual(
      WARN.map((w) => w.text)
    );
    expect(rows.map((r) => r.querySelector('button')?.textContent)).toEqual(['Replace…', 'Show']);
    // V2-8.5 C2 (08 ak-warnings): the first row of the inspector — before every section, not inside the first one
    const first = must(host.querySelector('[data-testid="inspector-frame"] .insp-warn'), 'warning');
    const sections = must(q('insp-sec-size', host), 'section');
    expect(sections.contains(first)).toBe(false);
    expect(first.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('insp-made-from', host)?.textContent).toBe('Oznámení události · 4:5');
  });

  test('Show selects the layer on the canvas; Replace… opens the picture’s picker; a clean artboard has no rows', async () => {
    const host = await frame(A6);
    await click(q('insp-warning-fix-layers-at-cut', host));
    expect(ran.at(-1)).toMatchObject({ dgn: 'select-by-id', id: 'a', artboardId: 'ig' });
    await click(q('insp-warning-fix-soft-image', host));
    expect(replaced.at(-1)).toMatchObject({
      id: 'foto',
      refs: [{ artboard: 'ig', element: 'foto' }],
    });
    const clean = await frame({ attrs: { ...A6.attrs, 'data-dc-warnings': '' } });
    expect(clean.querySelector('.insp-warn')).toBeNull();
  });

  test('Fix size writes the print prop and the px size together (artboard.set-print); Allow longer stores maxFrames', async () => {
    const fixSize = {
      id: 'not-paper-size',
      code: 'not-paper-size',
      text: '1 px narrower than A4 landscape with bleed (1145 × 816).',
      verb: 'Fix size',
      fix: { kind: 'fix-size', width: 1145, height: 816 },
    };
    const host = await frame({
      attrs: {
        'data-dc-kind': 'print',
        'data-dc-print': JSON.stringify({ paper: 'a4', orientation: 'landscape', bleedMm: 3 }),
        'data-dc-warnings': JSON.stringify([fixSize]),
      },
    });
    await click(q('insp-warning-fix-not-paper-size', host));
    expect(sent.find((s) => s.url === '/_api/edit-op')?.body).toMatchObject({
      op: 'artboard.set-print',
      params: { artboard: 'ig', orientation: 'landscape' },
    });
    sent.length = 0;
    const long = {
      id: 'longer-than-export',
      code: 'longer-than-export',
      text: '2:40 long — one export goes up to 2 min (3600 frames at 30 fps).',
      verb: 'Allow longer',
      fix: { kind: 'allow-longer', maxFrames: 4800 },
    };
    const v = await frame({
      attrs: { 'data-dc-kind': 'video', 'data-dc-warnings': JSON.stringify([long]) },
    });
    await click(q('insp-warning-fix-longer-than-export', v));
    expect(sent.find((s) => s.url === '/_api/present-meta')?.body).toEqual({
      file: FILE,
      maxFrames: { ig: 4800 },
    });
  });
});
