// S2.2 — the Inspector frame rendered: header (name · kind chip · crumbs · "Uses <system>"), the numbered
// sections other slices fill, and "› Advanced" holding the unchanged v1 raw editor (no Designer/Advanced
// switch any more). Real markup, real CssKnobs, real registry; only fetch and the
// clipboard are faked.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
const calls: Array<{ url: string; body?: string }> = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const offs: Array<() => void> = [];
beforeEach(async () => {
  calls.length = 0;
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  for (const off of offs.splice(0)) off();
  document.body.innerHTML = '';
});

async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
// Typing calls the input's own React onChange: react-dom decides at import time whether the page can hear
// `input` events and the imports are hoisted above happy-dom's registration (see v2-search-ui.test.tsx).
async function type(input: HTMLInputElement | null, value: string, key?: string) {
  if (!input) throw new Error('missing input');
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  // focus first: with no native `input` event, React's polyfill reads keys through the focused instance
  await act(async () => input.focus());
  await act(async () => {
    // the instance setter, not the prototype's: it keeps React's value tracker in step, so the polyfill that
    // treats a later keydown as a possible change does not replay onChange over the handler's own update
    input.value = value;
    props.onChange({ target: input, currentTarget: input });
  });
  if (key) {
    await act(async () => {
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    });
  }
}

const BUTTON = {
  id: 'book-call',
  index: 0,
  tag: 'button',
  classes: 'cta primary',
  selector: 'button.cta',
  text: 'Book a call',
  bounds: { x: 1220, y: 22, w: 148, h: 44 },
  dom_path: ['div.nav', 'button.cta'],
  authored: {
    display: 'inline-flex',
    gap: 'var(--space-8)',
    background: 'var(--ink)',
    'border-radius': 'var(--radius-round)',
  },
  computed: { display: 'inline-flex', gap: '8px' },
  customStyles: {},
  attrs: {},
  artboardId: 'desktop',
};
const TREE = {
  artboardId: 'desktop',
  nodes: [
    {
      id: 'nav',
      index: 0,
      tag: 'nav',
      label: 'Nav',
      children: [{ id: 'book-call', index: 0, tag: 'button', label: 'Book a call', children: [] }],
    },
  ],
};
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: '' }],
  defaultDesignSystem: 'Studio',
};
const noop = () => {};

async function frame(over: Record<string, unknown> = {}) {
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const props = {
    selected: BUTTON,
    layersTree: TREE,
    cfg: CFG,
    canvasFile: '.design/ui/Homepage.tsx',
    onOptimistic: noop,
    onRecordEdit: noop,
    onReplaceMedia: noop,
    onUndoRedo: noop,
    ...over,
  };
  return mount(<InspectorFrame {...(props as never)} />);
}

describe('the header', () => {
  test('name, kind chip, crumbs and the design system it uses', async () => {
    const host = await frame();
    expect(q(host, 'inspector-frame')).not.toBeNull();
    expect(q(host, 'inspector-title')?.textContent).toBe('Book a call');
    expect(q(host, 'inspector-kind')?.textContent).toBe('Button');
    const crumbs = q(host, 'inspector-crumbs')?.textContent ?? '';
    expect(crumbs).toContain('Nav');
    expect(crumbs).toContain('Book a call');
    expect(q(host, 'inspector-uses')?.textContent).toContain('Uses Studio');
  });

  test('an artboard shows its artboard kind (C16) and its own id as the name', async () => {
    const host = await frame({
      selected: {
        selector: '[data-dc-screen="desktop"]',
        tag: 'div',
        artboardId: 'desktop',
        attrs: { 'data-dc-kind': 'web' },
        bounds: { x: 0, y: 0, w: 1440, h: 900 },
      },
      layersTree: null,
    });
    expect(q(host, 'inspector-kind')?.textContent).toBe('Web page');
    expect(q(host, 'inspector-title')?.textContent).toBe('desktop');
    expect(q(host, 'inspector-crumbs')).toBeNull();
  });

  test('several objects are one Mixed selection', async () => {
    const host = await frame({ selected: [BUTTON, { ...BUTTON, id: 'b', index: 1 }, BUTTON] });
    expect(q(host, 'inspector-title')?.textContent).toBe('3 objects');
    expect(q(host, 'inspector-kind')?.textContent).toBe('Mixed');
  });
});

describe('the sections other slices fill', () => {
  test('a section with no registered body is not drawn; one with a body is, numbered and explained', async () => {
    const { registerSlot } = await import('../client/v2/inspector/slots.js');
    offs.push(
      registerSlot('size', {
        id: 'size.test',
        Body: ({ el }: { el: { id: string } }) => <p data-testid="size-body">size of {el.id}</p>,
      })
    );
    const host = await frame();
    expect(q(host, 'insp-sec-position')).toBeNull();
    const sec = q(host, 'insp-sec-size');
    expect(sec).not.toBeNull();
    expect(sec?.getAttribute('data-n')).toBe('2');
    expect(sec?.textContent).toContain('Size');
    expect(sec?.querySelector('[title^="Hug wraps"]')).not.toBeNull();
    expect(q(host, 'size-body')?.textContent).toBe('size of book-call');
  });

  test('a kind-limited body skips other kinds; "+" shows only when the body can add', async () => {
    const { registerSlot } = await import('../client/v2/inspector/slots.js');
    let added = 0;
    offs.push(
      registerSlot('type', { id: 'type.test', kinds: ['text'], Body: () => <i data-testid="tb" /> })
    );
    offs.push(
      registerSlot('fill', {
        id: 'fill.test',
        add: () => {
          added += 1;
        },
        Body: () => <i data-testid="fb" />,
      })
    );
    offs.push(registerSlot('border', { id: 'border.test', Body: () => <i data-testid="bb" /> }));
    const host = await frame();
    expect(q(host, 'insp-sec-type')).toBeNull();
    expect(q(host, 'insp-add-fill')).not.toBeNull();
    expect(q(host, 'insp-add-border')).toBeNull();
    await click(q(host, 'insp-add-fill'));
    expect(added).toBe(1);
  });

  test('with sections present, Advanced starts folded (the one quiet row); a click opens it', async () => {
    const { registerSlot } = await import('../client/v2/inspector/slots.js');
    offs.push(registerSlot('size', { id: 'size.test', Body: () => <i /> }));
    const host = await frame();
    expect(q(host, 'fold-inspector-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(q(host, 'fold-inspector-body')).toBeNull();
    await click(q(host, 'fold-inspector-toggle'));
    expect(q(host, 'fold-inspector-body')).not.toBeNull();
  });
});

describe('› Advanced holds the unchanged v1 raw editor', () => {
  test('the CSS panel, tag and class, custom CSS and HTML attribute rows are all there; the vocabulary switch is not', async () => {
    const host = await frame(); // no section bodies yet: Advanced is the editor, so it starts open
    const body = q(host, 'fold-inspector-body');
    expect(body).not.toBeNull();
    expect(body?.querySelector('[data-tour="css-panel"]')).not.toBeNull();
    expect(body?.querySelector('.st-cp-idtag')?.textContent).toContain('button');
    expect(body?.querySelector('.st-cp-idtag')?.textContent).toContain('.cta');
    // sections of the raw editor are collapsed headers; the nested Advanced one holds the rows
    const adv = body?.querySelector<HTMLElement>('[data-testid="inspector-section-advanced"]');
    expect(adv).not.toBeNull();
    await click(adv ?? null);
    expect(body?.querySelector('[data-testid="inspector-custom-css"]')).not.toBeNull();
    expect(body?.querySelector('[data-testid="inspector-html-attrs"]')).not.toBeNull();
    // rule 13: Designer is the only default — no Designer/Advanced switch, no designer regroup
    expect(host.querySelector('[data-tour="cp-mode"]')).toBeNull();
    expect(host.querySelector('.st-cp--designer')).toBeNull();
  });

  test('the selector then the element text, the DOM path on hover; the facts the Inspect tab showed', async () => {
    const host = await frame();
    const sel = q(host, 'inspector-selection');
    expect(sel?.textContent).toContain('button.cta');
    expect(sel?.getAttribute('title')).toBe('div.nav > button.cta');
    expect(q(host, 'inspector-selection-text')?.textContent).toContain('Book a call');
    const facts = q(host, 'inspector-facts');
    const values = [...(facts?.querySelectorAll('input') ?? [])].map(
      (i) => (i as HTMLInputElement).value
    );
    expect(values).toEqual(['1220', '22', '148', '44']);
    // S11.8: the tag and the classes are rows of their own (Element › Tag · Classes), not part of the facts
    expect(q(host, 'adv-tag')?.textContent).toBe('Tagbutton');
    expect(q(host, 'adv-classes')?.textContent).toBe('Classescta primary');
  });

  test('an artboard has its own sections (S2.8); Advanced holds only what has no section yet', async () => {
    const host = await frame({
      selected: {
        selector: '[data-dc-screen="desktop"]',
        tag: 'div',
        artboardId: 'desktop',
        attrs: { 'data-dc-kind': 'web' },
        bounds: { x: 0, y: 0, w: 1440, h: 900 },
        worldW: 1440,
        worldH: 900,
      },
      layersTree: null,
    });
    const body = q(host, 'fold-inspector-body');
    // the size lives in the Artboard section (v2-inspector-artboard.test.tsx), no longer in the fold
    expect(body?.querySelector('[aria-label="artboard width"]')).toBeNull();
    expect(body?.querySelector('[data-tour="css-panel"]')).toBeNull();
  });

  test('tokens bound: the property in plain words, the variable beside it and as the hover (S11.8)', async () => {
    const host = await frame();
    const list = q(host, 'inspector-tokens-used');
    const labels = [...(list?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    expect(labels).toEqual(['Gap--space-8', 'Fill--ink', 'Corners--radius-round']);
    expect(list?.querySelector('li')?.getAttribute('title')).toBe('--space-8');
  });
});

describe('the element id (V2-1.4)', () => {
  test('shows the authored id; a valid new one goes to the rename, then reads back', async () => {
    const renames: unknown[] = [];
    const host = await frame({
      onRenameElementId: async (r: unknown) => {
        renames.push(r);
        return { ok: true };
      },
    });
    const input = q(host, 'inspector-element-id') as HTMLInputElement;
    expect(input.value).toBe('book-call');
    await type(input, 'cta-main', 'Enter');
    expect(renames).toEqual([
      {
        from: 'book-call',
        to: 'cta-main',
        index: 0,
        artboardId: 'desktop',
        canvas: '.design/ui/Homepage.tsx',
      },
    ]);
    expect(q(host, 'inspector-id-error')).toBeNull();
  });

  test('an invalid or taken id says so in plain words and writes nothing', async () => {
    const renames: unknown[] = [];
    const host = await frame({
      onRenameElementId: async (r: unknown) => {
        renames.push(r);
        return { ok: true };
      },
    });
    const input = q(host, 'inspector-element-id') as HTMLInputElement;
    await type(input, 'Cta Main', 'Enter');
    expect(q(host, 'inspector-id-error')?.textContent).toMatch(/lower-case/i);
    await type(input, 'nav', 'Enter'); // another element's id (from the layers tree)
    expect(q(host, 'inspector-id-error')?.textContent).toMatch(/already/i);
    expect(renames).toEqual([]);
  });

  test('a refusal from the writer (held by AI, taken, locked) is shown as said', async () => {
    const host = await frame({
      onRenameElementId: async () => ({ ok: false, message: 'Footer is AI’s until it’s done.' }),
    });
    await type(q(host, 'inspector-element-id') as HTMLInputElement, 'cta-main', 'Enter');
    expect(q(host, 'inspector-id-error')?.textContent).toBe('Footer is AI’s until it’s done.');
  });

  test('esc puts the old id back; a computed id shows as a placeholder, not a name', async () => {
    const host = await frame();
    const input = q(host, 'inspector-element-id') as HTMLInputElement;
    await type(input, 'something', 'Escape');
    expect(input.value).toBe('book-call');
    const h2 = await frame({ selected: { ...BUTTON, id: '0a1b2c3d' } });
    const computed = q(h2, 'inspector-element-id') as HTMLInputElement;
    expect(computed.value).toBe('');
    expect(computed.getAttribute('placeholder')).toBe('0a1b2c3d');
  });
});

describe('copy', () => {
  test('Copy CSS puts the declarations on the clipboard, Copy id the id', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    });
    const host = await frame();
    await click(q(host, 'inspector-copy-css'));
    await click(q(host, 'inspector-copy-id'));
    expect(written[0]).toBe(
      'display: inline-flex;\ngap: var(--space-8);\nbackground: var(--ink);\nborder-radius: var(--radius-round);'
    );
    expect(written[1]).toBe('book-call');
  });
});

describe('the registry actions (⌘K) run on the element the frame shows', () => {
  const written: string[] = [];
  beforeEach(() => {
    written.length = 0;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    });
  });

  test('Copy CSS and Copy element id copy and say so', async () => {
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    await frame();
    expect(await runInspectorAction('inspector.copy-css')).toBe('Copied the CSS.');
    expect(written[0]).toContain('display: inline-flex;');
    expect(await runInspectorAction('element.copy-id')).toBe('Copied the element id.');
    expect(written[1]).toBe('book-call');
  });

  test('Edit element id… opens Advanced and puts the cursor in the field', async () => {
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    const { registerSlot } = await import('../client/v2/inspector/slots.js');
    offs.push(registerSlot('size', { id: 'size.test', Body: () => <i /> }));
    const host = await frame(); // a section exists, so Advanced starts folded
    expect(q(host, 'fold-inspector-body')).toBeNull();
    await act(async () => {
      await runInspectorAction('element.set-id');
    });
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(q(host, 'fold-inspector-body')).not.toBeNull();
    expect(document.activeElement).toBe(q(host, 'inspector-element-id'));
  });

  test('Clear link (S3.10a) drops the link through /_api/edit-op and says so; no link says so too', async () => {
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    await frame({ selected: BUTTON });
    calls.length = 0;
    // S2.17: the frame asks /_api/edit-instance whether a single selection is an instance; that is not an edit
    const edits = () => calls.filter((c) => !c.url.startsWith('/_api/edit-instance'));
    expect(await runInspectorAction('element.clear-link')).toBe('This object has no link.');
    expect(edits()).toEqual([]);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    await frame({
      selected: { ...BUTTON, attrs: { 'data-cd-link': '#pricing' } },
    });
    expect(await runInspectorAction('element.clear-link')).toBe('Cleared the link.');
    expect(edits().map((c) => [c.url, JSON.parse(c.body ?? '{}')])).toEqual([
      [
        '/_api/edit-op',
        {
          file: '.design/ui/Homepage.tsx',
          op: 'element.clear-link',
          targets: [{ artboard: 'desktop', element: 'book-call' }],
        },
      ],
    ]);
  });

  test('a computed id has nothing to copy yet, and says how to get one', async () => {
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    await frame({ selected: { ...BUTTON, id: '0a1b2c3d' } });
    expect(await runInspectorAction('element.copy-id')).toContain('Edit element id');
    expect(written).toEqual([]);
  });

  test('several objects ask for one; with no frame mounted the answer is one plain line', async () => {
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    await frame({ selected: [BUTTON, { ...BUTTON, id: 'b', index: 1 }] });
    expect(await runInspectorAction('inspector.copy-css')).toBe('Select one object first.');
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    expect(await runInspectorAction('inspector.copy-css')).toBe('Select an object first.');
  });
});

describe('inside the Inspector island', () => {
  async function panel(over: Record<string, unknown> = {}) {
    const { InspectorPanel } = await import('../client/inspector/inspector-panel.jsx');
    const props = {
      testId: 'inspector-panel',
      selected: BUTTON,
      layersTree: TREE,
      cfg: CFG,
      canvasFile: '.design/ui/Homepage.tsx',
      tab: 'inspect', // the v1 default — it opens the frame now
      onTabChange: noop,
      onClose: noop,
      onOptimistic: noop,
      onRecordEdit: noop,
      onUndoRedo: noop,
      ...over,
    };
    return mount(<InspectorPanel {...(props as never)} />);
  }

  test('one body: the frame. No Inspect / CSS tabs, no vocabulary switch; Close stays', async () => {
    let closed = 0;
    const host = await panel({
      onClose: () => {
        closed += 1;
      },
    });
    expect(
      host.querySelector('[data-testid="inspector-panel"] [data-testid="inspector-frame"]')
    ).not.toBeNull();
    const tabs = [...host.querySelectorAll('.st-rp-tab')].map((b) => b.textContent?.trim());
    expect(tabs).not.toContain('CSS');
    expect(tabs).not.toContain('Inspect');
    expect(host.querySelector('[data-tour="cp-mode"]')).toBeNull();
    await click(host.querySelector('[aria-label="Close inspector"]'));
    expect(closed).toBe(1);
  });

  test('the old CSS tab id opens the same frame', async () => {
    const host = await panel({ tab: 'css' });
    expect(q(host, 'inspector-frame')).not.toBeNull();
  });

  test('a photo selection adds a Photo tab beside the frame; nothing else changes', async () => {
    const host = await panel({
      selected: { ...BUTTON, tag: 'img', photoAsset: 'assets/0123abcd.png' },
    });
    const tabs = [...host.querySelectorAll('.st-rp-tab')].map((b) => b.textContent?.trim());
    expect(tabs).toContain('Photo');
    expect(tabs).toContain('Inspector');
  });

  test('the standalone Layers panel is untouched', async () => {
    const host = await panel({ layersOnly: true, tab: 'layers', testId: 'layers-panel' });
    expect(q(host, 'inspector-frame')).toBeNull();
    expect(host.querySelector('[role="tree"]')).not.toBeNull();
  });

  test('nothing selected keeps the empty line', async () => {
    const host = await panel({ selected: null });
    expect(q(host, 'inspector-frame')).toBeNull();
    expect(host.textContent).toContain('click an element to select it');
  });
});
