// S2.15 (ed-img · ed-edge-paste) — a picture in the inspector: the Image chip, the file's thumb / name / size, Replace…,
// Fill · Fit · Crop · Tile and Zoom (each one `image.crop` asked of the canvas), Adjust… only where Photo can open,
// and the "this use only" line only where it is true. A picture pasted from Figma says so and offers Fill · Fit.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
const realImage = globalThis.Image;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
  // a picture "loads" at once, 4032 × 3024
  (globalThis as unknown as { Image: unknown }).Image = class {
    naturalWidth = 4032;
    naturalHeight = 3024;
    onload: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  };
});
afterAll(async () => {
  const { unregisterSections } = await import('../client/v2/inspector/sections/index.js');
  unregisterSections();
  globalThis.fetch = realFetch;
  (globalThis as unknown as { Image: unknown }).Image = realImage;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const FILE = '.design/ui/Post.tsx';
const REF = { artboard: 'post', element: 'photo' };
const PHOTO = {
  id: 'photo',
  index: 0,
  file: FILE,
  tag: 'img',
  classes: '',
  selector: '[data-cd-id="photo"]',
  text: '',
  bounds: { x: 0, y: 0, w: 300, h: 400 },
  worldW: 300,
  worldH: 400,
  dom_path: ['img'],
  authored: { 'object-fit': 'cover' } as Record<string, string>,
  computed: { display: 'block' } as Record<string, string>,
  customStyles: {},
  attrs: { src: 'assets/ab12cd34.jpg' } as Record<string, string>,
  parentDisplay: 'block',
  parentFlexDirection: 'row',
  artboardId: 'post',
  refs: [REF],
};
const CFG = { designRel: '.design', designSystems: [], defaultDesignSystem: null };

async function frame(el: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  await import('../client/v2/inspector/sections/index.js');
  (await import('../client/v2/inspector/kinds/image.jsx')).registerImageKind();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const asked: unknown[] = [];
  await act(async () =>
    root.render(
      <InspectorFrame
        {...({
          selected: { ...PHOTO, ...el },
          layersTree: { artboardId: 'post', nodes: [] },
          cfg: CFG,
          canvasFile: FILE,
          onOptimistic: () => {},
          onRecordEdit: () => {},
          onReplaceMedia: () => {},
          onUndoRedo: () => {},
          onRunAction: (m: unknown) => asked.push(m),
          ...props,
        } as never)}
      />
    )
  );
  await settle();
  return { host, asked };
}

describe('the Image section', () => {
  test('an <img> wears the Image chip; thumb, file name and size are there', async () => {
    await frame();
    expect(q('inspector-kind')?.textContent).toBe('Image');
    expect(q('insp-sec-image')).not.toBeNull();
    expect(q('insp-image-name')?.textContent).toBe('ab12cd34.jpg');
    expect(q('insp-image-size')?.textContent).toBe('4032 × 3024');
    expect(q('insp-image-thumb')?.querySelector('img')?.getAttribute('src')).toBe(
      '/.design/assets/ab12cd34.jpg'
    );
  });

  test('a frame has no Image section', async () => {
    await frame({ tag: 'div', attrs: {}, id: 'frame' });
    expect(q('insp-sec-image')).toBeNull();
    expect(q('insp-sec-adjust')).toBeNull();
  });

  test('a tile is a picture too', async () => {
    await frame({
      tag: 'div',
      attrs: { 'data-image-tile': 'assets/ab12cd34.jpg', 'data-image-fit': 'tile' },
    });
    expect(q('inspector-kind')?.textContent).toBe('Image');
    expect(q('insp-ctl-image-fit')?.querySelector('[aria-checked="true"]')?.textContent).toBe(
      'Tile'
    );
  });

  test('Fit reads the file: Fill, Fit (contain), Crop (the marker) — and Zoom shows for Crop only', async () => {
    const on = () => q('insp-ctl-image-fit')?.querySelector('[aria-checked="true"]')?.textContent;
    await frame();
    expect(on()).toBe('Fill');
    expect(q('insp-image-zoom')).toBeNull();
    await act(async () => roots.pop()?.unmount());
    document.body.innerHTML = '';
    await frame({ authored: { 'object-fit': 'contain' } });
    expect(on()).toBe('Fit');
    document.body.innerHTML = '';
    await frame({
      attrs: { src: 'assets/a.jpg', 'data-image-fit': 'crop' },
      authored: { transform: 'scale(1.28)' },
    });
    expect(on()).toBe('Crop');
    expect(q('insp-image-zoom')?.querySelector('input')?.value).toBe('128');
    expect(q('insp-image-crop-hint')?.textContent).toContain('Double-click the picture');
  });

  test('choosing a Fit asks the canvas for ONE image.crop over this picture', async () => {
    const { asked } = await frame();
    const buttons = [...(q('insp-ctl-image-fit')?.querySelectorAll('button') ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(['Fill', 'Fit', 'Crop', 'Tile']);
    await act(async () => buttons[1]?.click());
    expect(asked).toEqual([
      { dgn: 'run-action', v: 1, id: 'image.crop', params: { targets: [REF], fit: 'fit' } },
    ]);
    await act(async () => buttons[0]?.click()); // already Fill: nothing to ask
    expect(asked.length).toBe(1);
  });

  test('a picture pasted from Figma says so and offers only Fill and Fit', async () => {
    await frame({
      attrs: { src: 'assets/a.png', 'data-source': 'figma', 'data-source-name': 'Hero / v3' },
    });
    expect(q('insp-image-source')?.textContent).toBe('Figma · Hero / v3');
    expect(
      [...(q('insp-ctl-image-fit')?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
    ).toEqual(['Fill', 'Fit']);
  });

  test('Replace… opens the asset picker for this picture', async () => {
    const seen: unknown[] = [];
    await frame({}, { onReplaceMedia: (el: unknown) => seen.push(el) });
    await act(async () => q('insp-image-replace')?.click());
    expect(seen.length).toBe(1);
    expect((seen[0] as { id: string }).id).toBe('photo');
  });

  test('a viewer (no id) cannot change anything', async () => {
    await frame({ id: undefined, artboardId: undefined });
    expect((q('insp-image-replace') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the Adjust section', () => {
  test('drawn only where Photo can open; both rows open it', async () => {
    await frame();
    expect(q('insp-sec-adjust')).toBeNull();
    document.body.innerHTML = '';
    const opened: string[] = [];
    await frame({}, { onOpenPhoto: (w: string) => opened.push(w) });
    await act(async () => q('insp-image-adjust')?.click());
    await act(async () => q('insp-image-remove-bg')?.click());
    expect(opened).toEqual(['adjust', 'remove-background']);
  });

  test('"Edits apply to this use only" is said only where it is true (S8.15)', async () => {
    await frame({}, { onOpenPhoto: () => {} });
    expect(q('insp-image-photo-line')?.textContent).toBe('Both open Photo.');
    document.body.innerHTML = '';
    await frame({}, { onOpenPhoto: () => {}, photoPerUse: true });
    expect(q('insp-image-photo-line')?.textContent).toBe(
      'Both open Photo. Edits apply to this use only.'
    );
  });
});
