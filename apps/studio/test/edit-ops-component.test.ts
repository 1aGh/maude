// S2.16 — `component.insert` (⇧I) through the real dispatcher: the import is added once, the instance
// is linked (`@maude/ds`, no copy), `data-ds-rev="head"` lands only on a canvas that is left out of the
// design system's current revision, one write = one undo record, and the refusals.

import { describe, expect, test } from 'bun:test';

import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { dsRevForPlacement, RECIPES } from '../edit-ops/insert-component.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { checkIds, walkIdElements } from '../element-ids.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="services" style={{ display: 'flex' }}>
          <strong data-cd-id="title">Brand systems</strong>
        </section>
        <img data-cd-id="photo" src="a.png" alt="" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial = SRC, dsRev: string | null = null) {
  const files = new Map<string, string>([[FILE, initial]]);
  const log = createWriteLog();
  let writes = 0;
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes += 1;
      files.set(rel, after);
    },
    heldByAi: () => null,
    log,
    ctx: () => ({ dsRev }),
  };
  const run = (params: Record<string, unknown>, targets: string[] = []) =>
    dispatchEditOp(
      {
        file: FILE,
        op: 'component.insert',
        targets: targets.map((element) => ({ artboard: 'desktop', element })),
        params,
      },
      deps
    );
  return { files, run, src: () => files.get(FILE) as string, writes: () => writes, log };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('the op table', () => {
  test('component.insert is registered under its registry id', () => {
    expect(EDIT_OPS.some((o) => o.id === 'component.insert')).toBe(true);
  });
});

describe('the import', () => {
  test('a first placement adds `import { Button } from "@maude/ds"` once, the instance is linked', async () => {
    const h = harness();
    const r = good(await h.run({ component: 'Button', variant: 'primary', artboard: 'desktop' }));
    const src = h.src();
    expect(count(src, "from '@maude/ds'")).toBe(1);
    expect(src).toContain("import { Button } from '@maude/ds';");
    expect(src).toContain('<Button data-cd-id="button" variant="primary">Button</Button>');
    // the instance is the LAST child of the artboard, indented like its siblings
    expect(src).toMatch(/<img data-cd-id="photo"[^\n]*\n {8}<Button /);
    expect(r.created).toEqual([{ artboard: 'desktop', element: 'button' }]);
    expect(walkIdElements(src).ok).toBe(true);
  });

  test('a second placement of the same component adds no second import', async () => {
    const h = harness();
    good(await h.run({ component: 'Button', artboard: 'desktop' }));
    good(await h.run({ component: 'Button', artboard: 'desktop' }));
    const src = h.src();
    expect(count(src, '@maude/ds')).toBe(1);
    expect(count(src, 'import { Button }')).toBe(1);
    expect(count(src, '<Button ')).toBe(2);
    expect(src).toContain('data-cd-id="button-2"');
  });

  test('a different component joins the existing @maude/ds import', async () => {
    const h = harness();
    good(await h.run({ component: 'Button', artboard: 'desktop' }));
    good(await h.run({ component: 'Chip', artboard: 'desktop' }));
    const src = h.src();
    expect(count(src, '@maude/ds')).toBe(1);
    expect(src).toContain("import { Button, Chip } from '@maude/ds';");
  });

  test('a component that brings another (Field → Input) imports both, once', async () => {
    const h = harness();
    good(await h.run({ component: 'Field', artboard: 'desktop' }));
    expect(h.src()).toContain("import { Field, Input } from '@maude/ds';");
    good(await h.run({ component: 'Input', artboard: 'desktop' }));
    expect(count(h.src(), '@maude/ds')).toBe(1);
  });

  test('the file’s own quote style is kept, double by default', async () => {
    const dbl = harness(SRC.replace(/'@maude\/canvas-lib'/, '"@maude/canvas-lib"'));
    good(await dbl.run({ component: 'Card', artboard: 'desktop' }));
    expect(dbl.src()).toContain('import { Card } from "@maude/ds";');
    const none = harness(SRC.split('\n').slice(1).join('\n'));
    good(await none.run({ component: 'Card', artboard: 'desktop' }));
    expect(none.src().startsWith('import { Card } from "@maude/ds";\n')).toBe(true);
  });

  test('a canvas that binds the name itself is refused, nothing written', async () => {
    const h = harness(SRC.replace('export default', 'const Button = () => null;\nexport default'));
    const r = bad(await h.run({ component: 'Button', artboard: 'desktop' }));
    expect(r.code).toBe('invalid');
    expect(r.message).toContain('already has its own Button');
    expect(h.writes()).toBe(0);
  });
});

describe('data-ds-rev', () => {
  test('a canvas left out of the current revision: the new instance arrives current', async () => {
    const h = harness(SRC, 'a1b2c3');
    good(await h.run({ component: 'Button', artboard: 'desktop' }));
    expect(h.src()).toContain('<Button data-cd-id="button" data-ds-rev="head">');
  });

  test('a canvas that follows the system gets no data-ds-rev', async () => {
    const h = harness(SRC, null);
    good(await h.run({ component: 'Button', artboard: 'desktop' }));
    expect(h.src()).not.toContain('data-ds-rev');
  });

  test('the request cannot ask for it: a data-ds-rev param is ignored on a following canvas', async () => {
    const h = harness();
    good(
      await h.run({
        component: 'Button',
        artboard: 'desktop',
        dsRev: 'head',
        'data-ds-rev': 'head',
      })
    );
    expect(h.src()).not.toContain('data-ds-rev');
  });

  test('dsRevForPlacement reads the meta, and only a set dsRev', () => {
    expect(dsRevForPlacement({ dsRev: 'abc' })).toBe('head');
    expect(dsRevForPlacement({ dsRev: '' })).toBeNull();
    expect(dsRevForPlacement({})).toBeNull();
    expect(dsRevForPlacement(null)).toBeNull();
  });

  test('a component that does not forward attributes carries it on its wrapper', async () => {
    const h = harness(SRC, 'a1b2c3');
    good(await h.run({ component: 'Switch', artboard: 'desktop' }));
    expect(h.src()).toContain(
      '<div data-cd-id="switch" data-ds-rev="head"><Switch checked={false} label="Switch" /></div>'
    );
  });
});

describe('where it goes', () => {
  test('into the selected frame, after its last child, in the flow', async () => {
    const h = harness();
    const r = good(
      await h.run({ component: 'Badge', variant: 'success', text: 'New' }, ['services'])
    );
    expect(h.src()).toMatch(
      /<strong data-cd-id="title">Brand systems<\/strong>\n {10}<Badge data-cd-id="new" variant="success">New<\/Badge>\n {8}<\/section>/
    );
    expect(r.created).toEqual([{ artboard: 'desktop', element: 'new' }]);
  });

  test('free placement writes position, snapped to the centre as 50% + translate', async () => {
    const h = harness();
    good(await h.run({ component: 'Button', artboard: 'desktop', at: { x: 'centre', y: 412.4 } }));
    expect(h.src()).toContain(
      "style={{ position: 'absolute', left: '50%', top: 412, transform: 'translateX(-50%)' }}"
    );
    good(await h.run({ component: 'Chip', artboard: 'desktop', at: { x: 64.6, y: 10 } }));
    expect(h.src()).toContain("style={{ position: 'absolute', left: 65, top: 10 }}");
  });

  test('a frame that cannot hold anything is refused in plain words', async () => {
    const h = harness();
    const r = bad(await h.run({ component: 'Button' }, ['photo']));
    expect(r.message).toBe('That object cannot hold anything; select a frame.');
    expect(h.writes()).toBe(0);
  });

  test('no frame and no artboard: asks for one', async () => {
    const h = harness();
    expect(bad(await h.run({ component: 'Button' })).message).toContain('Select a frame');
  });

  test('ids stay valid and unique after several placements', async () => {
    const h = harness();
    for (const c of ['Button', 'Button', 'Chip', 'Icon', 'Logo'])
      good(await h.run({ component: c, artboard: 'desktop' }));
    const c = checkIds(h.src());
    expect(c.parseError).toBeUndefined();
    expect(c.findings.filter((f) => f.code.includes('duplicate'))).toEqual([]);
  });
});

describe('one placement, one undo step', () => {
  test('one request is one write, and its writeId reverts the file whole (import included)', async () => {
    const h = harness();
    const r = good(await h.run({ component: 'Button', artboard: 'desktop' }));
    expect(h.writes()).toBe(1);
    expect(h.src()).not.toBe(SRC);
    const undo = good(
      await dispatchEditOp(
        { file: FILE, op: 'revert', targets: [], params: { writeId: r.writeId } },
        {
          resolve: (f) => f,
          read: (rel) => h.files.get(rel) ?? null,
          write: async (rel, _b, after) => void h.files.set(rel, after),
          heldByAi: () => null,
          log: h.log,
        }
      )
    );
    expect(undo.ok).toBe(true);
    expect(h.src()).toBe(SRC);
  });
});

describe('refusals', () => {
  test.each([
    [{ component: 'script', artboard: 'desktop' }],
    [{ component: 'Button<script>', artboard: 'desktop' }],
    [{ component: 'NotInTheSystem', artboard: 'desktop' }],
    [{ component: 'Button', variant: 'x"y', artboard: 'desktop' }],
    [{ component: 'Input', variant: 'primary', artboard: 'desktop' }],
    [{ component: 'Button', text: 'a\nb', artboard: 'desktop' }],
    [{ component: 'Icon', glyph: 'a"b', artboard: 'desktop' }],
    [{ component: 'Button', artboard: 'desktop', at: { x: 'left', y: 1 } }],
    [{ component: 'Button', artboard: '../x' }],
    [{}],
  ])('%j is refused and nothing is written', async (params) => {
    const h = harness();
    expect(bad(await h.run(params)).code).toBe('invalid');
    expect(h.writes()).toBe(0);
  });

  test('words that look like JSX cannot break out of the element', async () => {
    const h = harness();
    good(
      await h.run({
        component: 'Button',
        text: '</Button><script>x</script>{}',
        artboard: 'desktop',
      })
    );
    expect(h.src()).toContain('{"</Button><script>x</script>{}"}');
    expect(walkIdElements(h.src()).ok).toBe(true);
  });

  test('a locked frame refuses (the dispatcher, before the writer)', async () => {
    const h = harness(SRC.replace('data-cd-id="services"', 'data-cd-id="services" data-cd-locked'));
    expect(bad(await h.run({ component: 'Button' }, ['services'])).code).toBe('locked');
  });

  test('every recipe names a component the writer can render', async () => {
    for (const name of Object.keys(RECIPES)) {
      const h = harness();
      good(await h.run({ component: name, artboard: 'desktop' }));
      expect(walkIdElements(h.src()).ok).toBe(true);
    }
  });
});
