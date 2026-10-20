// S10.7 (13 · ds-edit-colour) — a token of the Design system canvas in the inspector: the kind, the frame that
// draws only its block, the live contrast in both modes while the picker is dragged, nothing written until the
// drag ends, Dark follows, a locked brand colour, and a clash with a second editor. Real markup and registry;
// only fetch and the writer are faked (the writer itself is proven against the real routes in
// ds-pending-merge.test.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;

const tok = (
  css: string,
  label: string,
  light: string,
  dark: string,
  extra: Record<string, unknown> = {}
) => ({
  css,
  section: 'colour',
  group: 'accent',
  kind: 'color',
  label,
  valueNames: {},
  locked: false,
  darkFollows: null,
  values: { light, dark },
  used: null,
  pending: null,
  ...extra,
});
const MODEL = () => ({
  format: 'maude.ds-board',
  v: 1,
  system: 'studio',
  label: 'Studio',
  rootClass: 'studio',
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
  converted: true,
  tokens: [
    tok('--bg-0', 'Page', '#ffffff', '#111111'),
    tok('--fg-0', 'Ink', '#111111', '#f5f5f5'),
    tok('--accent', 'Accent', 'oklch(0.50 0.190 255)', 'oklch(0.60 0.175 255)', {
      valueNames: { light: 'Azure', dark: 'Azure' },
      used: 5,
    }),
    tok('--accent-fg', 'Text on accent', '#ffffff', '#0a0a0a'),
    tok('--brand', 'Klubová zelená', '#006a4e', '#2fb58a', { locked: true, used: 3 }),
    tok('--radius-md', 'Corner M', '10px', '10px', { kind: 'length', section: 'space' }),
  ],
  typeRoles: [],
  components: [],
  logos: [],
  pendingCount: 0,
  canvases: 5,
});

let board: ReturnType<typeof MODEL> | null = MODEL();
const asked: string[] = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    asked.push(u);
    if (u.startsWith('/_api/ds/board')) {
      return board
        ? new Response(JSON.stringify(board), { status: 200 })
        : new Response('{}', { status: 404 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
});
afterAll(async () => {
  const { offDsToken } = await import('../client/v2/ds/kinds/token.jsx');
  offDsToken();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  board = MODEL();
  asked.length = 0;
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
  const { registerDsTokenKind } = await import('../client/v2/ds/kinds/token.jsx');
  registerDsTokenKind();
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
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
const propsOf = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (ev: unknown) => void>>)[key];
};
// a dispatched `input` event does not reach React's onChange under happy-dom: call the handler React attached
const type = async (el: Element | null, value: string) => {
  const e = must(el, 'input') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(e, value);
    propsOf(e).onChange({ target: e, currentTarget: e });
  });
};
const click = async (el: Element | null, what = 'element') => {
  const e = must(el, what);
  await act(async () => {
    e.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const blur = async (el: Element | null) => {
  const e = must(el, 'input');
  await act(async () => {
    propsOf(e).onBlur({ target: e, currentTarget: e });
  });
  await settle();
};

const FILE = '.design/system/studio/design-system.tsx';
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  defaultDesignSystem: 'studio',
};
const swatch = (css: string, label: string, kind = 'color') => ({
  tag: 'span',
  classes: 'ds-sw',
  selector: `[data-ds-token="${css}"]`,
  text: label,
  artboardId: 'ds-colour',
  index: 0,
  file: FILE,
  dom_path: ['article', 'div', 'span.ds-sw'],
  bounds: { x: 10, y: 10, w: 104, h: 70 },
  authored: {},
  computed: {},
  customStyles: {},
  attrs: { 'data-ds-token': css, 'data-ds-label': label, 'data-ds-kind': kind },
});
const ACCENT = swatch('--accent', 'Accent');

async function frame(selected: unknown, over: Record<string, unknown> = {}) {
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  return mount(
    <InspectorFrame
      {...({
        selected,
        layersTree: { artboardId: 'ds-colour', nodes: [] },
        cfg: CFG,
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
        onRunAction: () => {},
        ...over,
      } as never)}
    />
  );
}

describe('the kind', () => {
  test('a swatch is a Colour, another token a Token; a plain element and several swatches are not', async () => {
    const { resolveKind, kindChipOf } = await import('../client/v2/inspector/kinds/index.js');
    expect(resolveKind(ACCENT).id).toBe('ds-token');
    expect(resolveKind(ACCENT).bare).toBe(true);
    expect(kindChipOf(ACCENT)).toBe('Colour');
    expect(kindChipOf(swatch('--radius-md', 'Corner M', 'length'))).toBe('Token');
    expect(resolveKind({ ...ACCENT, attrs: {} }).id).not.toBe('ds-token');
    expect(resolveKind([ACCENT, swatch('--fg-0', 'Ink')]).id).toBe('multi');
    // a hostile attribute is not a token name
    expect(resolveKind({ ...ACCENT, attrs: { 'data-ds-token': 'x"] , *' } }).id).not.toBe(
      'ds-token'
    );
  });

  test('the title is the designer’s label, not the swatch’s text', async () => {
    const { titleOf } = await import('../client/v2/inspector/model.js');
    expect(titleOf(ACCENT, null)).toBe('Accent');
  });
});

describe('the frame draws only the token block', () => {
  test('no object sections, no raw code fold; Light | Dark, the names, the contrast, where it is used', async () => {
    const host = await frame(ACCENT);
    expect(q(host, 'inspector-frame')?.getAttribute('data-kind')).toBe('ds-token');
    expect(q(host, 'inspector-title')?.textContent).toBe('Accent');
    expect(q(host, 'inspector-kind')?.textContent).toBe('Colour');
    expect(q(host, 'insp-sec-ds-token')).not.toBeNull();
    expect(q(host, 'insp-sec-position')).toBeNull();
    expect(q(host, 'insp-sec-fill')).toBeNull();
    expect(
      host.querySelector('[data-testid="inspector-advanced"], [data-testid="insp-advanced"]')
    ).toBeNull();
    expect(asked).toContain('/_api/ds/board?ds=studio');
    expect(q(host, 'ds-token-light')?.textContent).toBe('Azure');
    expect(q(host, 'ds-token-dark')?.textContent).toBe('Follows Light');
    expect(q(host, 'ds-token-contrast')?.textContent).toMatch(
      /Light \d+(\.\d)?:1 · Dark \d+(\.\d)?:1/
    );
    expect(q(host, 'ds-token-contrast')?.getAttribute('data-tone')).toBe('ok');
    expect(q(host, 'ds-token-used')?.textContent).toContain('Used in 5 canvases');
    expect(q(host, 'ds-token-picker')).not.toBeNull();
    expect(q(host, 'ds-token-note')).toBeNull();
  });

  test('a token on a canvas that follows no system says so, quietly', async () => {
    const host = await frame(ACCENT, {
      cfg: { designRel: '.design', designSystems: [] },
      canvasFile: '.design/ui/x.tsx',
    });
    expect(q(host, 'ds-token-nosystem')).not.toBeNull();
    expect(q(host, 'ds-token-picker')).toBeNull();
  });

  test('the system cannot be read: the panel says so and offers nothing', async () => {
    board = null;
    const host = await frame(ACCENT);
    expect(q(host, 'ds-token-loading')?.textContent).toContain('isn’t available');
  });
});

async function panel(over: Record<string, unknown> = {}, css = '--accent') {
  const { TokenPanel } = await import('../client/v2/ds/kinds/token.jsx');
  const writes: Array<Record<string, unknown>> = [];
  const adopted: unknown[] = [];
  let refreshed = 0;
  const m = MODEL();
  const host = await mount(
    <TokenPanel
      {...({
        css,
        ds: 'studio',
        model: m,
        onWrite: async (a: Record<string, unknown>) => {
          writes.push(a);
          return { ok: true };
        },
        onRefresh: async () => {
          refreshed++;
        },
        onAdopt: (x: unknown) => adopted.push(x),
        ...over,
      } as never)}
    />
  );
  return { host, writes, adopted, refreshed: () => refreshed };
}

describe('dragging the picker', () => {
  test('contrast updates live in both modes and NOTHING is written until the drag ends', async () => {
    const { host, writes, refreshed } = await panel();
    const before = q(host, 'ds-token-contrast')?.textContent;
    // drag Light to a pale colour: the white text on it falls short
    await type(q(host, 'ds-token-picker'), '#f2f2f2');
    const live = q(host, 'ds-token-contrast');
    expect(live?.getAttribute('data-tone')).toBe('warn');
    expect(live?.textContent).toMatch(/^\s*\d+(\.\d)?:1 on Text on accent in Light\s*$/);
    expect(live?.textContent).not.toBe(before);
    expect(writes).toHaveLength(0);
    // the picker closes: ONE write, no dialog
    await act(async () => {
      q(host, 'ds-token-picker')?.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ ds: 'studio', css: '--accent' });
    expect((writes[0] as { edit: { theme: string; value: string } }).edit).toEqual({
      theme: 'light',
      value: expect.stringMatching(/^oklch\(/), // written the way the file writes colours
    });
    expect(refreshed()).toBe(1);
    expect(document.querySelector('[role="dialog"], dialog')).toBeNull();
  });

  test('Dark follows while Light is dragged: the contrast line judges the Dark the edit will write', async () => {
    const { host } = await panel();
    // a very dark Light would, with Dark following, push Dark darker still than its surface
    await type(q(host, 'ds-token-picker'), '#101010');
    expect(q(host, 'ds-token-contrast')).not.toBeNull();
  });

  test('a drag left unfinished is written when the selection moves on', async () => {
    const { host, writes } = await panel();
    await type(q(host, 'ds-token-picker'), '#336699');
    expect(writes).toHaveLength(0);
    await act(async () => {
      for (const r of roots.splice(0)) r.unmount();
    });
    expect(writes).toHaveLength(1);
    expect((writes[0] as { edit: { value: string } }).edit.value).toMatch(/^oklch\(/);
    void host;
  });
});

describe('typing, naming, Dark', () => {
  test('a typed value is written on blur; one that cannot be a value is refused in words, nothing sent', async () => {
    const { host, writes } = await panel();
    await type(q(host, 'ds-token-value'), 'oklch(0.45 0.2 255)');
    await blur(q(host, 'ds-token-value'));
    expect(writes).toHaveLength(1);
    expect((writes[0] as { edit: unknown }).edit).toEqual({
      theme: 'light',
      value: 'oklch(0.45 0.2 255)',
    });
    await type(q(host, 'ds-token-value'), 'red; } body { display:none');
    await blur(q(host, 'ds-token-value'));
    expect(writes).toHaveLength(1);
    expect(q(host, 'ds-token-note')?.textContent).toBe('That isn’t a value this token can take.');
  });

  test('Editing → Dark switches what the picker and the box change', async () => {
    const { host, writes } = await panel();
    const seg = host.querySelectorAll('.st-cp-segbtn');
    expect(seg).toHaveLength(2);
    await click(seg[1], 'Dark');
    expect((q(host, 'ds-token-value') as HTMLInputElement).value).toBe('oklch(0.60 0.175 255)');
    await type(q(host, 'ds-token-value'), '#4488cc');
    await blur(q(host, 'ds-token-value'));
    expect((writes[0] as { edit: unknown }).edit).toEqual({ theme: 'dark', value: '#4488cc' });
  });

  test('"Dark follows automatically" is a switch; off means Dark is the person’s', async () => {
    const { host, writes } = await panel();
    const row = must(q(host, 'insp-row-ds-follows'), 'row');
    const sw = must(row.querySelector('input[type="checkbox"]'), 'switch') as HTMLInputElement;
    expect(sw.checked).toBe(true);
    await act(async () => {
      propsOf(sw).onChange({ target: { checked: false } });
    });
    await settle();
    expect((writes[0] as { edit: unknown }).edit).toEqual({ follows: false });
  });

  test('a token that was set by hand shows the switch off and Dark as its own value', async () => {
    const m = MODEL();
    (m.tokens[2] as { darkFollows: boolean | null }).darkFollows = false;
    const { host } = await panel({ model: m });
    const sw = host.querySelector('[data-testid="insp-row-ds-follows"] input') as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(q(host, 'ds-token-dark')?.textContent).toBe('Azure');
  });

  test('the colour’s name is written on blur', async () => {
    const { host, writes } = await panel();
    const name = must(q(host, 'ds-token-name'), 'name') as HTMLInputElement;
    await act(async () => {
      name.value = 'Deeper azure';
      propsOf(name).onBlur({ target: name, currentTarget: name });
    });
    await settle();
    expect((writes[0] as { edit: unknown }).edit).toEqual({ theme: 'light', name: 'Deeper azure' });
  });

  test('a token with one value has no Editing switch, no picker, no contrast', async () => {
    const m = MODEL();
    const t = m.tokens[5] as { values: Record<string, string> };
    t.values = { light: '10px' };
    const { host } = await panel({ model: m }, '--radius-md');
    expect(host.querySelectorAll('.st-cp-segbtn')).toHaveLength(0);
    expect(q(host, 'ds-token-picker')).toBeNull();
    expect(q(host, 'ds-token-contrast')).toBeNull();
    expect((q(host, 'ds-token-value') as HTMLInputElement).value).toBe('10px');
  });
});

describe('what is frozen, what clashes', () => {
  test('a locked brand colour shows the lock and offers no field', async () => {
    const { host, writes } = await panel({}, '--brand');
    expect(q(host, 'ds-token-locked')).not.toBeNull();
    expect(q(host, 'insp-sec-ds-token')?.getAttribute('data-locked')).toBe('true');
    expect(q(host, 'ds-token-locked-line')?.textContent).toBe(
      'Locked brand colour. It can’t be changed here.'
    );
    expect(q(host, 'ds-token-picker')).toBeNull();
    expect(q(host, 'ds-token-value')).toBeNull();
    expect(q(host, 'ds-token-name')).toBeNull();
    expect(writes).toHaveLength(0);
  });

  test('someone else changed the same token: their edit is adopted and the words say so', async () => {
    const theirs = MODEL();
    (theirs.tokens[2] as { pending: unknown }).pending = {
      values: { light: '#224466' },
      trashTo: null,
      added: false,
      by: 'Jonas',
      at: '2026-10-20T10:00:00.000Z',
      valueNames: {},
      darkFollows: null,
    };
    const { host, adopted } = await panel({
      onWrite: async () => ({
        ok: false,
        code: 'ds-pending-conflict',
        message: 'Someone changed this just now. Showing their edit.',
        model: theirs,
      }),
    });
    await type(q(host, 'ds-token-value'), '#aa3300');
    await blur(q(host, 'ds-token-value'));
    expect(q(host, 'ds-token-note')?.textContent).toBe(
      'Someone changed this just now. Showing their edit.'
    );
    expect(adopted).toEqual([theirs]);
  });

  test('a waiting edit says what it was ("was Azure") and the flag the board shows', async () => {
    const m = MODEL();
    (m.tokens[2] as { pending: unknown }).pending = {
      values: { light: '#224466' },
      trashTo: null,
      added: false,
      by: 'Michal',
      at: '2026-10-20T10:00:00.000Z',
      valueNames: { light: 'Deeper azure' },
      darkFollows: null,
    };
    const { host } = await panel({ model: m });
    expect(q(host, 'ds-token-used')?.textContent).toContain('Used in 5 canvases · was Azure');
    expect(q(host, 'ds-token-light')?.textContent).toBe('Deeper azure');
  });
});
