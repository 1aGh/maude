// #122 (122-A) — a copy carries what it reads (contract §5.1/§5.2): the imports and module-level declarations
// the copied range names — JSX tags included — travel with the clip, and a paste on another canvas adds what the
// target lacks, reuses what is identical, renames what clashes and re-points relative imports from the target's
// folder. The §6 measured cases were pasted UNRESOLVED before (an error card in the target).

import { beforeEach, describe, expect, test } from 'bun:test';

import { carryOf } from '../edit-ops/clip-carry.ts';
import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const A = 'ui/a/Home.tsx';
const B = 'ui/b/c/Other.tsx';
const CARD = 'components/Card.tsx';

const A_SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
import { Card } from '../../components/Card';
const W = 1440;
const H = 900;
const PAD = W / 48;
let counter = 0;
function Pill({ children }) {
  return <span style={{ padding: PAD }}>{children}</span>;
}
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={W} height={H}>
        <div data-cd-id="page">
          <Pill data-cd-id="pill">New</Pill>
          <Card data-cd-id="card" title="Hi" />
          <p data-cd-id="plain">hello</p>
        </div>
      </DCArtboard>
      <DCArtboard id="side" label="Side" width={400} height={400}>
        <i data-cd-id="count">{counter}</i>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const otherSrc = (head = '') => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
${head}
export default function Other() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={1080} height={1080}>
        <div data-cd-id="box">
          <h1 data-cd-id="head">Hello</h1>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const CARD_SRC = `export function Card({ title }) {
  return <div>{title}</div>;
}
export function Other() {
  return null;
}
`;

function harness(bHead = '', extra: Record<string, string> = {}) {
  const files = new Map<string, string>([
    [A, A_SRC],
    [B, otherSrc(bHead)],
    [CARD, CARD_SRC],
    ...Object.entries(extra),
  ]);
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) && f.endsWith('.tsx') && f.startsWith('ui/') ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes.push(rel);
      files.set(rel, after);
    },
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (
    op: string,
    file: string,
    artboard: string,
    targets: string[],
    params?: Record<string, unknown>
  ) =>
    dispatchEditOp(
      {
        file,
        op,
        targets: targets.map((element) => ({ artboard, element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  const copy = async (what: 'artboard' | string, artboard = 'desktop') => {
    const r =
      what === 'artboard'
        ? await run('artboard.copy', A, 'desktop', [], { artboards: ['desktop'] })
        : await run('object.copy', A, artboard, [what]);
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    return (r.detail as { clip: { id: string } }).clip.id;
  };
  const pasteOnB = (clip: string, kind: 'artboard' | 'object') =>
    kind === 'artboard'
      ? run('canvas.paste', B, 'post', [], { clip, artboard: 'post' })
      : run('canvas.paste', B, 'post', ['head'], { clip });
  return { files, writes, run, copy, pasteOnB, b: () => files.get(B) as string };
}
const okR = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const count = (s: string, re: RegExp) => s.match(new RegExp(re.source, 'g'))?.length ?? 0;

beforeEach(() => _resetClips());

describe('carryOf — the clip as kept (server only)', () => {
  test('imports resolved to their file, declarations in order, the assets the items name', () => {
    const src = A_SRC.replace(
      '<p data-cd-id="plain">hello</p>',
      '<img data-cd-id="pic" src="assets/0a1b2c3d.png" />'
    );
    const from = src.indexOf('<DCArtboard id="desktop"');
    const to = src.indexOf('</DCArtboard>', from) + '</DCArtboard>'.length;
    const read = carryOf(src, [[from, to]], A, [src.slice(from, to)], {
      text: (rel) => (rel === CARD ? CARD_SRC : rel === 'assets/0a1b2c3d.photo.json' ? '{}' : null),
    });
    expect(read?.refused).toBeNull();
    expect(read?.needs).toEqual([]);
    expect(read?.carry.imports.map((i) => [i.local, i.module])).toEqual([
      ['DCArtboard', null],
      ['Card', CARD],
    ]);
    expect(read?.carry.decls.map((d) => [d.name, d.kind])).toEqual([
      ['W', 'const'],
      ['H', 'const'],
      ['PAD', 'const'],
      ['Pill', 'function'],
    ]);
    expect(read?.carry.assets).toEqual(['assets/0a1b2c3d.photo.json', 'assets/0a1b2c3d.png']);
  });
});

describe('the §6 measured cases: carried, not pasted unresolved', () => {
  test('an artboard reading module constants, a same-file component and an imported one', async () => {
    const h = harness();
    okR(await h.pasteOnB(await h.copy('artboard'), 'artboard'));
    const b = h.b();
    // re-pointed from ui/a/ to ui/b/c/
    expect(b).toContain("import { Card } from '../../../components/Card';");
    expect(b).toContain('const W = 1440;');
    expect(b).toContain('const H = 900;');
    expect(b).toContain('const PAD = W / 48;');
    expect(b).toMatch(/function Pill\(\{ children \}\)/);
    expect(b).toContain('width={W} height={H}');
  });

  test('an object rendering a same-file component as a JSX tag: <Pill>', async () => {
    const h = harness();
    okR(await h.pasteOnB(await h.copy('pill'), 'object'));
    expect(h.b()).toMatch(/function Pill/);
    expect(h.b()).toContain('const PAD = W / 48;'); // transitively, what Pill reads
    expect(h.b()).toContain('const W = 1440;');
    expect(h.b()).not.toContain('const H ='); // only what is read
    expect(h.b()).not.toContain('Card');
  });

  test('an object rendering an imported component: <Card>', async () => {
    const h = harness();
    okR(await h.pasteOnB(await h.copy('card'), 'object'));
    expect(h.b()).toContain("import { Card } from '../../../components/Card';");
    expect(h.b()).toContain('<Card title="Hi"');
  });
});

describe('what the target already has', () => {
  test('an identical declaration is reused, not duplicated', async () => {
    const h = harness('const W = 1440;');
    const r = okR(await h.pasteOnB(await h.copy('artboard'), 'artboard'));
    expect(count(h.b(), /const W = 1440;/)).toBe(1);
    expect(h.b()).not.toContain('W2');
    expect((r.detail as { carried?: { renamed: unknown[] } })?.carried?.renamed).toEqual([]);
  });

  test('a clash is renamed in the declaration, in carried declarations that read it, and in the items', async () => {
    const h = harness('const W = 1080;');
    const r = okR(await h.pasteOnB(await h.copy('artboard'), 'artboard'));
    const b = h.b();
    expect(b).toContain('const W = 1080;');
    expect(b).toContain('const W2 = 1440;');
    expect(b).toContain('const PAD = W2 / 48;');
    expect(b).toContain('width={W2} height={H}');
    expect((r.detail as { carried: { renamed: unknown[] } }).carried.renamed).toEqual([
      { from: 'W', to: 'W2' },
    ]);
  });

  test('an import whose local name is taken here is aliased: Card as Card2', async () => {
    const h = harness('function Card() {\n  return null;\n}');
    okR(await h.pasteOnB(await h.copy('card'), 'object'));
    expect(h.b()).toContain("import { Card as Card2 } from '../../../components/Card';");
    expect(h.b()).toContain('<Card2 title="Hi"');
  });

  test('the same module under another local: the items use that local, no new import', async () => {
    const h = harness("import { Card as Tile } from '../../../components/Card';");
    okR(await h.pasteOnB(await h.copy('card'), 'object'));
    expect(count(h.b(), /from '\.\.\/\.\.\/\.\.\/components\/Card'/)).toBe(1);
    expect(h.b()).toContain('<Tile title="Hi"');
  });

  test('another name from a module the target imports joins that import', async () => {
    const h = harness("import { Other as Unused } from '../../../components/Card';");
    okR(await h.pasteOnB(await h.copy('card'), 'object'));
    expect(h.b()).toContain("import { Other as Unused, Card } from '../../../components/Card';");
  });

  test('declarations land in dependency order', async () => {
    const h = harness();
    okR(await h.pasteOnB(await h.copy('pill'), 'object'));
    const b = h.b();
    expect(b.indexOf('const W =')).toBeLessThan(b.indexOf('const PAD ='));
    expect(b.indexOf('const PAD =')).toBeLessThan(b.indexOf('function Pill'));
  });

  test('the result says what was added', async () => {
    const h = harness();
    const r = okR(await h.pasteOnB(await h.copy('artboard'), 'artboard'));
    expect((r.detail as { carried: unknown }).carried).toEqual({
      imports: 1,
      decls: 4,
      renamed: [],
    });
  });
});

describe('what never travels', () => {
  test('a `let` the copy reads: refused on another canvas, nothing written; fine on its own canvas', async () => {
    const h = harness();
    const clip = await h.copy('count', 'side');
    const r = await h.pasteOnB(clip, 'object');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/reads counter/);
    expect(h.writes).toEqual([]);
    okR(await h.run('canvas.paste', A, 'desktop', ['plain'], { clip }));
    // an artboard reading it: the same refusal (artboards were never checked before)
    const board = okR(await h.run('artboard.copy', A, 'side', [], { artboards: ['side'] }));
    const bclip = (board.detail as { clip: { id: string } }).clip.id;
    const rb = await h.pasteOnB(bclip, 'artboard');
    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.message).toMatch(/That artboard reads counter/);
    expect(h.writes).toEqual([A]);
    expect(count(h.files.get(A) as string, /let counter/)).toBe(1);
  });

  test('more than 32 carried names: refused on another canvas, fine on its own', async () => {
    const consts = Array.from({ length: 33 }, (_, i) => `const K${i} = ${i};`).join('\n');
    const reads = Array.from({ length: 33 }, (_, i) => `{K${i}}`).join('');
    const src = A_SRC.replace('let counter = 0;', consts).replace(
      '<p data-cd-id="plain">hello</p>',
      `<p data-cd-id="plain">${reads}</p>`
    );
    const h = harness('', { [A]: src });
    const clip = await h.copy('plain');
    const r = await h.pasteOnB(clip, 'object');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/too much/i);
    expect(h.writes).toEqual([]);
    okR(await h.run('canvas.paste', A, 'desktop', ['plain'], { clip }));
  });

  test('the same canvas: nothing carried (the names are already there)', async () => {
    const h = harness();
    const clip = await h.copy('pill');
    const r = okR(await h.run('canvas.paste', A, 'desktop', ['plain'], { clip }));
    const a = h.files.get(A) as string;
    expect(count(a, /function Pill/)).toBe(1);
    expect(count(a, /const W =/)).toBe(1);
    expect((r.detail as { carried?: unknown } | undefined)?.carried).toBeUndefined();
  });
});
