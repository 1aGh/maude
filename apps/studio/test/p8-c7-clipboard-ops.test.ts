// V2-clipboard-objects (14 Editing ed-ab-menu, ed-obj-order) — Cut / Copy / Paste of objects and
// artboards through the REAL dispatcher: a copy is a read (nothing written, a handle back, no bytes),
// a cut and a paste are ordinary edit-op writes with a revert (the ⌘Z path), a paste writes only text
// the server itself copied (a handle it never issued is refused).

import { beforeEach, describe, expect, test } from 'bun:test';

import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { walkIdElements } from '../element-ids.ts';

const FILE = 'ui/Home.tsx';
const OTHER = 'ui/Other.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="services" className="services">
          <b data-cd-id="dot" data-cd-locked />
          <strong data-cd-id="title">Brand systems</strong>
          <span data-cd-id="blurb">Logos, type and colour</span>
        </section>
        <footer data-cd-id="footer">Footer</footer>
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
        <div data-cd-id="page">
          <h1 data-cd-id="head">Hello</h1>
        </div>
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
  const layout: unknown[] = [];
  const log = createWriteLog();
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes.push(rel);
      files.set(rel, after);
    },
    writeLayout: async (_rel, patch) => {
      layout.push(patch);
    },
    heldByAi: () => null,
    log,
  };
  const run = (
    op: string,
    targets: string[],
    params?: Record<string, unknown>,
    file = FILE,
    artboard = 'desktop'
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
  return { files, writes, layout, run, src: (f = FILE) => files.get(f) as string };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const ids = (src: string) =>
  (walkIdElements(src) as { elements: Array<{ id: string | null }> }).elements
    .map((e) => e.id)
    .filter(Boolean);
const clipOf = (r: EditOpResult) =>
  (good(r).detail as { clip: { id: string; kind: string; count: number; from: string } }).clip;

beforeEach(() => _resetClips());

describe('the op table', () => {
  test('cut / copy / paste are registered edit-ops; the copies are reads', () => {
    const byId = new Map(EDIT_OPS.map((o) => [o.id, o]));
    for (const id of ['object.copy', 'object.cut', 'artboard.copy', 'canvas.paste'])
      expect(byId.has(id)).toBe(true);
    expect(byId.get('object.copy')?.read).toBe(true);
    expect(byId.get('artboard.copy')?.read).toBe(true);
    expect(byId.get('object.cut')?.read).toBeFalsy();
    expect(byId.get('canvas.paste')?.read).toBeFalsy();
  });
});

describe('copy is a read', () => {
  test('object.copy writes nothing and answers a handle, never the bytes', async () => {
    const h = harness();
    const r = good(await h.run('object.copy', ['title', 'blurb']));
    expect(h.writes).toEqual([]);
    expect(h.src()).toBe(SRC);
    expect(r.writeId).toBe('');
    const clip = clipOf(r);
    expect(clip).toMatchObject({ kind: 'objects', count: 2, from: FILE });
    expect(clip.id).toMatch(/^c_[0-9a-f]{16}$/);
    expect(JSON.stringify(r)).not.toContain('Brand systems');
  });

  test('a locked object can be copied', async () => {
    const h = harness();
    expect(clipOf(await h.run('object.copy', ['dot'])).count).toBe(1);
  });

  test('an unstamped target is stamped in memory only', async () => {
    const h = harness();
    const r = await h.run('object.copy', ['3fa2b0c1']);
    expect(h.writes).toEqual([]);
    expect(r.ok).toBe(false); // not on the canvas → refused, nothing written
  });
});

describe('paste', () => {
  test('pastes the copied objects after the selected one, with fresh ids, as one write', async () => {
    const h = harness();
    const clip = clipOf(await h.run('object.copy', ['title', 'blurb']));
    const r = good(await h.run('canvas.paste', ['footer'], { clip: clip.id }));
    expect(h.writes).toEqual([FILE]);
    expect(r.writeId).toMatch(/^w_/);
    const src = h.src();
    expect(src.match(/Brand systems/g)?.length).toBe(2);
    // the copies sit right after the footer, at its indent
    expect(src).toContain(
      '<footer data-cd-id="footer">Footer</footer>\n        <strong data-cd-id="brand-systems">Brand systems</strong>\n        <span data-cd-id="logos-type-and">Logos, type and colour</span>'
    );
    expect(r.created).toEqual([
      { artboard: 'desktop', element: 'brand-systems' },
      { artboard: 'desktop', element: 'logos-type-and' },
    ]);
    // every id stays unique
    const all = ids(src);
    expect(new Set(all).size).toBe(all.length);
  });

  test('a copy never carries a lock', async () => {
    const h = harness();
    const clip = clipOf(await h.run('object.copy', ['services']));
    good(await h.run('canvas.paste', ['footer'], { clip: clip.id }));
    expect(h.src().match(/data-cd-locked/g)?.length).toBe(1);
  });

  test('with nothing selected the objects land at the end of their artboard', async () => {
    const h = harness();
    const clip = clipOf(await h.run('object.copy', ['title']));
    good(await h.run('canvas.paste', [], { clip: clip.id }));
    expect(h.src()).toMatch(
      /<footer data-cd-id="footer">Footer<\/footer>\n\s+<strong data-cd-id="brand-systems">/
    );
  });

  test('into another canvas: inside its page root', async () => {
    const h = harness();
    const clip = clipOf(await h.run('object.copy', ['title']));
    good(await h.run('canvas.paste', [], { clip: clip.id, artboard: 'post' }, OTHER, 'post'));
    expect(h.src(OTHER)).toContain(
      '<h1 data-cd-id="head">Hello</h1>\n          <strong data-cd-id="brand-systems">Brand systems</strong>\n        </div>'
    );
  });

  test('the paste reverts like any edit-op (the legacy ⌘Z record)', async () => {
    const h = harness();
    const clip = clipOf(await h.run('object.copy', ['title']));
    const r = good(await h.run('canvas.paste', ['footer'], { clip: clip.id }));
    good(await h.run('revert', [], { writeId: r.writeId }));
    expect(h.src()).toBe(SRC);
  });

  test('a handle the server never issued, or none, is refused and writes nothing', async () => {
    const h = harness();
    for (const clip of ['c_0000000000000000', 'x', undefined]) {
      const r = await h.run('canvas.paste', ['footer'], clip === undefined ? {} : { clip });
      expect(r.ok).toBe(false);
    }
    expect(h.writes).toEqual([]);
  });

  test('raw JSX in params is never written', async () => {
    const h = harness();
    const r = await h.run('canvas.paste', ['footer'], {
      clip: '<script>alert(1)</script>',
      items: ['<img src=x onError={() => fetch("//evil")} />'],
    });
    expect(r.ok).toBe(false);
    expect(h.writes).toEqual([]);
  });
});

describe('cut', () => {
  test('removes the objects in one write and pastes them back', async () => {
    const h = harness();
    const cut = good(await h.run('object.cut', ['title']));
    expect(h.src()).not.toContain('Brand systems');
    expect(cut.writeId).toMatch(/^w_/);
    const clip = clipOf(cut);
    good(await h.run('canvas.paste', ['footer'], { clip: clip.id }));
    expect(h.src()).toContain('<strong data-cd-id="brand-systems">Brand systems</strong>');
  });

  test('a locked object refuses the cut', async () => {
    const h = harness();
    const r = await h.run('object.cut', ['dot']);
    expect(r.ok).toBe(false);
    expect(h.writes).toEqual([]);
  });
});

describe('artboards', () => {
  test('artboard.copy + paste: a renamed copy beside the source, placed in a row', async () => {
    const h = harness();
    const clip = clipOf(await h.run('artboard.copy', [], { artboards: ['desktop'] }));
    expect(clip).toMatchObject({ kind: 'artboards', count: 1 });
    expect(h.writes).toEqual([]);
    const r = good(
      await h.run('canvas.paste', [], { clip: clip.id, artboard: 'desktop', at: { x: 900, y: 0 } })
    );
    const src = h.src();
    expect(src).toContain('<DCArtboard id="desktop-2" label="Desktop 2" width={800} height={500}>');
    expect(r.created).toEqual([{ artboard: 'desktop-2', element: 'desktop-2' }]);
    expect(h.layout).toEqual([{ set: [{ id: 'desktop-2', x: 900, y: 0 }] }]);
    // the copy's elements carry no ids (named lazily, like a duplicate)
    const all = ids(src);
    expect(new Set(all).size).toBe(all.length);
  });

  test('objects never paste as artboards, artboards never inside an object', async () => {
    const h = harness();
    const clip = clipOf(await h.run('artboard.copy', [], { artboards: ['desktop'] }));
    const r = good(await h.run('canvas.paste', ['footer'], { clip: clip.id }));
    // an artboard clip lands beside the artboards, never inside the footer
    expect(h.src()).toContain('</DCArtboard>\n      <DCArtboard id="desktop-2"');
    expect(r.created?.[0]?.artboard).toBe('desktop-2');
  });
});
