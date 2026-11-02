// S2.16 — the Component picker (⇧I) rendered: groups Brand / Components / Patterns with an empty group
// hidden (Q13), the system line, variant chips on the highlighted row, search that ignores accents, a
// click places in ghost mode and ↵ in selection mode, "Open Design system", and nothing at all for a
// role that cannot edit. The panel only EMITS the `place-component` dgn; the canvas places.
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
import ComponentPicker, {
  filterList,
  flatRows,
  placeMessage,
  rowNote,
  visibleGroups,
} from '../client/v2/inspector/component-picker.jsx';

const LIST = {
  ok: true,
  system: { name: 'Alligators brand system', converted: true },
  brand: [
    {
      name: 'Logo',
      label: 'Logo',
      variants: [
        { key: 'mark', label: 'Mark' },
        { key: 'wordmark', label: 'Wordmark' },
      ],
    },
    { name: 'Icon', label: 'Icon', variants: [], glyph: 'star', glyphs: 12 },
  ],
  components: [
    {
      name: 'Button',
      label: 'Tlačítko',
      variants: [
        { key: 'primary', label: 'Plné' },
        { key: 'outline', label: 'Obrys' },
      ],
    },
    { name: 'Badge', label: 'Štítek', variants: [] },
  ],
  patterns: [],
};

describe('pure helpers', () => {
  test('an empty group is hidden (Q13: Patterns waits for S10)', () => {
    expect(visibleGroups(filterList(LIST, '')).map((g) => g.key)).toEqual(['brand', 'components']);
    const withPatterns = { ...LIST, patterns: [{ name: 'Hero', label: 'Hero', variants: [] }] };
    expect(visibleGroups(filterList(withPatterns, '')).map((g) => g.key)).toEqual([
      'brand',
      'components',
      'patterns',
    ]);
  });

  test('search ignores accents and case and matches the label or the export name', () => {
    expect(flatRows(filterList(LIST, 'tlacitko')).map((r) => r.item.name)).toEqual(['Button']);
    expect(flatRows(filterList(LIST, 'BUT')).map((r) => r.item.name)).toEqual(['Button']);
    expect(flatRows(filterList(LIST, 'štítek')).map((r) => r.item.name)).toEqual(['Badge']);
    expect(flatRows(filterList(LIST, 'zzz'))).toEqual([]);
  });

  test('the row note: "2 variants", "12 glyphs", nothing for a single look', () => {
    expect(rowNote(LIST.components[0])).toBe('2 variants');
    expect(rowNote(LIST.brand[1])).toBe('12 glyphs');
    expect(rowNote(LIST.components[1])).toBe('');
  });

  test('the message is the dgn table’s place-component payload', () => {
    const msg = placeMessage(LIST.components[0], null, 'ghost');
    expect(msg).toEqual({
      dgn: 'place-component',
      component: 'Button',
      label: 'Tlačítko · Plné',
      variant: 'primary',
      mode: 'ghost',
    });
    const { dgn: _d, ...payload } = msg;
    const parse = DGN_TABLE.s2c['place-component'].parse as (r: Record<string, unknown>) => unknown;
    expect(parse(payload)).toEqual(payload);
    expect(placeMessage(LIST.brand[1], null, 'selection')).toMatchObject({
      glyph: 'star',
      mode: 'selection',
    });
    // a payload the canvas must not trust is dropped by the one parser
    for (const bad of [
      { ...payload, component: 'button' },
      { ...payload, component: 'A<b>' },
      { ...payload, variant: 'x y' },
      { ...payload, mode: 'drag' },
    ])
      expect(parse(bad)).toBeNull();
  });
});

async function mount(props: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const calls = { placed: [] as unknown[], closed: 0, openedDs: 0 };
  await act(async () => {
    root.render(
      <ComponentPicker
        canvas=".design/ui/Home.tsx"
        load={async () => LIST}
        onPlace={(m: unknown) => calls.placed.push(m)}
        onOpenDesignSystem={() => {
          calls.openedDs++;
        }}
        onClose={() => {
          calls.closed++;
        }}
        {...props}
      />
    );
  });
  await act(async () => {});
  const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  // a dispatched event does not reach React's handler under happy-dom: call the one React attached
  const handler = (el: HTMLElement, name: string) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
    return (el as unknown as Record<string, Record<string, (e: unknown) => void>>)[key][name];
  };
  const click = async (id: string) => {
    const el = q(id);
    if (!el) throw new Error(`no ${id}`);
    await act(async () => handler(el, 'onClick')({}));
  };
  const keys = async (...ks: string[]) => {
    const input = q('component-picker-search') as HTMLElement;
    for (const k of ks)
      await act(async () =>
        handler(input, 'onKeyDown')({ key: k, preventDefault() {}, nativeEvent: {} })
      );
  };
  return {
    host,
    calls,
    q,
    click,
    keys,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe('the panel', () => {
  test('search field, system line, Brand and Components, no Patterns, the footer', async () => {
    const m = await mount();
    expect(m.q('tool-panel-components')?.getAttribute('aria-label')).toBe('Components');
    expect((m.q('component-picker-search') as HTMLInputElement).placeholder).toBe(
      'Search components'
    );
    expect(m.q('component-picker-system')?.textContent).toBe('Alligators brand system');
    expect(m.q('component-picker-group-brand')).not.toBeNull();
    expect(m.q('component-picker-group-components')).not.toBeNull();
    expect(m.q('component-picker-group-patterns')).toBeNull();
    expect(m.q('component-picker-open-ds')?.textContent).toBe('Open Design system');
    await m.done();
  });

  test('only the highlighted row shows its variant chips; the first is current', async () => {
    const m = await mount();
    // row 0 (Logo) is highlighted first
    expect(m.q('component-picker-variant-Logo-mark')?.getAttribute('aria-current')).toBe('true');
    expect(m.q('component-picker-variant-Button-primary')).toBeNull();
    await m.done();
  });

  test('a click on a row places in ghost mode, with its first variant, and closes', async () => {
    const m = await mount();
    await m.click('component-picker-row-Button');
    expect(m.calls.placed).toEqual([
      {
        dgn: 'place-component',
        component: 'Button',
        label: 'Tlačítko · Plné',
        variant: 'primary',
        mode: 'ghost',
      },
    ]);
    expect(m.calls.closed).toBe(1);
    await m.done();
  });

  test('a variant chip places that variant in ghost mode', async () => {
    const m = await mount();
    await m.keys('ArrowDown', 'ArrowDown'); // Logo → Icon → Button: its chips show
    await m.click('component-picker-variant-Button-outline');
    expect(m.calls.placed).toEqual([
      {
        dgn: 'place-component',
        component: 'Button',
        label: 'Tlačítko · Obrys',
        variant: 'outline',
        mode: 'ghost',
      },
    ]);
    await m.done();
  });

  test('↵ places the highlighted row in selection mode', async () => {
    const m = await mount();
    await m.keys('ArrowDown', 'Enter'); // Logo → Icon
    expect(m.calls.placed).toEqual([
      {
        dgn: 'place-component',
        component: 'Icon',
        label: 'Icon',
        glyph: 'star',
        mode: 'selection',
      },
    ]);
    await m.done();
  });

  test('Open Design system hands over and closes', async () => {
    const m = await mount();
    await m.click('component-picker-open-ds');
    expect(m.calls.openedDs).toBe(1);
    expect(m.calls.closed).toBe(1);
    await m.done();
  });

  test('a role that cannot edit sees no panel and never reads the list', async () => {
    let loads = 0;
    const m = await mount({
      canEdit: false,
      load: async () => {
        loads++;
        return LIST;
      },
    });
    expect(m.q('tool-panel-components')).toBeNull();
    expect(loads).toBe(0);
    await m.done();
  });

  test('a refused or failed read says so in one line', async () => {
    const m = await mount({
      load: async () => {
        throw new Error('403');
      },
    });
    expect(m.q('component-picker-error')?.textContent).toContain('could not be read');
    await m.done();
  });

  test('no design system in the project: said plainly, no rows', async () => {
    const m = await mount({
      load: async () => ({ ...LIST, system: null, brand: [], components: [] }),
    });
    expect(m.q('component-picker-empty')?.textContent).toContain('no design system');
    await m.done();
  });
});
