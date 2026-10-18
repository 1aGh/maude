// S3.11 — the Inspect panel (04 Modes · md-inspect), rendered. Real markup; only fetch, the clipboard and the
// shell's export entry are faked. Rows come from one fixture element; Can view gets no code and no edit.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
let source = '';
let sourceStatus = 200;
let sourceBody: Record<string, unknown> | null = null;
const fetched: string[] = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    fetched.push(String(url));
    return new Response(JSON.stringify(sourceBody ?? { ok: true, source }), {
      status: sourceStatus,
    });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
const written: string[] = [];
beforeEach(() => {
  fetched.length = 0;
  written.length = 0;
  sourceStatus = 200;
  sourceBody = null;
  source =
    'export default function C() {\n  return <button data-cd-id="book-a-call" className="cta">Book a call</button>;\n}\n';
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (t: string) => void written.push(t) },
    configurable: true,
  });
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  return host;
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (el: HTMLElement | null) => {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const el = {
  id: 'book-a-call',
  index: 0,
  tag: 'button',
  text: 'Book a call',
  worldW: 150,
  worldH: 48,
  neighbour: { name: 'About', gap: 48, side: 'left' },
  authored: { 'background-color': 'var(--ink)', color: 'var(--paper)', padding: '12px 24px' },
  computed: {
    'background-color': 'rgb(17, 17, 17)',
    color: 'rgb(250, 249, 246)',
    'padding-top': '12px',
    'padding-right': '24px',
    'padding-bottom': '12px',
    'padding-left': '24px',
    'border-top-left-radius': '999px',
    'font-family': '"SF Pro Text", sans-serif',
    'font-size': '19px',
    'font-weight': '600',
  },
};

async function panel(props: Record<string, unknown> = {}) {
  const { InspectPanel } = await import('../client/v2/inspect/inspect-panel.jsx');
  const calls: Array<[string, unknown]> = [];
  await mount(
    <InspectPanel
      selected={el}
      canvasFile=".design/ui/home.tsx"
      access={{ readOnly: true, canEdit: false, canCode: true }}
      onExport={(a: unknown) => calls.push(['export', a])}
      onEdit={() => calls.push(['edit', null])}
      {...props}
    />
  );
  return calls;
}

describe('the rows, from the fixture element', () => {
  test('name + kind chip, Size and spacing, Colour and type, Export, the two actions, Advanced', async () => {
    await panel();
    expect(q('inspect-panel')).not.toBeNull();
    expect(q('inspect-name')?.textContent).toBe('Book a call');
    expect(q('inspect-kind')?.textContent).toBe('Button');
    const text = q('inspect-panel')?.textContent ?? '';
    for (const w of [
      'Size and spacing',
      '150 × 48',
      'Padding',
      '12 · 24',
      'Corners',
      'Round',
      'Gap to About',
      'Colour and type',
      'Ink',
      'SF Pro Text · 19 · Semibold',
      'Paper',
      'Export',
      'PNG 1×',
      'PNG 2×',
      'SVG',
      'Handoff…',
      'Copy code',
    ])
      expect(text).toContain(w);
    expect(q('inspect-advanced')).not.toBeNull();
  });

  test('Advanced CSS opens on the authored declarations', async () => {
    await panel();
    await click(q('fold-inspect-toggle'));
    expect(q('fold-inspect-body')?.textContent).toContain('background-color');
    expect(q('fold-inspect-body')?.textContent).toContain('var(--ink)');
  });
});

describe('the actions', () => {
  test('Export buttons go to the shell sheet with what they asked for', async () => {
    const calls = await panel();
    await click(q('inspect-export-png-1x'));
    await click(q('inspect-export-png-2x'));
    await click(q('inspect-export-svg'));
    await click(q('inspect-export-handoff'));
    expect(calls).toEqual([
      ['export', { mode: 'export', scope: 'selection', format: 'png', scale: 1 }],
      ['export', { mode: 'export', scope: 'selection', format: 'png', scale: 2 }],
      ['export', { mode: 'export', scope: 'selection', format: 'svg' }],
      ['export', { mode: 'handoff', scope: 'selection' }],
    ]);
  });

  test('Copy code copies the element’s JSX through the canvas-source slice', async () => {
    await panel();
    await click(q('inspect-copy-code'));
    await act(async () => {});
    expect(fetched[0]).toContain('/_api/canvas-source?canvas=');
    expect(written[0]).toContain('data-cd-id="book-a-call"');
    expect(written[0]).toContain('Book a call');
  });

  test('Edit ↵ asks for Edit', async () => {
    const calls = await panel({ access: { readOnly: false, canEdit: true, canCode: true } });
    expect(q('inspect-edit')?.textContent).toContain('Edit');
    await click(q('inspect-edit'));
    expect(calls).toEqual([['edit', null]]);
  });
});

describe('roles', () => {
  test('Can comment: code yes, Edit no', async () => {
    await panel();
    expect(q('inspect-copy-code')).not.toBeNull();
    expect(q('inspect-edit')).toBeNull();
  });

  test('Can view: no Copy code, no Edit; every other row is there and reads', async () => {
    await panel({ access: { readOnly: true, canEdit: false, canCode: false } });
    expect(q('inspect-copy-code')).toBeNull();
    expect(q('inspect-edit')).toBeNull();
    expect(q('inspect-panel')?.textContent).toContain('150 × 48');
    expect(q('inspect-export-png-2x')).not.toBeNull();
    // Advanced CSS reads the live element's styles, not the file: it stays (S11.8's CSS group is for every role)
    expect(q('inspect-advanced')).not.toBeNull();
  });

  test('no editing control anywhere in the panel, for any role (inputs, textareas, selects)', async () => {
    for (const access of [
      { readOnly: true, canEdit: false, canCode: false },
      { readOnly: true, canEdit: false, canCode: true },
    ]) {
      await panel({ access });
      expect(document.querySelectorAll('input, textarea, select, [contenteditable]').length).toBe(
        0
      );
      await act(async () => roots.pop()?.unmount());
      document.body.innerHTML = '';
    }
  });

  test('Copy code on a refused source says the server’s line and copies nothing', async () => {
    sourceStatus = 403;
    sourceBody = {
      error: 'read-only',
      message: "Can view doesn't include the code. Ask the owner to change this.",
    };
    await panel();
    await click(q('inspect-copy-code'));
    await act(async () => {});
    expect(written.length).toBe(0);
    expect(q('inspect-copy-code-note')?.textContent).toContain("doesn't include the code");
  });
});

describe('nothing selected', () => {
  test('renders nothing', async () => {
    await panel({ selected: null });
    expect(q('inspect-panel')).toBeNull();
  });
});

describe('the new hooks are in testids.json and TESTIDS.md (testids are an API)', () => {
  const root = join(import.meta.dir, '../client');
  const ids = (
    JSON.parse(readFileSync(join(root, 'testids.json'), 'utf8')) as Array<{ hook: string }>
  ).map((e) => e.hook);
  const md = readFileSync(join(root, 'TESTIDS.md'), 'utf8');
  for (const hook of [
    'inspect-panel',
    'inspect-name',
    'inspect-kind',
    'inspect-export-<id>',
    'inspect-copy-code',
    'inspect-copy-code-note',
    'inspect-edit',
    'inspect-advanced',
    '.dc-cv-inspect-tag',
  ]) {
    test(hook, () => {
      expect(ids).toContain(hook);
      expect(md).toContain(`\`${hook}\``);
    });
  }
});

describe('the host reads one element out of a selection', () => {
  test('a single stamped element; none for several, an artboard or nothing', async () => {
    const { inspectedElement } = await import('../client/v2/inspect/inspect-host.jsx');
    expect(inspectedElement(el)?.id).toBe('book-a-call');
    expect(inspectedElement([el])?.id).toBe('book-a-call');
    expect(inspectedElement([el, el])).toBeNull();
    expect(inspectedElement({ selector: '[data-dc-screen="a"]', artboardId: 'a' })).toBeNull();
    expect(inspectedElement(null)).toBeNull();
  });
});
