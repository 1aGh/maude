// S7.11 — the inspector of the captions you select on the Text track (07 · ve-captions): Font · Highlight ·
// Position · Words at a time, then Advanced srt · lang · maxChars. Real markup and registry; the writes go
// through captions-api.js onto the REAL <Captions> edit op (test/_captions-harness.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { captionsOf } from '../video/derive.ts';
import { A, FILE, install, source, video, WORDS } from './_captions-harness.ts';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let restoreSlots: (() => void) | null = null;
const seated: Array<() => void> = [];
let off = () => {};
afterAll(async () => {
  for (const o of seated.splice(0)) o();
  restoreSlots?.();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  off();
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
const q = (host: HTMLElement, id: string) =>
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
const radio = (host: HTMLElement, group: string, label: string) =>
  [...(q(host, group)?.querySelectorAll('[role="radio"]') ?? [])].find(
    (b) => b.textContent === label
  ) ?? null;

async function frame(opts: { captions?: string } = {}) {
  const v = video({ transcripts: { [A]: { words: WORDS, lang: 'cs' } } });
  v.source = source(
    opts.captions ??
      '    <Captions data-cd-id="captions" words="line" position="bottom" highlight="var(--accent)" />'
  );
  off = install(v);
  const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
  const media = await compMediaStore.load(FILE, 'reel');
  if (!seated.length) {
    const caption = await import('../client/v2/inspector/kinds/caption.jsx');
    const { stashSlots } = await import('../client/v2/inspector/slots.js');
    restoreSlots = stashSlots();
    seated.push(caption.registerCaptionSlots());
  }
  const { captionSelection } = await import('../client/v2/timeline/lanes/caption-lane.jsx');
  const { timelineSelectionElement } = await import('../client/v2/timeline/selection.js');
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const sel = captionSelection({
    canvas: '.design/ui/Reel.tsx',
    artboardId: 'reel',
    fps: 30,
    media,
    key: null,
  });
  const host = await mount(
    h(InspectorFrame, {
      selected: timelineSelectionElement(sel as never),
      layersTree: null,
      cfg: { designRel: '.design' },
      canvasFile: '.design/ui/Reel.tsx',
      onOptimistic: () => {},
      onRecordEdit: () => {},
      onReplaceMedia: () => {},
      onUndoRedo: () => {},
    } as never)
  );
  return { host, v };
}

describe('the Captions inspector', () => {
  test('the chip says Captions; the rows are the canvas’s, in its order and words', async () => {
    const { host } = await frame();
    expect(q(host, 'inspector-kind')?.textContent).toBe('Captions');
    const rows = [
      ...(q(host, 'insp-sec-captions')?.querySelectorAll('[data-testid^="insp-row-"]') ?? []),
    ].map((r) => r.querySelector('.insp-row-k')?.textContent);
    // "Also as a file" is the export sheet's (S8): no row until it registers its switch
    expect(rows).toEqual(['Font', 'Highlight', 'Position', 'Words at a time']);
    expect(radio(host, 'insp-captions-position', 'Bottom')?.getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(radio(host, 'insp-captions-words', 'Line')?.getAttribute('aria-checked')).toBe('true');
  });

  test('Position and Words at a time are props of the one <Captions>, one write each', async () => {
    const { host, v } = await frame();
    await click(radio(host, 'insp-captions-position', 'Top'), 'Top');
    await click(radio(host, 'insp-captions-words', '3'), '3 words');
    expect(v.calls.map((c) => [c.verb, c.params])).toEqual([
      ['video.captions.add', { position: 'top' }],
      ['video.captions.add', { words: 3 }],
    ]);
    expect(captionsOf(v.source)).toMatchObject({
      position: 'top',
      words: 3,
      highlight: 'var(--accent)',
    });
    expect((v.source.match(/<Captions/g) ?? []).length).toBe(1);
  });

  test('Also as a file appears when the export sheet registers its switch, and writes through it', async () => {
    const { registerCaptionsFileFlag } = await import(
      '../client/v2/transcript/captions-file-flag.js'
    );
    let on = false;
    const set: Array<[string, string, boolean]> = [];
    const unregister = registerCaptionsFileFlag({
      get: () => on,
      set: (c: string, a: string, value: boolean) => {
        set.push([c, a, value]);
        on = value;
      },
      subscribe: () => () => {},
    });
    try {
      const { host } = await frame();
      const row = q(host, 'insp-row-captions-file');
      expect(row?.querySelector('.insp-row-k')?.textContent).toBe('Also as a file');
      await click(q(host, 'insp-captions-file')?.querySelector('input') ?? null, 'the switch');
      expect(set).toEqual([['.design/ui/Reel.tsx', 'reel', true]]);
    } finally {
      unregister();
    }
  });

  test('Advanced says the file the export writes, the language and the line length', async () => {
    const { host } = await frame();
    await click(q(host, 'fold-inspector-toggle'), 'the Advanced fold');
    expect(q(host, 'insp-adv-captions-srt')?.textContent).toBe('srtReel.srt');
    expect(q(host, 'insp-adv-captions-lang')?.textContent).toBe('langcs');
    const max = q(host, 'insp-captions-maxchars')?.querySelector('input') as HTMLInputElement;
    expect(max.value).toBe('32');
  });
});
