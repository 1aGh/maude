// S2.17 — `component.detach`. The promise is "a plain frame with the identical look": every component the
// system ships is placed (⇧I), measured by the canvas (`measureInstance`), detached through the real
// dispatcher, and the plain markup it became is RENDERED and compared with what the instance rendered —
// render diff = 0. The tree comes from an untrusted canvas, so the printer's refusals are pinned too, and a
// local component's usage still takes the clone-the-definition detach.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import * as DS from '../ds/default-components.tsx';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { RECIPES } from '../edit-ops/insert-component.ts';
import { sanitizeTree, TreeRefusal } from '../edit-ops/instance-tree.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { measureInstance } from '../editing/instance-actions.ts';
import { walkIdElements } from '../element-ids.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const FILE = 'ui/Home.tsx';
const BASE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="frame" style={{ display: 'flex' }}>
          <strong data-cd-id="title">Brand systems</strong>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial = BASE) {
  const files = new Map<string, string>([[FILE, initial]]);
  let writes = 0;
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes += 1;
      files.set(rel, after);
    },
    heldByAi: () => null,
    log: createWriteLog(),
    ctx: () => ({ dsRev: null }),
  };
  const run = (op: string, element: string, params: Record<string, unknown> = {}) =>
    dispatchEditOp(
      { file: FILE, op, targets: element ? [{ artboard: 'desktop', element }] : [], params },
      deps
    );
  return { files, run, src: () => files.get(FILE) as string, writes: () => writes };
}
const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};

// ── render both and compare ───────────────────────────────────────────────────────────────────

const transpiler = new Bun.Transpiler({
  loader: 'tsx',
  tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react' } }),
});
const scope = { React, ...DS };
/** The JSX at `[start, end)` of a canvas, rendered with the system's components in scope. */
function renderJsx(jsx: string): string {
  const js = transpiler
    .transformSync(`const __r = (${jsx});`)
    .trim()
    .replace(/^const __r = /, '')
    .replace(/;$/, '');
  const names = Object.keys(scope);
  const fn = new Function(...names, `return ${js}`);
  return renderToStaticMarkup(fn(...Object.values(scope)));
}
const jsxOf = (src: string, id: string): string => {
  const walk = walkIdElements(src, FILE);
  if (!walk.ok) throw new Error(walk.error);
  const el = walk.elements.find((e) => e.id === id);
  if (!el) throw new Error(`no ${id}`);
  return src.slice(el.start, el.end);
};
/** A canonical form of rendered markup: attributes sorted, whitespace-only text between tags kept. */
function canon(html: string): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  const one = (n: Node): string => {
    if (n.nodeType === 3) return JSON.stringify(n.textContent);
    const e = n as Element;
    const attrs = Array.from(e.attributes)
      .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
      .sort()
      .join(' ');
    return `<${e.localName} ${attrs}>${Array.from(e.childNodes).map(one).join('')}</${e.localName}>`;
  };
  return Array.from(box.childNodes).map(one).join('');
}

/** Place `jsx` (an instance with an id) in the canvas, detach it as the canvas would, hand back both renders. */
async function detachRoundTrip(instanceJsx: string, id: string) {
  // import what the sample uses (and nothing else): the import must be gone once it is plain
  const used = Object.keys(RECIPES).filter((n) => new RegExp(`<${n}[\\s>/]`).test(instanceJsx));
  const src = BASE.replace('        <section', `        ${instanceJsx}\n        <section`).replace(
    'import { DCArtboard',
    `import { ${used.join(', ')} } from '@maude/ds';\nimport { DCArtboard`
  );
  const h = harness(src);
  const before = renderJsx(jsxOf(src, id));
  const box = document.createElement('div');
  box.innerHTML = before;
  const root = box.firstElementChild as Element;
  const r = good(await h.run('component.detach', id, { tree: measureInstance(root), rendered: 1 }));
  const after = renderJsx(jsxOf(h.src(), id));
  return { h, before, after, r };
}

const SAMPLES: Array<[string, string]> = [
  [
    'Button',
    '<Button data-cd-id="x" variant="primary" style={{ background: "var(--accent)", position: "absolute", left: 12, top: 8 }}>Book a call</Button>',
  ],
  ['Button plain', '<Button data-cd-id="x">Go</Button>'],
  [
    'IconButton',
    '<IconButton data-cd-id="x" variant="ghost" label="Add"><Icon name="add" /></IconButton>',
  ],
  ['Input', '<Input data-cd-id="x" placeholder="Your e-mail" />'],
  ['Checkbox', '<Checkbox data-cd-id="x" />'],
  ['Chip', '<Chip data-cd-id="x" variant="soft">Nový</Chip>'],
  ['Badge', '<Badge data-cd-id="x" variant="success">OK</Badge>'],
  ['Card', '<Card data-cd-id="x" variant="raised">Words & more</Card>'],
  ['Callout', '<Callout data-cd-id="x" variant="warn">Careful</Callout>'],
  ['Field (wrapper)', '<div data-cd-id="x"><Field label="Name"><Input /></Field></div>'],
  ['Switch (wrapper)', '<div data-cd-id="x"><Switch checked={false} label="Dark" /></div>'],
  [
    'Segmented (wrapper)',
    '<div data-cd-id="x"><Segmented items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} value="a" /></div>',
  ],
  [
    'Tabs (wrapper)',
    '<div data-cd-id="x"><Tabs items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} value="a" /></div>',
  ],
  ['Dialog (wrapper)', '<div data-cd-id="x"><Dialog title="Hi">Body</Dialog></div>'],
  ['Tooltip (wrapper)', '<div data-cd-id="x"><Tooltip>Hint</Tooltip></div>'],
  ['Logo (wrapper)', '<div data-cd-id="x"><Logo variant="mark" /></div>'],
  ['Icon (wrapper)', '<div data-cd-id="x"><Icon name="star" size={24} /></div>'],
  [
    'Button with nested authored id',
    '<Button data-cd-id="x" variant="primary"><span data-cd-id="inner">Hi</span> there</Button>',
  ],
];

describe('detach: the identical look (render diff = 0)', () => {
  for (const [name, jsx] of SAMPLES) {
    test(name, async () => {
      const { before, after, h } = await detachRoundTrip(jsx, 'x');
      expect(canon(after)).toBe(canon(before));
      // it is a plain element now: nothing from @maude/ds is left on the line, and the import went with it
      const line = jsxOf(h.src(), 'x');
      for (const n of Object.keys(RECIPES)) expect(line).not.toMatch(new RegExp(`<${n}[\\s>/]`));
      expect(h.src()).not.toContain("from '@maude/ds'");
      expect(walkIdElements(h.src(), FILE).ok).toBe(true);
      expect(h.writes()).toBe(1);
    });
  }
});

describe('detach: what is written', () => {
  test('keeps the id, the classes and the authored token references; px never appear', async () => {
    const { h } = await detachRoundTrip(
      '<Button data-cd-id="x" variant="primary" style={{ background: "var(--accent)" }}>Book</Button>',
      'x'
    );
    const out = jsxOf(h.src(), 'x');
    expect(out).toContain('data-cd-id="x"');
    expect(out).toContain('className="btn btn--primary"');
    expect(out).toContain('background: "var(--accent)"');
    expect(out).not.toMatch(/\d+px/);
    expect(out).not.toContain('data-ds-rev');
  });
  test('another instance of the same component keeps its import', async () => {
    const src = BASE.replace(
      '        <section',
      '        <Button data-cd-id="x">A</Button>\n        <Button data-cd-id="y">B</Button>\n        <section'
    ).replace('import { DCArtboard', "import { Button } from '@maude/ds';\nimport { DCArtboard");
    const h = harness(src);
    const box = document.createElement('div');
    box.innerHTML = renderJsx(jsxOf(src, 'x'));
    good(
      await h.run('component.detach', 'x', {
        tree: measureInstance(box.firstElementChild as Element),
        rendered: 1,
      })
    );
    expect(h.src()).toContain("import { Button } from '@maude/ds';");
    expect(h.src()).toContain('<Button data-cd-id="y">B</Button>');
  });
  test('a repeat is refused, so the other places do not change', async () => {
    const src = BASE.replace(
      '        <section',
      '        {["a", "b"].map((t) => <Button key={t} data-cd-id="x">{t}</Button>)}\n        <section'
    ).replace('import { DCArtboard', "import { Button } from '@maude/ds';\nimport { DCArtboard");
    const h = harness(src);
    const tree = { tag: 'button', attrs: { class: 'btn' }, kids: ['a'] };
    expect(bad(await h.run('component.detach', 'x', { tree, rendered: 1 })).message).toContain(
      'repeats'
    );
    // and the canvas saw two nodes with that id
    const h2 = harness(
      src.replace(
        '{["a", "b"].map((t) => <Button key={t} data-cd-id="x">{t}</Button>)}',
        '<Button data-cd-id="x">a</Button>'
      )
    );
    expect(bad(await h2.run('component.detach', 'x', { tree, rendered: 2 })).message).toContain(
      'repeats'
    );
    expect(h.src()).toBe(src);
  });
  test('a frame that is not an instance and not in a component is refused', async () => {
    const h = harness();
    expect(
      bad(await h.run('component.detach', 'frame', { tree: { tag: 'div', attrs: {}, kids: [] } }))
        .message
    ).toBe('This is not an instance of a component.');
  });
  test('an instance with no measured tree is refused', async () => {
    const src = BASE.replace(
      '        <section',
      '        <Button data-cd-id="x">A</Button>\n        <section'
    ).replace('import { DCArtboard', "import { Button } from '@maude/ds';\nimport { DCArtboard");
    const h = harness(src);
    expect(bad(await h.run('component.detach', 'x', {})).message).toContain('did not say');
    expect(h.src()).toBe(src);
  });
});

describe('detach: a local component keeps the clone-the-definition detach', () => {
  const LOCAL = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
function Card() {
  return <div data-cd-id="card-root"><p data-cd-id="card-text">Hi</p></div>;
}
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <Card data-cd-id="c1" />
        <Card data-cd-id="c2" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
  test('one usage is repointed at its own copy', async () => {
    const h = harness(LOCAL);
    const r = await dispatchEditOp(
      {
        file: FILE,
        op: 'component.detach',
        targets: [{ artboard: 'desktop', element: 'card-root', occurrence: 1 }],
        params: {},
      },
      // reuse the harness deps by running through its run with an occurrence
      {
        resolve: (f) => (f === FILE ? FILE : null),
        read: () => h.src(),
        write: async (_r, _b, after) => {
          h.files.set(FILE, after);
        },
        heldByAi: () => null,
        log: createWriteLog(),
      }
    );
    good(r);
    expect(h.src()).toContain('function CardDetached()');
    expect(h.src()).toMatch(/<Card data-cd-id="c1" \/>\s*<CardDetached data-cd-id="c2" \/>/);
  });
});

describe('the measured tree is untrusted', () => {
  const ok = (raw: unknown) => sanitizeTree(raw, 'x');
  const node = (tag: string, attrs: Record<string, string> = {}, kids: unknown[] = []) => ({
    tag,
    attrs,
    kids,
  });
  test('only known tags: a <script> or an <iframe> refuses the whole detach', () => {
    expect(() => ok(node('script'))).toThrow(TreeRefusal);
    expect(() => ok(node('div', {}, [node('iframe')]))).toThrow(TreeRefusal);
  });
  test('handlers, javascript: links and unknown attributes are dropped', () => {
    const t = ok(
      node('a', {
        href: 'javascript:alert(1)',
        onclick: 'x()',
        class: 'link',
        'data-evil': '1',
        title: 'T',
      })
    );
    expect(t.attrs).toEqual({ class: 'link', title: 'T', 'data-cd-id': 'x' });
  });
  test('a style that is not a declaration, or names a bad url, refuses', () => {
    expect(() => ok(node('div', { style: 'color: red; }; x{' }))).toThrow(TreeRefusal);
    expect(() => ok(node('div', { style: 'background: url(javascript:alert(1))' }))).toThrow(
      TreeRefusal
    );
    expect(() => ok(node('div', { style: 'width: expression(alert(1))' }))).toThrow(TreeRefusal);
    expect(ok(node('div', { style: 'background: var(--accent); --gap: 4px' })).attrs.style).toBe(
      'background: var(--accent); --gap: 4px'
    );
  });
  test('the root keeps the instance’s id whatever the canvas says; nested ids must be ids', () => {
    expect(ok(node('div', { 'data-cd-id': 'other' })).attrs['data-cd-id']).toBe('x');
    expect(ok(node('div', {}, [node('span', { 'data-cd-id': 'Bad Id' })])).kids[0]).toMatchObject({
      attrs: {},
    });
  });
  test('depth and size are bounded', () => {
    let deep: unknown = node('div');
    for (let i = 0; i < 20; i++) deep = node('div', {}, [deep]);
    expect(() => ok(deep)).toThrow(TreeRefusal);
    expect(() =>
      ok(
        node(
          'div',
          {},
          Array.from({ length: 300 }, () => node('span'))
        )
      )
    ).toThrow(TreeRefusal);
  });
  test('words are printed as text, never as code', async () => {
    const src = BASE.replace(
      '        <section',
      '        <Button data-cd-id="x">A</Button>\n        <section'
    ).replace('import { DCArtboard', "import { Button } from '@maude/ds';\nimport { DCArtboard");
    const h = harness(src);
    good(
      await h.run('component.detach', 'x', {
        tree: node('button', { class: 'btn' }, ['</button>{alert(1)}<x']),
        rendered: 1,
      })
    );
    expect(h.src()).toContain('{"</button>{alert(1)}<x"}');
    expect(walkIdElements(h.src(), FILE).ok).toBe(true);
  });
});
