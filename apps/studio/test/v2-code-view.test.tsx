// S11.7 — the code view (06 `ad-code`): the canvas as code, read-only.
//
// Done when: the selected artboard's lines are marked from the server's source map; there is no way to edit
// in it; Copy / Open in editor / the fold are there (Open in editor only where an editor can open); Can view
// is never offered the code; the canvas's source is only ever drawn as text; and mono type lives only inside
// the panel's own code, path, commands and error text.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { highlight, highlightLines, splitLines } from '../client/v2/code/highlight.js';
import { fetchCanvasSource, foldCommands, rangeFor } from '../client/v2/code/use-canvas-source.js';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

const SOURCE = [
  '/** @canvas Pricing */',
  'import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";',
  '',
  'export default function Pricing() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="plans" width={1080} height={1080}>',
  '        <h1 className="big">Plans</h1>',
  '      </DCArtboard>',
  '      <DCArtboard id="faq" width={400} height={300}>',
  '        <p>Questions</p>',
  '      </DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const ARTBOARDS = {
  plans: { startLine: 7, endLine: 9 },
  faq: { startLine: 10, endLine: 12 },
  'disc-*': { startLine: 20, endLine: 24, dynamic: true },
};

const answer = (over: Record<string, unknown> = {}) => ({
  ok: true,
  canvas: '.design/ui/pricing.tsx',
  file: 'ui/pricing.tsx',
  sha: null,
  source: SOURCE,
  lines: 15,
  parsed: true,
  artboards: ARTBOARDS,
  error: null,
  ...over,
});

// ── the pure half ───────────────────────────────────────────────────────────────────────────────
describe('highlight: colour without markup', () => {
  test('lines split as an editor shows them (a trailing newline opens no line)', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines(SOURCE)).toHaveLength(15);
  });

  test('comments, strings, keywords, attributes and declared names are classed', () => {
    const rows = highlight(SOURCE);
    const classes = (i: number) => rows[i].filter((t) => t.c).map((t) => `${t.c}:${t.t}`);
    expect(classes(0)).toEqual(['com:/** @canvas Pricing */']);
    expect(classes(1)).toContain('kw:import');
    expect(classes(1)).toContain('str:"@maude/canvas-lib"');
    expect(classes(3)).toContain('kw:export');
    expect(classes(3)).toContain('fn:Pricing');
    expect(classes(6)).toContain('at:id');
    expect(classes(6)).toContain('str:"plans"');
  });

  test('a block comment and a template string carry across lines', () => {
    const rows = highlightLines(['/* one', 'two */ const x = `a', 'b`;']);
    expect(rows[0].every((t) => t.c === 'com')).toBe(true);
    expect(rows[1][0]).toEqual({ t: 'two */', c: 'com' });
    expect(rows[2][0].c).toBe('str');
  });

  test('the text of every line is kept exactly — tokens re-join to the source', () => {
    const lines = splitLines(SOURCE);
    highlightLines(lines).forEach((row, i) => {
      expect(row.map((t) => t.t).join('')).toBe(lines[i]);
    });
  });

  test('hostile source stays text: no token is markup, none is dropped', () => {
    const evil = ['<img src=x onerror="alert(1)">', '</script><script>boom()</script>'];
    const rows = highlightLines(evil);
    expect(rows.map((r) => r.map((t) => t.t).join(''))).toEqual(evil);
  });
});

describe('the source map → marked lines', () => {
  test('an artboard id gives its range; an unknown one nothing', () => {
    expect(rangeFor(ARTBOARDS, 'plans')).toEqual({ start: 7, end: 9 });
    expect(rangeFor(ARTBOARDS, 'nope')).toBeNull();
    expect(rangeFor(ARTBOARDS, null)).toBeNull();
    expect(rangeFor(null, 'plans')).toBeNull();
  });

  test('a template family (`disc-*`) marks the range for any member', () => {
    expect(rangeFor(ARTBOARDS, 'disc-3')).toEqual({ start: 20, end: 24 });
  });

  test('prototype names are not artboards', () => {
    expect(rangeFor(ARTBOARDS, '__proto__')).toBeNull();
    expect(rangeFor(ARTBOARDS, 'constructor')).toBeNull();
  });
});

describe('the commands for THIS canvas', () => {
  test('terminal and Claude Code groups; the artboard goes into screenshot', () => {
    const c = foldCommands('ui/pricing.tsx', 'plans');
    expect(c.terminal[0]).toBe('maude design screenshot --canvas "ui/pricing.tsx" --screen plans');
    expect(
      c.terminal.some((x) => x.startsWith('maude design read-annotations "ui/pricing.tsx"'))
    ).toBe(true);
    expect(c.claude.some((x) => x.startsWith('/design:edit'))).toBe(true);
    expect(c.claude.some((x) => x.startsWith('/design:critic'))).toBe(true);
  });

  test('no artboard selected: the whole canvas', () => {
    expect(foldCommands('ui/pricing.tsx', null).terminal[0]).toContain('--full');
  });

  test('a path with shell metacharacters is quoted, not run', () => {
    const [shot] = foldCommands('ui/a"b$(x).tsx', 'we ird').terminal;
    expect(shot).toContain('"ui/a\\"b\\$(x).tsx"');
    expect(shot).toContain('--screen "we ird"');
  });
});

describe('reading the source', () => {
  const json = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  test('200 → the lines, the map', async () => {
    const r = await fetchCanvasSource('ui/pricing.tsx', { fetchImpl: json(200, answer()) });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.lines).toHaveLength(15);
      expect(r.artboards.plans.startLine).toBe(7);
    }
  });

  test('403 read-only (Can view) is its own status, with the server’s words', async () => {
    const r = await fetchCanvasSource('ui/pricing.tsx', {
      fetchImpl: json(403, { error: 'read-only', reason: 'read-only', message: 'Nope.' }),
    });
    expect(r).toEqual({ status: 'view-only', message: 'Nope.' });
  });

  test('404, 413 and a network failure are told apart', async () => {
    expect((await fetchCanvasSource('x.tsx', { fetchImpl: json(404, {}) })).status).toBe('missing');
    expect((await fetchCanvasSource('x.tsx', { fetchImpl: json(413, {}) })).status).toBe(
      'too-large'
    );
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await fetchCanvasSource('x.tsx', { fetchImpl: down })).status).toBe('error');
  });
});

describe('mono only inside', () => {
  test('every rule that sets a mono family belongs to the panel’s own code, path, commands or error text', () => {
    const css = read('client/v2/code/code.css');
    const allowed = new Set([
      '.v2-code-path',
      '.v2-code-body',
      '.v2-code-cmd-t',
      '.v2-err-v',
      '.v2-err-snip',
    ]);
    const stray: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/font-family:\s*var\(--font-mono\)/.test(m[2])) continue;
      const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!allowed.has(sel)) stray.push(sel);
    }
    expect(stray).toEqual([]);
    // and the file does set it for every one of them
    for (const sel of allowed) expect(css).toContain(`${sel} {`);
  });

  test('tokens only: no hex colour, weights stop at semibold', () => {
    const css = read('client/v2/code/code.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/font-weight:\s*(7|8|9)00|font-weight:\s*bold/);
  });
});

// ── the component ───────────────────────────────────────────────────────────────────────────────
describe('<CodeView>', () => {
  const roots: Root[] = [];
  let CodeView: typeof import('../client/v2/code/code-view.jsx').CodeView;
  let mayViewCode: typeof import('../client/v2/code/code-view.jsx').mayViewCode;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ CodeView, mayViewCode } = await import('../client/v2/code/code-view.jsx'));
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  const reply = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (el: Element | null) => {
    if (!el) throw new Error('missing element');
    return act(async () => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };
  async function mount(props: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<CodeView canvas="ui/pricing.tsx" {...props} />);
    });
    // let the fetch settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return host;
  }
  const noDoors = {
    available: false,
    openInEditor: async () => ({ ok: false, reason: 'browser' }),
  };

  test('draws every line; the selected artboard’s lines — and only those — are marked', async () => {
    await mount({ fetchImpl: reply(200, answer()), artboardId: 'plans', doors: noDoors });
    const lines = document.querySelectorAll('.v2-code-line');
    expect(lines).toHaveLength(15);
    const marked = [...lines]
      .filter((l) => l.getAttribute('data-marked') === 'true')
      .map((l) => Number(l.getAttribute('data-line')));
    expect(marked).toEqual([7, 8, 9]);
    expect(q('code-view-marked')?.textContent).toContain('lines 7–9');
  });

  test('no artboard selected (or one the map does not know): nothing is marked', async () => {
    await mount({ fetchImpl: reply(200, answer()), artboardId: null, doors: noDoors });
    expect(document.querySelectorAll('[data-marked="true"]')).toHaveLength(0);
    expect(q('code-view-marked')).toBeNull();
  });

  test('read only: the lock chip says so and nothing in it can be typed into', async () => {
    await mount({ fetchImpl: reply(200, answer()), artboardId: 'plans', doors: noDoors });
    expect(q('code-view-readonly')?.textContent).toContain('Read only');
    const root = q('code-view') as HTMLElement;
    expect(root.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0);
    expect(root.querySelectorAll('[contenteditable="true"]')).toHaveLength(0);
    // the only buttons are the header's, the fold's and the commands' copies
    const labels = [...root.querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent?.trim()
    );
    expect(labels).toContain('Copy');
    expect(labels).toContain('Close code');
  });

  test('Open in editor is not drawn where no editor can open (a browser tab)', async () => {
    await mount({ fetchImpl: reply(200, answer()), doors: noDoors });
    expect(q('code-view-open-editor')).toBeNull();
    expect(q('code-view-copy')).not.toBeNull();
  });

  test('Open in editor (desktop) asks the door for the PROJECT-relative path', async () => {
    const calls: string[] = [];
    const doors = {
      available: true,
      openInEditor: async (rel: string) => {
        calls.push(rel);
        return { ok: true };
      },
    };
    await mount({ fetchImpl: reply(200, answer()), doors, designRel: '.design' });
    await click(q('code-view-open-editor'));
    expect(calls).toEqual(['.design/ui/pricing.tsx']);
    expect(q('code-view-door-error')).toBeNull();
  });

  test('a door that refuses is said in words, not swallowed', async () => {
    const doors = {
      available: true,
      openInEditor: async () => ({
        ok: false,
        reason: 'refused',
        error: 'Switch to this tab first.',
      }),
    };
    await mount({ fetchImpl: reply(200, answer()), doors });
    await click(q('code-view-open-editor'));
    expect(q('code-view-door-error')?.textContent).toBe('Switch to this tab first.');
  });

  test('Copy puts the whole source on the clipboard', async () => {
    const copied: string[] = [];
    await mount({
      fetchImpl: reply(200, answer()),
      doors: noDoors,
      onCopy: async (t: string) => {
        copied.push(t);
        return true;
      },
    });
    await click(q('code-view-copy'));
    expect(copied).toEqual([SOURCE]);
  });

  test('the fold holds the terminal and Claude Code commands for this canvas', async () => {
    await mount({ fetchImpl: reply(200, answer()), artboardId: 'plans', doors: noDoors });
    // folded by default: one quiet row, no commands drawn
    expect(q('fold-code-body')).toBeNull();
    await click(q('fold-code-toggle'));
    const body = q('fold-code-body') as HTMLElement;
    expect(body.textContent).toContain('From the terminal');
    expect(body.textContent).toContain('In Claude Code');
    expect(body.textContent).toContain(
      'maude design screenshot --canvas "ui/pricing.tsx" --screen plans'
    );
    expect(body.textContent).toContain('/design:edit');
  });

  test('close and esc both close', async () => {
    let closed = 0;
    await mount({ fetchImpl: reply(200, answer()), doors: noDoors, onClose: () => closed++ });
    await click(q('code-view-close'));
    await act(async () => {
      (q('code-view') as HTMLElement).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(closed).toBe(2);
  });

  test('Can view: the server refuses, and the panel offers no code, Copy or editor', async () => {
    await mount({
      fetchImpl: reply(403, {
        error: 'read-only',
        reason: 'read-only',
        message: "Can view doesn't include the code. Ask the owner to change this.",
      }),
      doors: { available: true, openInEditor: async () => ({ ok: true }) },
    });
    expect(q('code-view-refused')?.textContent).toContain("Can view doesn't include the code");
    expect(document.querySelectorAll('.v2-code-line')).toHaveLength(0);
    expect(q('code-view-copy')).toBeNull();
    expect(q('fold-code-toggle')).toBeNull();
  });

  test('the shell does not offer View code to Can view', () => {
    expect(mayViewCode('view')).toBe(false);
    expect(mayViewCode('viewer')).toBe(false);
    expect(mayViewCode('observer')).toBe(false);
    for (const r of ['comment', 'edit', 'owner', 'commenter', undefined]) {
      expect(mayViewCode(r as string)).toBe(true);
    }
  });

  test('hostile source is text: no element is created from it', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">\n</script><b>x</b>\n';
    await mount({
      fetchImpl: reply(200, answer({ source: evil, lines: 2, artboards: {} })),
      doors: noDoors,
    });
    const root = q('code-view') as HTMLElement;
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(q('code-view-body')?.textContent).toContain('<img src=x onerror="window.__pwned=1">');
    expect((globalThis as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  test('a very long file is cut with a way on (the editor), not rendered whole', async () => {
    const big = Array.from({ length: 5200 }, (_, i) => `// line ${i + 1}`).join('\n');
    await mount({
      fetchImpl: reply(200, answer({ source: big, lines: 5200, artboards: {} })),
      doors: noDoors,
    });
    expect(document.querySelectorAll('.v2-code-line')).toHaveLength(5000);
    expect(q('code-view-truncated')?.textContent).toContain('5000 lines of 5200');
  });
});

describe('the bus', () => {
  test('a View code request made before the Viewport mounts is delivered when it subscribes', async () => {
    const { requestViewCode, subscribeViewCode, resetCodeBusForTest } = await import(
      '../client/v2/code/code-bus.js'
    );
    resetCodeBusForTest();
    const target = new EventTarget();
    requestViewCode({ canvas: 'ui/pricing.tsx' }, target);
    const got: unknown[] = [];
    const off = subscribeViewCode((r: unknown) => got.push(r), target);
    expect(got).toEqual([{ canvas: 'ui/pricing.tsx' }]);
    requestViewCode({}, target);
    expect(got).toEqual([{ canvas: 'ui/pricing.tsx' }, { canvas: null }]);
    off();
    requestViewCode({}, target);
    expect(got).toHaveLength(2);
    resetCodeBusForTest();
  });
});
