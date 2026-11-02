// S2.17 — `component.swap-variant` and `component.reset` through the real dispatcher: a swap keeps the
// words and the overrides, a variant the system does not have is refused (the server's reading of the
// system, not the request's), Reset takes back only the overrides (placement, variant, id stay), one
// request = one write.

import { describe, expect, test } from 'bun:test';

import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { overridesOf, readInstance, swappableWith } from '../edit-ops/instance-model.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { walkIdElements } from '../element-ids.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
import { Button, Chip, Logo } from '@maude/ds';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <Button data-cd-id="cta" variant="primary" style={{ position: 'absolute', left: 10, top: 20, background: 'var(--accent)', color: 'var(--on-accent)' }}>REGISTRUJ SE</Button>
        <Chip data-cd-id="tag" variant="soft">Chip</Chip>
        <div data-cd-id="mark"><Logo variant="mark" /></div>
        <section data-cd-id="plain" style={{ display: 'flex' }}>
          <strong data-cd-id="title">Brand systems</strong>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const MANIFEST: Record<string, string[]> = {
  Button: ['primary', 'outline'],
  Chip: ['accent', 'soft'],
  Badge: ['success', 'warn'],
};

function harness(initial = SRC) {
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
    ctx: () => ({ dsRev: null, variantsOf: (n) => MANIFEST[n] ?? null }),
  };
  const run = (op: string, element: string, params: Record<string, unknown> = {}) =>
    dispatchEditOp({ file: FILE, op, targets: [{ artboard: 'desktop', element }], params }, deps);
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

describe('the op table', () => {
  test('the three instance ops are registered under their registry ids', () => {
    for (const id of ['component.swap-variant', 'component.reset', 'component.detach'])
      expect(EDIT_OPS.some((o) => o.id === id)).toBe(true);
  });
});

describe('reading an instance', () => {
  test('a linked instance, its variant, words and overrides', () => {
    const f = readInstance(SRC, FILE, 'cta');
    expect(f?.component).toBe('Button');
    expect(f?.variant).toBe('primary');
    expect(f?.text).toBe('REGISTRUJ SE');
    const o = overridesOf(f as NonNullable<typeof f>);
    // the words and the two paint declarations; where it sits is not a change
    expect(o).toEqual({ text: true, fill: true, props: ['background', 'color'], count: 3 });
  });
  test('the words the master gave are not a change', () => {
    const f = readInstance(SRC, FILE, 'tag');
    expect(overridesOf(f as NonNullable<typeof f>).count).toBe(0);
  });
  test('a component that cannot forward its props sits in a div that carries the id', () => {
    const f = readInstance(SRC, FILE, 'mark');
    expect(f?.component).toBe('Logo');
    expect(f?.wrapper).toBe(true);
  });
  test('a frame and a name the canvas does not import from @maude/ds are not instances', () => {
    expect(readInstance(SRC, FILE, 'plain')).toBeNull();
    expect(
      readInstance(SRC.replace('{ Button, Chip, Logo }', '{ Chip, Logo }'), FILE, 'cta')
    ).toBeNull();
  });
  test('swappable: the components that hold words and forward their props', () => {
    expect(swappableWith('Button')).toEqual(['Button', 'Chip', 'Badge', 'Card', 'Callout']);
    expect(swappableWith('Logo')).toEqual(['Logo']);
  });
});

describe('component.swap-variant — the variant', () => {
  test('wears another variant; the words and the overrides come along, one write', async () => {
    const h = harness();
    const r = good(await h.run('component.swap-variant', 'cta', { variant: 'outline' }));
    expect(r.refs).toEqual([{ artboard: 'desktop', element: 'cta' }]);
    expect(h.writes()).toBe(1);
    const out = h.src();
    expect(out).toContain('variant="outline"');
    expect(out).not.toContain('variant="primary"');
    expect(out).toContain('>REGISTRUJ SE</Button>');
    expect(out).toContain("background: 'var(--accent)'");
    expect(out).toContain("position: 'absolute'");
    expect(walkIdElements(out, FILE).ok).toBe(true);
  });
  test('null is the master’s own look: the attribute goes', async () => {
    const h = harness();
    good(await h.run('component.swap-variant', 'cta', { variant: null }));
    expect(h.src()).toContain('<Button data-cd-id="cta" style=');
    expect(h.src()).not.toContain('variant="primary"><');
  });
  test('adds the attribute when there was none', async () => {
    const h = harness(SRC.replace(' variant="primary"', ''));
    good(await h.run('component.swap-variant', 'cta', { variant: 'outline' }));
    expect(h.src()).toContain('<Button variant="outline" data-cd-id="cta"');
  });
  test('a variant the system does not have is refused, whatever the request says', async () => {
    const h = harness();
    const r = bad(await h.run('component.swap-variant', 'cta', { variant: 'danger' }));
    expect(r.code).toBe('invalid');
    expect(r.message).toBe('That variant is not one this component has.');
    expect(h.writes()).toBe(0);
  });
  test('a malformed variant never reaches the file', async () => {
    const h = harness();
    for (const v of ['x" onClick="1', '"><script>', 3, {}])
      bad(await h.run('component.swap-variant', 'cta', { variant: v }));
    expect(h.src()).toBe(SRC);
  });
  test('a variant set in code is the file’s, not ours', async () => {
    const h = harness(SRC.replace('variant="primary"', 'variant={v}'));
    const r = bad(await h.run('component.swap-variant', 'cta', { variant: 'outline' }));
    expect(r.message).toContain('sets its variant in code');
  });
  test('a frame is not an instance', async () => {
    const h = harness();
    const r = bad(await h.run('component.swap-variant', 'plain', { variant: 'outline' }));
    expect(r.message).toBe('This is not an instance of a component.');
  });
  test('without a variant or a component there is nothing to do', async () => {
    const h = harness();
    expect(bad(await h.run('component.swap-variant', 'cta', {})).code).toBe('invalid');
  });
});

describe('component.swap-variant — the component', () => {
  test('swaps the tag, imports the new name, drops the old import, keeps words and style', async () => {
    const h = harness();
    const r = good(await h.run('component.swap-variant', 'cta', { component: 'Badge' }));
    const out = h.src();
    expect(out).toContain('<Badge data-cd-id="cta"');
    expect(out).toContain('>REGISTRUJ SE</Badge>');
    expect(out).toContain("background: 'var(--accent)'");
    // Button is not used any more; Chip still is; Badge came in once
    const imp = /import \{([^}]*)\} from '@maude\/ds';/.exec(out)?.[1] ?? '';
    expect(
      imp
        .split(',')
        .map((x) => x.trim())
        .sort()
    ).toEqual(['Badge', 'Chip', 'Logo']);
    expect(out.match(/@maude\/ds/g)?.length).toBe(1);
    // `primary` is not a Badge variant: dropped, and the answer says so
    expect(out).not.toContain('variant="primary"');
    expect(r.detail).toEqual({ droppedVariant: 'primary' });
  });
  test('the old import stays while another instance still uses it', async () => {
    const h = harness(
      SRC.replace('<Chip data-cd-id="tag"', '<Button data-cd-id="tag"').replace(
        '>Chip</Chip>',
        '>Chip</Button>'
      )
    );
    good(await h.run('component.swap-variant', 'cta', { component: 'Chip' }));
    expect(h.src()).toContain("import { Button, Chip, Logo } from '@maude/ds';");
  });
  test('a variant that both have survives; a new one is checked against the NEW component', async () => {
    const h = harness();
    good(await h.run('component.swap-variant', 'tag', { component: 'Button', variant: 'primary' }));
    expect(h.src()).toContain('<Button data-cd-id="tag" variant="primary">Chip</Button>');
    const h2 = harness();
    bad(await h2.run('component.swap-variant', 'tag', { component: 'Badge', variant: 'accent' }));
  });
  test('components of another shape are refused: they hold different things', async () => {
    const h = harness();
    expect(
      bad(await h.run('component.swap-variant', 'cta', { component: 'Input' })).message
    ).toContain('hold different things');
    expect(bad(await h.run('component.swap-variant', 'mark', { component: 'Button' })).code).toBe(
      'invalid'
    );
    expect(bad(await h.run('component.swap-variant', 'cta', { component: 'Evil' })).code).toBe(
      'invalid'
    );
    expect(h.src()).toBe(SRC);
  });
  test('a canvas that has its own component of that name is not shadowed', async () => {
    const h = harness(
      SRC.replace(
        'export default function Home',
        'function Badge() { return null; }\nexport default function Home'
      )
    );
    expect(
      bad(await h.run('component.swap-variant', 'cta', { component: 'Badge' })).message
    ).toContain('its own Badge');
  });
});

describe('component.reset', () => {
  test('takes back the words and the paint; where it sits, its variant and its id stay', async () => {
    const h = harness();
    good(await h.run('component.reset', 'cta'));
    expect(h.writes()).toBe(1);
    const out = h.src();
    expect(out).toContain('>Button</Button>');
    expect(out).not.toContain('REGISTRUJ');
    expect(out).not.toContain('var(--accent)');
    expect(out).toContain("style={{ position: 'absolute', left: 10, top: 20 }}");
    expect(out).toContain('variant="primary"');
    expect(out).toContain('data-cd-id="cta"');
    const f = readInstance(out, FILE, 'cta');
    expect(overridesOf(f as NonNullable<typeof f>).count).toBe(0);
  });
  test('an instance with no overrides is answered, not written', async () => {
    const h = harness();
    const r = good(await h.run('component.reset', 'tag'));
    expect(r.actionId).toBeNull();
    expect(h.writes()).toBe(0);
    expect(h.src()).toBe(SRC);
  });
  test('only what was asked: `props` names the changes to take back', async () => {
    const h = harness();
    good(await h.run('component.reset', 'cta', { props: ['color'] }));
    const out = h.src();
    expect(out).toContain('REGISTRUJ SE');
    expect(out).toContain("background: 'var(--accent)'");
    expect(out).not.toContain('--on-accent');
    bad(await h.run('component.reset', 'cta', { props: 'color' }));
  });
  test('when nothing is left in `style` the attribute goes', async () => {
    const h = harness(
      SRC.replace(", position: 'absolute', left: 10, top: 20", '').replace(
        "position: 'absolute', left: 10, top: 20, ",
        ''
      )
    );
    good(await h.run('component.reset', 'cta'));
    expect(h.src()).toContain('<Button data-cd-id="cta" variant="primary">Button</Button>');
  });
  test('words and style that are code are left alone, and the answer says so', async () => {
    const h = harness(
      SRC.replace('>REGISTRUJ SE</Button>', '>{label}</Button>').replace(
        /style=\{\{[^}]*\}\}/,
        'style={st}'
      )
    );
    const r = good(await h.run('component.reset', 'cta'));
    expect(h.writes()).toBe(0);
    expect(r.ok && r.detail).toEqual({ kept: ['text', 'style'] });
  });
  test('a frame is not an instance', async () => {
    const h = harness();
    expect(bad(await h.run('component.reset', 'plain')).message).toBe(
      'This is not an instance of a component.'
    );
  });
  test('an instance in a .map() repeats: refused, nothing written', async () => {
    const h = harness(
      SRC.replace(
        /<Button data-cd-id="cta"[\s\S]*?<\/Button>/,
        '{["a", "b"].map((x) => <Button key={x} data-cd-id="cta" style={{ color: "red" }}>{x}</Button>)}'
      )
    );
    expect(bad(await h.run('component.reset', 'cta')).message).toContain('repeats');
  });
});
