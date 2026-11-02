// P8 C7 (14 ed-ab-menu, clipboard follow-up): an object that READS its component's values (`{title}`, a local helper)
// does not paste where those names are not — the paste is refused in words and nothing is written, instead of
// landing as an error card. Pasting it where the names ARE visible (the same component) still works.

import { beforeEach, describe, expect, test } from 'bun:test';

import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { needsOf, scopeAt } from '../edit-ops/scope-names.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Home.tsx';
const OTHER = 'ui/Other.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
const accent = 'red';
function Hero({ title, items }) {
  const label = title.toUpperCase();
  return (
    <div data-cd-id="hero">
      <b data-cd-id="reads-title">{title}</b>
      <i data-cd-id="reads-label">{label}</i>
      <u data-cd-id="reads-accent" style={{ color: accent }}>x</u>
      <ul data-cd-id="own-names">{items.map((it) => <li key={it}>{it}</li>)}</ul>
      <em data-cd-id="plain">hello</em>
    </div>
  );
}
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="services">
          <span data-cd-id="blurb">Logos</span>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const OTHER_SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Other() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={1080} height={1080}>
        <div data-cd-id="page"><h1 data-cd-id="head">Hello</h1></div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness() {
  const files = new Map<string, string>([
    [FILE, SRC],
    [OTHER, OTHER_SRC],
  ]);
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
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
  return { files, writes, run };
}
const clipId = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return (r.detail as { clip: { id: string } }).clip.id;
};

beforeEach(() => _resetClips());

describe('needsOf / scopeAt', () => {
  const at = (needle: string) => SRC.indexOf(needle);
  test('a range reads what its component declares: a parameter, a local const, a module helper', () => {
    const range = (id: string) => {
      const from = SRC.lastIndexOf('<', SRC.indexOf(`data-cd-id="${id}"`));
      const to = SRC.indexOf('\n', from);
      return [from, to] as const;
    };
    expect(needsOf(SRC, ...range('reads-title'))).toEqual(['title']);
    expect(needsOf(SRC, ...range('reads-label'))).toEqual(['label']);
    expect(needsOf(SRC, ...range('reads-accent'))).toEqual(['accent']);
    expect(needsOf(SRC, ...range('plain'))).toEqual([]);
    // a callback's own parameter and a property name are not reads of the component
    expect(needsOf(SRC, ...range('own-names'))).toEqual(['items']);
  });
  test('a spot sees the module and the functions around it, not a sibling component’s names', () => {
    const inHero = scopeAt(SRC, at('data-cd-id="hero"')) as Set<string>;
    const inHome = scopeAt(SRC, at('data-cd-id="services"')) as Set<string>;
    expect(inHero.has('title') && inHero.has('label') && inHero.has('accent')).toBe(true);
    expect(inHome.has('accent')).toBe(true);
    expect(inHome.has('title')).toBe(false);
    expect(inHome.has('label')).toBe(false);
  });
});

describe('paste of an object that reads its component', () => {
  test('into the same component: pasted', async () => {
    const h = harness();
    const id = clipId(await h.run('object.copy', FILE, 'desktop', ['reads-title']));
    const r = await h.run('canvas.paste', FILE, 'desktop', ['plain'], { clip: id });
    expect(r.ok).toBe(true);
    expect(h.files.get(FILE)?.match(/\{title\}/g)?.length).toBe(2);
  });
  test('into a canvas that has no such name: refused in words, nothing written', async () => {
    const h = harness();
    const id = clipId(await h.run('object.copy', FILE, 'desktop', ['reads-title']));
    const r = await h.run('canvas.paste', OTHER, 'post', ['head'], { clip: id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/reads .*title/i);
    expect(h.writes).toEqual([]);
    expect(h.files.get(OTHER)).toBe(OTHER_SRC);
  });
  test('into another component of the same file: refused', async () => {
    const h = harness();
    const id = clipId(await h.run('object.copy', FILE, 'desktop', ['reads-label']));
    const r = await h.run('canvas.paste', FILE, 'desktop', ['blurb'], { clip: id });
    expect(r.ok).toBe(false);
  });
  test('an object that reads nothing pastes anywhere', async () => {
    const h = harness();
    const id = clipId(await h.run('object.copy', FILE, 'desktop', ['plain']));
    const r = await h.run('canvas.paste', OTHER, 'post', ['head'], { clip: id });
    expect(r.ok).toBe(true);
  });
});
