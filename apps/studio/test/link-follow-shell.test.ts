// S3.10a — playback (contract client/v2/contracts/S3-links-format.md §5, §9, §10 row 4).
//
// The canvas posts only `link-follow {elementId, artboardId}`; the shell drops it outside Preview, from a
// background frame, with a modal open and over 4/s; a payload carrying `target`/`url` keys is stripped by
// `parse`; a dangling link stays put and says so. Plus the back stack (preview-history) and the canvas side
// (input-router `linkFollowOf`: Preview only, plain left click, element needs a data-cd-id).

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { acceptFromCanvas, c2sSpec } from '../bridge/dgn-protocol.ts';
import {
  createLinkFollow,
  DANGLING_ARTBOARD,
  DANGLING_CANVAS,
  entryFor,
  externalNotYet,
} from '../client/v2/preview/link-follow.js';
import { BACK_MAX, createPreviewHistory } from '../client/v2/preview/preview-history.js';
import { linkFollowOf } from '../input-router.tsx';

const LINKS = {
  v: 1,
  file: 'Home.tsx',
  links: [
    {
      id: 'faq',
      artboard: 'desktop',
      target: '#faq',
      kind: 'artboard',
      toArtboard: 'faq',
      state: 'ok',
      label: 'Go to FAQ',
    },
    {
      id: 'see-pricing',
      artboard: 'desktop',
      target: 'site/pricing.tsx#desktop',
      kind: 'canvas',
      canvas: 'site/pricing.tsx',
      toArtboard: 'desktop',
      state: 'ok',
      label: 'Go to Pricing',
    },
    {
      id: 'gone',
      artboard: 'desktop',
      target: '#x',
      kind: 'artboard',
      toArtboard: 'x',
      state: 'dangling',
      label: 'Go to x',
    },
    {
      id: 'old',
      artboard: 'desktop',
      target: 'old.tsx',
      kind: 'canvas',
      canvas: 'old.tsx',
      toArtboard: null,
      state: 'dangling',
      label: 'Go to Old',
    },
    {
      id: 'book',
      artboard: 'desktop',
      target: 'https://cal.com/studio',
      kind: 'external',
      url: 'https://cal.com/studio',
      host: 'cal.com',
      state: 'ok',
      label: 'Opens cal.com/studio',
    },
    {
      id: 'bad',
      artboard: 'desktop',
      target: 'javascript:x',
      kind: 'invalid',
      state: 'invalid',
      label: '',
    },
    {
      id: 'twice',
      artboard: 'a',
      target: '#faq',
      kind: 'artboard',
      toArtboard: 'faq',
      state: 'ok',
      label: 'Go to FAQ',
    },
    {
      id: 'twice',
      artboard: 'b',
      target: '#desktop',
      kind: 'artboard',
      toArtboard: 'desktop',
      state: 'ok',
      label: 'Go to D',
    },
  ],
};

function rig(over: Partial<Record<string, unknown>> = {}) {
  const log: unknown[] = [];
  let t = 1000;
  let active = '.design/Home.tsx';
  const history = createPreviewHistory();
  const state = { mode: 'preview', modal: false };
  const lf = createLinkFollow({
    mode: () => state.mode,
    modalOpen: () => state.modal,
    now: () => t,
    activePath: () => active,
    fetchLinks: async (p: string) => {
      log.push(['fetch', p]);
      return LINKS;
    },
    zoomTo: (a: string) => log.push(['zoom', a]),
    openCanvas: (c: string, a: string | null) => {
      log.push(['open', c, a]);
      active = `.design/${c}`;
    },
    openTab: (p: string, a: string | null) => {
      log.push(['tab', p, a]);
      active = p;
    },
    toast: (s: string) => log.push(['toast', s]),
    history,
    nameOf: (p: string) => (p.endsWith('Home.tsx') ? 'Homepage' : 'Pricing'),
    ...over,
  });
  return { lf, log, history, state, tick: (ms: number) => (t += ms), active: () => active };
}

describe('the message', () => {
  test('link-follow is a live, active-gated c2s type', () => {
    const spec = c2sSpec('link-follow');
    expect(spec?.gate).toBe('active');
    expect(spec?.status).toBe('live');
  });

  test('parse strips target/url keys; bad ids are refused', () => {
    const spec = c2sSpec('link-follow');
    expect(
      spec?.parse({
        dgn: 'link-follow',
        elementId: 'see-pricing',
        artboardId: 'desktop',
        target: 'javascript:x',
        url: 'https://evil',
      })
    ).toEqual({ elementId: 'see-pricing', artboardId: 'desktop' });
    expect(spec?.parse({ elementId: 'deadbeef', artboardId: null })).toBeNull(); // 8 hex = a computed id
    expect(spec?.parse({ elementId: 'Bad Id', artboardId: null })).toBeNull();
    expect(spec?.parse({ elementId: 'ok', artboardId: 'has space' })).toBeNull();
    expect(spec?.parse({ elementId: 'ok', artboardId: null })).toEqual({
      elementId: 'ok',
      artboardId: null,
    });
  });

  test('a background frame is dropped by the gate', () => {
    const active = {} as Window;
    const other = {} as Window;
    const msg = (source: unknown) =>
      ({
        origin: 'http://c',
        source,
        data: { dgn: 'link-follow', elementId: 'faq', artboardId: null },
      }) as unknown as MessageEvent;
    expect(acceptFromCanvas(msg(other), { canvasOrigin: 'http://c', active })).toBeNull();
    expect(acceptFromCanvas(msg(active), { canvasOrigin: 'http://c', active })).not.toBeNull();
  });
});

describe('the shell plays it', () => {
  test('same canvas: zoom to the artboard, push a back entry; back returns', async () => {
    const r = rig();
    expect(await r.lf.follow({ elementId: 'faq', artboardId: 'desktop' })).toEqual({
      kind: 'artboard',
      artboard: 'faq',
    });
    expect(r.log).toEqual([
      ['fetch', '.design/Home.tsx'],
      ['zoom', 'faq'],
    ]);
    expect(r.history.peek()).toEqual({
      canvas: '.design/Home.tsx',
      artboard: 'desktop',
      name: 'Homepage',
    });
    r.lf.back();
    expect(r.log.at(-1)).toEqual(['zoom', 'desktop']);
    expect(r.history.size()).toBe(0);
  });

  test('another canvas: open it in Preview on its artboard; back reopens the previous one', async () => {
    const r = rig();
    await r.lf.follow({ elementId: 'see-pricing', artboardId: 'desktop' });
    expect(r.log.at(-1)).toEqual(['open', 'site/pricing.tsx', 'desktop']);
    expect(r.history.peek()?.name).toBe('Homepage'); // the bar shows "‹ Homepage"
    r.lf.back();
    expect(r.log.at(-1)).toEqual(['tab', '.design/Home.tsx', 'desktop']);
  });

  test('dangling stays put with the toast; invalid and unknown ids drop silently', async () => {
    const r = rig();
    await r.lf.follow({ elementId: 'gone', artboardId: 'desktop' });
    r.tick(1000);
    await r.lf.follow({ elementId: 'old', artboardId: 'desktop' });
    r.tick(1000);
    await r.lf.follow({ elementId: 'bad', artboardId: 'desktop' });
    await r.lf.follow({ elementId: 'nobody', artboardId: 'desktop' });
    expect(r.log.filter((l) => (l as string[])[0] !== 'fetch')).toEqual([
      ['toast', DANGLING_ARTBOARD],
      ['toast', DANGLING_CANVAS],
    ]);
    expect(r.history.size()).toBe(0);
  });

  test('external: named, not opened (S3.10b opens it)', async () => {
    const r = rig();
    await r.lf.follow({ elementId: 'book', artboardId: 'desktop' });
    expect(r.log.at(-1)).toEqual(['toast', externalNotYet('cal.com/studio')]);
    expect(r.history.size()).toBe(0);
  });

  test('dropped outside Preview, with a modal open, and over 4 a second', async () => {
    const r = rig();
    r.state.mode = 'edit';
    expect(await r.lf.follow({ elementId: 'faq', artboardId: null })).toBeNull();
    r.state.mode = 'present';
    expect(await r.lf.follow({ elementId: 'faq', artboardId: null })).toBeNull();
    r.state.mode = 'preview';
    r.state.modal = true;
    expect(await r.lf.follow({ elementId: 'faq', artboardId: null })).toBeNull();
    r.state.modal = false;
    expect(r.log).toEqual([]);
    for (let k = 0; k < 6; k++) await r.lf.follow({ elementId: 'faq', artboardId: null });
    expect(r.log.filter((l) => (l as string[])[0] === 'zoom').length).toBe(4);
    r.tick(1000);
    await r.lf.follow({ elementId: 'faq', artboardId: null });
    expect(r.log.filter((l) => (l as string[])[0] === 'zoom').length).toBe(5);
  });

  test('two elements with one id: the artboard picks', () => {
    expect(entryFor(LINKS.links, 'twice', 'b')?.toArtboard).toBe('desktop');
    expect(entryFor(LINKS.links, 'twice', 'c')).toBeNull();
  });
});

describe('preview-history', () => {
  test('at most 50 entries; clear empties it', () => {
    const h = createPreviewHistory();
    for (let k = 0; k < BACK_MAX + 5; k++)
      h.push({ canvas: `c${k}.tsx`, artboard: null, name: `C${k}` });
    expect(h.size()).toBe(BACK_MAX);
    expect(h.get()[0]?.canvas).toBe('c5.tsx');
    expect(h.pop()?.canvas).toBe(`c${BACK_MAX + 4}.tsx`);
    h.clear();
    expect(h.size()).toBe(0);
    expect(h.pop()).toBeNull();
  });
});

describe('the canvas side (input-router, Preview branch only)', () => {
  const win = new Window();
  const doc = win.document;
  doc.body.innerHTML = `<div data-dc-screen="desktop"><button data-cd-id="see-pricing" data-cd-link="#x"><span id="in">See</span></button><a data-cd-link="#x" id="noid">x</a><a data-cd-id="deadbeef" data-cd-link="#x" id="hex">x</a></div>`;
  const inner = doc.getElementById('in') as unknown as Element;
  const click = (
    mode: string | null,
    extra: Partial<{ button: number; mod: boolean; shift: boolean }> = {}
  ) => linkFollowOf(inner, { mode: mode as never, button: 0, mod: false, ...extra });

  test('a plain click in Preview on a linked element (or inside it)', () => {
    expect(click('preview')).toEqual({ elementId: 'see-pricing', artboardId: 'desktop' });
  });
  test('Edit, Viewing, Present and ungoverned never follow; ⌘/⇧/right click never follow', () => {
    for (const m of ['edit', 'viewing', 'present', null]) expect(click(m)).toBeNull();
    expect(click('preview', { mod: true })).toBeNull();
    expect(click('preview', { shift: true })).toBeNull();
    expect(click('preview', { button: 2 })).toBeNull();
  });
  test('the linked element needs an authored id', () => {
    const at = (id: string) =>
      linkFollowOf(doc.getElementById(id) as unknown as Element, {
        mode: 'preview',
        button: 0,
        mod: false,
      });
    expect(at('noid')).toBeNull();
    expect(at('hex')).toBeNull();
  });
});
