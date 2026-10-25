// P8 stage C round 8 (14 ed-comp-pick): while the Component picker is open its highlighted row is drawn on the canvas
// as a ghost on the artboard's centre line — `place-component` mode 'preview' follows the row, 'cancel' takes it back
// when the panel closes without a pick; a pick (ghost / ↵) is its own message and is never followed by a cancel.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import ComponentPicker from '../client/v2/inspector/component-picker.jsx';
import { previewHover, requestFrom } from '../editing/place-ghost.tsx';

const LIST = {
  ok: true,
  system: { name: 'Alligators brand system', converted: true },
  brand: [{ name: 'Logo', label: 'Logo', variants: [{ key: 'mark', label: 'Mark' }] }],
  components: [
    {
      name: 'Button',
      label: 'Tlačítko',
      variants: [
        { key: 'primary', label: 'Plné' },
        { key: 'outline', label: 'Obrys' },
      ],
    },
  ],
  patterns: [],
};

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const calls = { previews: [] as Array<Record<string, unknown>>, placed: [] as unknown[] };
  await act(async () => {
    root.render(
      <ComponentPicker
        canvas=".design/ui/Home.tsx"
        load={async () => LIST}
        onPlace={(m: unknown) => calls.placed.push(m)}
        onPreview={(m: Record<string, unknown>) => calls.previews.push(m)}
        onOpenDesignSystem={() => {}}
        onClose={() => {}}
      />
    );
  });
  await act(async () => {});
  const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const handler = (el: HTMLElement, name: string) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
    return (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[key][name];
  };
  return {
    calls,
    q,
    hover: async (id: string) => {
      const el = q(id) as HTMLElement;
      await act(async () => handler(el, 'onMouseEnter')({}));
    },
    click: async (id: string) => {
      const el = q(id) as HTMLElement;
      await act(async () => handler(el, 'onClick')({}));
    },
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe('the picker previews its highlighted row on the canvas', () => {
  test('opening previews the first row, a hover moves it, closing without a pick cancels', async () => {
    const m = await mount();
    expect(m.calls.previews.map((p) => [p.component, p.mode])).toEqual([['Logo', 'preview']]);
    await m.hover('component-picker-row-Button');
    expect(m.calls.previews.at(-1)).toMatchObject({
      dgn: 'place-component',
      component: 'Button',
      label: 'Tlačítko · Plné',
      variant: 'primary',
      mode: 'preview',
    });
    await m.close();
    expect(m.calls.previews.at(-1)).toEqual({
      dgn: 'place-component',
      component: 'Button',
      mode: 'cancel',
    });
    expect(m.calls.placed).toEqual([]);
  });

  test('a pick is its own message and is never followed by a cancel', async () => {
    const m = await mount();
    await m.click('component-picker-row-Logo');
    expect(m.calls.placed).toHaveLength(1);
    const before = m.calls.previews.length;
    await m.close();
    expect(m.calls.previews.length).toBe(before);
    expect(m.calls.previews.some((p) => p.mode === 'cancel')).toBe(false);
  });
});

describe('the canvas side', () => {
  test('the dgn table accepts preview and cancel, and requestFrom keeps them', () => {
    const parse = DGN_TABLE.s2c['place-component'].parse as (r: Record<string, unknown>) => unknown;
    expect(
      parse({ component: 'Button', mode: 'preview', label: 'Tlačítko · Plné' })
    ).not.toBeNull();
    expect(parse({ component: 'Button', mode: 'cancel' })).not.toBeNull();
    expect(parse({ component: 'Button', mode: 'drag' })).toBeNull();
    expect(
      requestFrom({ dgn: 'place-component', component: 'Button', mode: 'preview' })?.mode
    ).toBe('preview');
    expect(requestFrom({ dgn: 'place-component', component: 'Button', mode: 'cancel' })?.mode).toBe(
      'cancel'
    );
  });

  test('the preview sits on the centre line of the first artboard on screen, snapped', () => {
    document.body.innerHTML = `<article data-dc-screen="desktop"><div class="dc-artboard-body"></div></article>`;
    const body = document.querySelector('.dc-artboard-body') as HTMLElement;
    body.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        width: 400,
        height: 600,
        right: 500,
        bottom: 650,
        x: 100,
        y: 50,
        toJSON() {},
      }) as DOMRect;
    const at = previewHover(document, []);
    expect(at).toMatchObject({ x: 300, snapped: true, inFlow: false });
    expect(at?.y).toBeGreaterThan(50 + 600 / 2);
    expect(at?.box).toEqual({ left: 100, top: 50, width: 400, height: 600 });
    document.body.innerHTML = '';
    expect(previewHover(document, [])).toBeNull();
  });
});
