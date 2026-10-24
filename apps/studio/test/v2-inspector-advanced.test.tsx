// S11.8 — Inspector › Advanced per 06 (ad-inspector), rendered. Real markup, the real registry and the real
// raw editor; only fetch, the clipboard and the menu runner's canvas lane are faked.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
type Call = { url: string; body?: Record<string, unknown> };
const calls: Call[] = [];
let source = '';
let sourceStatus = 200;
let sourceBody: Record<string, unknown> | null = null;

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (String(url).startsWith('/_api/canvas-source')) {
      return new Response(JSON.stringify(sourceBody ?? { ok: true, source }), {
        status: sourceStatus,
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const offs: Array<() => void> = [];
const written: string[] = [];
beforeEach(() => {
  calls.length = 0;
  written.length = 0;
  source = '';
  sourceStatus = 200;
  sourceBody = null;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (t: string) => void written.push(t) },
    configurable: true,
  });
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
async function type(input: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!input) throw new Error('missing input');
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  await act(async () => input.focus());
  await act(async () => {
    input.value = value;
    props.onChange({ target: input, currentTarget: input });
  });
}

const BUTTON = {
  id: 'book-call',
  index: 0,
  file: '.design/ui/Homepage.tsx',
  tag: 'a',
  classes: 'btn btn--primary',
  selector: 'nav > a.btn',
  text: 'Book a call',
  bounds: { x: 1220, y: 22, w: 148, h: 44 },
  dom_path: ['nav', 'a.btn'],
  authored: {
    padding: '12px 24px',
    'border-radius': '999px',
    background: 'var(--ink)',
    color: 'var(--paper)',
  },
  computed: {},
  customStyles: {},
  attrs: { 'aria-label': 'Book a call' },
  artboardId: 'desktop',
};
const CFG = { designRel: '.design', designSystems: [], readOnly: false };
const noop = () => {};
const edit = { onOptimistic: noop, onRecordEdit: noop, onReplaceMedia: noop, onUndoRedo: noop };

async function fold(over: Record<string, unknown> = {}) {
  const { InspectorAdvanced } = await import('../client/v2/inspector/advanced.jsx');
  const props = {
    selected: BUTTON,
    el: BUTTON,
    layersTree: { artboardId: 'desktop', nodes: [] },
    cfg: CFG,
    canvasFile: '.design/ui/Homepage.tsx',
    open: true,
    onToggle: noop,
    onRenameElementId: async () => ({ ok: true }),
    edit,
    artboard: {},
    editScope: { scope: 'shared', affects: 4, componentName: 'Cta' },
    onDetachInstance: noop,
    ...over,
  };
  return mount(<InspectorAdvanced {...(props as never)} />);
}

const rowIds = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-testid^="adv-group-"]')].map((g) =>
    g.getAttribute('data-testid')?.replace('adv-group-', '')
  );

describe('06 · ad-inspector — closed and open', () => {
  test('closed, the fold says "Code, tokens, CSS" and draws no rows', async () => {
    const host = await fold({ open: false });
    expect(q(host, 'fold-inspector-toggle')?.textContent).toContain('Code, tokens, CSS');
    expect(q(host, 'fold-inspector-body')).toBeNull();
    expect(rowIds(host)).toEqual([]);
  });

  test('open, the groups come in the golden order: Element · Used in · Tokens it uses · CSS · actions', async () => {
    const host = await fold();
    expect(rowIds(host)).toEqual(['element', 'used-in', 'tokens', 'css', 'in-code']);
    const titles = [...host.querySelectorAll('.insp-sub')].map(
      (p) => p.firstElementChild?.textContent
    );
    expect(titles).toEqual(['Element', 'Used in', 'Tokens it uses', 'CSS']);
  });

  test('every registered row of an element, in draw order (the registry golden)', async () => {
    await fold();
    const { advancedRowIds } = await import('../client/v2/inspector/advanced-rows.js');
    expect(advancedRowIds('element')).toEqual([
      'element.tag',
      'element.classes',
      'element.selector',
      'element.id',
      'element.facts',
      'used-in.scope',
      'tokens.bound',
      'css.declarations',
      'css.add',
      'css.raw-editor',
      'code.copy-style',
      'code.paste-style',
      'code.copy-css',
      'code.copy-code',
    ]);
  });

  test('Element: Tag · Classes · Selector · Element id, with the id copyable', async () => {
    const host = await fold();
    const group = q(host, 'adv-group-element') as HTMLElement;
    const labels = [...group.querySelectorAll('.insp-arow > .insp-ak')].map((s) => s.textContent);
    expect(labels).toEqual(['Tag', 'Classes', 'Selector', 'Element id']);
    expect(q(host, 'adv-tag')?.textContent).toContain('a');
    expect(q(host, 'adv-classes')?.textContent).toContain('btn btn--primary');
    expect(q(host, 'inspector-selection')?.textContent).toContain('nav > a.btn');
    expect((q(host, 'inspector-element-id') as HTMLInputElement).value).toBe('book-call');
    await click(q(host, 'inspector-copy-id'));
    expect(written).toEqual(['book-call']);
  });

  test('Used in: "Edits apply to Shared · 4 places" + Detach; one place reads in the singular', async () => {
    const detached: unknown[][] = [];
    const host = await fold({ onDetachInstance: (...a: unknown[]) => detached.push(a) });
    expect(q(host, 'adv-used-in')?.textContent).toContain('Edits apply to');
    expect(q(host, 'adv-used-in')?.textContent).toContain('Shared · 4 places');
    await click(q(host, 'adv-detach'));
    expect(detached).toEqual([['book-call', 0]]);
    const one = await fold({ editScope: { scope: 'shared', affects: 1 } });
    expect(q(one, 'adv-used-in')?.textContent).toContain('Shared · 1 place');
    expect(q(one, 'adv-used-in')?.textContent).not.toContain('places');
    const local = await fold({ editScope: { scope: 'local', affects: 1 } });
    expect(q(local, 'adv-used-in')?.textContent).toContain('Only this element');
    expect(q(local, 'adv-detach')).toBeNull();
  });

  test('Tokens it uses: the property in plain words, the variable beside it, once per binding', async () => {
    const host = await fold();
    const rows = [...(q(host, 'inspector-tokens-used')?.querySelectorAll('li') ?? [])].map((li) => [
      li.querySelector('.insp-ak')?.textContent,
      li.querySelector('code')?.textContent,
    ]);
    expect(rows).toEqual([
      ['Fill', '--ink'],
      ['Text colour', '--paper'],
    ]);
  });

  test('CSS lists the declarations and the attribute; Property and Attribute add one', async () => {
    const host = await fold();
    const list = q(host, 'adv-css-list');
    expect(list?.textContent).toContain('padding');
    expect(list?.textContent).toContain('12px 24px');
    expect(list?.querySelector('.insp-css--attr')?.textContent).toContain('aria-label');
    // + Property
    await click(q(host, 'adv-add-property'));
    await type(host.querySelector('[aria-label="property name"]'), 'cursor');
    await type(host.querySelector('[aria-label="property value"]'), 'pointer');
    await click(q(host, 'adv-add-property-apply'));
    expect(calls.filter((c) => c.url === '/_api/edit-css').map((c) => c.body)).toEqual([
      { canvas: '.design/ui/Homepage.tsx', id: 'book-call', property: 'cursor', value: 'pointer' },
    ]);
    // + Attribute
    await click(q(host, 'adv-add-attribute'));
    await type(host.querySelector('[aria-label="attribute name"]'), 'data-track');
    await type(host.querySelector('[aria-label="attribute value"]'), 'cta');
    await click(q(host, 'adv-add-attribute-apply'));
    expect(calls.filter((c) => c.url === '/_api/edit-attr').map((c) => c.body)).toEqual([
      { canvas: '.design/ui/Homepage.tsx', id: 'book-call', attr: 'data-track', value: 'cta' },
    ]);
  });

  test('Edit as text turns the list into one block; Apply writes only the changed lines', async () => {
    const host = await fold();
    expect(q(host, 'adv-css-text')).toBeNull();
    await click(q(host, 'adv-edit-css-text'));
    const box = q(host, 'adv-css-text') as HTMLTextAreaElement;
    expect(box.value).toContain('padding: 12px 24px;');
    expect(q(host, 'adv-add-property')).toBeNull(); // one editor at a time
    await type(box, 'padding: 8px 16px;\nborder-radius: 999px;\nbackground: var(--ink);');
    await click(q(host, 'adv-css-text-apply'));
    const writes = calls.filter((c) => c.url === '/_api/edit-css').map((c) => c.body);
    expect(writes).toEqual([
      {
        canvas: '.design/ui/Homepage.tsx',
        id: 'book-call',
        property: 'padding',
        value: '8px 16px',
      },
      { canvas: '.design/ui/Homepage.tsx', id: 'book-call', property: 'color', reset: true },
    ]);
    expect(q(host, 'adv-css-text')).toBeNull(); // done: back to the list
  });

  test('Edit as text names a line it cannot read and writes nothing', async () => {
    const host = await fold();
    await click(q(host, 'adv-edit-css-text'));
    await type(q(host, 'adv-css-text') as HTMLTextAreaElement, 'padding: 8px;\nnot a declaration');
    await click(q(host, 'adv-css-text-apply'));
    expect(q(host, 'adv-css-text-error')?.textContent).toBe(
      'Line 2 needs a property and a value, like color: red;'
    );
    expect(calls.filter((c) => c.url === '/_api/edit-css')).toEqual([]);
  });

  test('the v1 raw editor is still there under CSS (nothing deleted)', async () => {
    const host = await fold();
    const css = q(host, 'adv-group-css') as HTMLElement;
    expect(css.querySelector('[data-tour="css-panel"]')).not.toBeNull();
  });

  test('Copy style and Paste style run the registry actions the canvas already has', async () => {
    const ran: string[] = [];
    const host = await fold({ runAction: (id: string) => ran.push(id) });
    await click(q(host, 'adv-copy-style'));
    await click(q(host, 'adv-paste-style'));
    expect(ran).toEqual(['edit.copy-properties', 'edit.paste-properties']);
  });

  test('Copy CSS puts the declarations on the clipboard', async () => {
    const host = await fold();
    await click(q(host, 'inspector-copy-css'));
    expect(written[0]).toContain('padding: 12px 24px;');
  });
});

describe('Copy code returns the element JSX from /_api/canvas-source (3 fixtures)', () => {
  const FIXTURES: Array<{ name: string; src: string; el: Record<string, unknown>; want: string }> =
    [
      {
        name: 'a self-closing image',
        src: 'export default () => (\n  <nav>\n    <img data-cd-id="logo" src="x.svg" />\n  </nav>\n);',
        el: { ...BUTTON, id: 'logo', tag: 'img' },
        want: '<img data-cd-id="logo" src="x.svg" />',
      },
      {
        name: 'text with an apostrophe and a comparison',
        src: `export default () => (
  <div>
    <a data-cd-id="book-call" href="#">
      Don't wait {n < 3 ? 'now' : 'later'}
    </a>
  </div>
);`,
        el: BUTTON,
        want: `<a data-cd-id="book-call" href="#">
  Don't wait {n < 3 ? 'now' : 'later'}
</a>`,
      },
      {
        name: 'the second of two with one id',
        src: 'export default () => (<>{a ? <li data-cd-id="row">A</li> : <li data-cd-id="row">B</li>}</>);',
        el: { ...BUTTON, id: 'row', index: 1, tag: 'li' },
        want: '<li data-cd-id="row">B</li>',
      },
    ];
  for (const f of FIXTURES) {
    test(f.name, async () => {
      source = f.src;
      const host = await fold({ selected: f.el, el: f.el });
      await click(q(host, 'adv-copy-code'));
      await act(async () => new Promise((r) => setTimeout(r, 10)));
      expect(written).toEqual([f.want]);
      expect(
        calls.some((c) => c.url === '/_api/canvas-source?canvas=.design%2Fui%2FHomepage.tsx')
      ).toBe(true);
      expect(q(host, 'adv-copy-code')?.textContent).toBe('Copied');
    });
  }

  test('an element the file does not have says so, copies nothing, and names the next step', async () => {
    source = 'export default () => (<div data-cd-id="other" />);';
    const host = await fold();
    await click(q(host, 'adv-copy-code'));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(written).toEqual([]);
    expect(q(host, 'adv-copy-code-note')?.textContent).toBe(
      "This element isn't in the file as written. Reload the canvas, then Copy code again."
    );
  });

  test('a refusal from the server shows the server’s own line', async () => {
    sourceStatus = 403;
    sourceBody = {
      error: 'read-only',
      message: "Can view doesn't include the code. Ask the owner to change this.",
    };
    const host = await fold();
    await click(q(host, 'adv-copy-code'));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(q(host, 'adv-copy-code-note')?.textContent).toContain(
      "Can view doesn't include the code"
    );
  });

  test('⌘K "Copy code" runs on the same element and says so', async () => {
    source = 'export default () => (<a data-cd-id="book-call">Go</a>);';
    await fold();
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    expect(await runInspectorAction('inspector.copy-code')).toBe('Copied the code.');
    expect(written).toEqual(['<a data-cd-id="book-call">Go</a>']);
  });
});

describe('roles: hidden is not refused (the server still says no), but the UI does not offer it', () => {
  test('Can comment: CSS is read-only, Copy CSS and Copy code stay, nothing writes', async () => {
    const host = await fold({ cfg: { ...CFG, readOnly: true, cloud: { role: 'viewer' } } });
    expect(q(host, 'adv-css-list')).not.toBeNull();
    for (const id of [
      'adv-edit-css-text',
      'adv-add-property',
      'adv-add-attribute',
      'adv-copy-style',
      'adv-paste-style',
      'adv-detach',
    ])
      expect(q(host, id), id).toBeNull();
    expect(host.querySelector('[data-tour="css-panel"]')).toBeNull(); // the raw editor writes
    expect((q(host, 'inspector-element-id') as HTMLInputElement).readOnly).toBe(true);
    expect(q(host, 'inspector-copy-css')).not.toBeNull();
    expect(q(host, 'adv-copy-code')).not.toBeNull();
  });

  test('Can view: the same, and no Copy code at all', async () => {
    const host = await fold({ cfg: { ...CFG, readOnly: true, cloud: { role: 'observer' } } });
    expect(q(host, 'inspector-copy-css')).not.toBeNull();
    expect(q(host, 'adv-copy-code')).toBeNull();
    const { runInspectorAction } = await import('../client/v2/inspector/inspector-actions.js');
    expect(await runInspectorAction('inspector.copy-code')).toBe(
      "Can view doesn't include the code. Ask the owner to change this."
    );
    expect(calls.some((c) => c.url.startsWith('/_api/canvas-source'))).toBe(false);
  });
});

describe('registry: the three code actions are real, role-gated and have an agent path', () => {
  test('inspector.copy-code needs Can comment; the other two need Can edit; each has its AI path', async () => {
    const { ACTIONS_BY_ID } = await import('../actions/index.ts');
    const { AGENT_PATHS } = await import('../actions/agents.ts');
    expect(ACTIONS_BY_ID.get('inspector.copy-code')?.enabled?.minRole).toBe('comment');
    expect(ACTIONS_BY_ID.get('inspector.edit-css-as-text')?.enabled?.minRole).toBe('edit');
    expect(ACTIONS_BY_ID.get('element.detach')?.enabled?.minRole).toBe('edit');
    for (const id of ['inspector.copy-code', 'inspector.edit-css-as-text', 'element.detach'])
      expect(AGENT_PATHS[id], id).toBeTruthy();
    expect(AGENT_PATHS['inspector.copy-code'].effect).toBe('none');
    expect(AGENT_PATHS['element.detach'].effect).toBe('project');
  });
});

describe('the new hooks are in testids.json and TESTIDS.md (testids are an API)', () => {
  const root = join(import.meta.dir, '../client');
  const entries = JSON.parse(readFileSync(join(root, 'testids.json'), 'utf8')) as Array<{
    hook: string;
  }>;
  const ids = entries.map((e) => e.hook);
  const md = readFileSync(join(root, 'TESTIDS.md'), 'utf8');
  for (const hook of [
    'adv-group-<id>',
    'adv-tag',
    'adv-classes',
    'adv-used-in',
    'adv-detach',
    'adv-css-list',
    'adv-edit-css-text',
    'adv-css-text',
    'adv-css-text-apply',
    'adv-css-text-cancel',
    'adv-css-text-error',
    'adv-add-property',
    'adv-add-attribute',
    'adv-add-<kind>-form',
    'adv-add-<kind>-apply',
    'adv-copy-style',
    'adv-paste-style',
    'adv-copy-code',
    'adv-copy-code-note',
  ]) {
    test(hook, () => {
      expect(ids).toContain(hook);
      expect(md).toContain(`\`${hook}\``);
    });
  }
});
