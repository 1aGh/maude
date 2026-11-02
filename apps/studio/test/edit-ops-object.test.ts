// S2.6 — the object ops through the real dispatcher: frame / unframe / z-order / lock / hide as
// goldens (the route result ≡ the documented file edit, rule 14), the refusals, and "ids survive".

import { describe, expect, test } from 'bun:test';

import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { walkIdElements } from '../element-ids.ts';

const FILE = 'ui/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="services" className="services">
          <b data-cd-id="dot" />
          <strong data-cd-id="title">Brand systems</strong>
          <span data-cd-id="blurb">Logos, type and colour</span>
        </section>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial = SRC) {
  const files = new Map<string, string>([[FILE, initial]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      files.set(rel, after);
    },
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (op: string, targets: string[], params?: Record<string, unknown>) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard: 'desktop', element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  return { files, run, src: () => files.get(FILE) as string };
}

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const ids = (src: string) =>
  (walkIdElements(src) as { elements: Array<{ id: string | null }> }).elements
    .map((e) => e.id)
    .filter(Boolean);

describe('the op table', () => {
  test('every S2.6 op is registered under its registry id', () => {
    const have = new Set(EDIT_OPS.map((o) => o.id));
    for (const id of [
      'object.frame',
      'object.unframe',
      'object.bring-front',
      'object.bring-forward',
      'object.send-backward',
      'object.send-back',
      'object.lock',
      'object.hide',
    ])
      expect(have.has(id)).toBe(true);
    expect(EDIT_OPS.find((o) => o.id === 'object.lock')?.locked).toBe('allow');
  });
});

describe('object.frame / object.unframe', () => {
  test('frame wraps the selection in a stacked frame at the first one, the golden', async () => {
    const h = harness();
    const r = good(await h.run('object.frame', ['dot', 'title', 'blurb']));
    expect(r.created).toEqual([{ artboard: 'desktop', element: 'frame' }]);
    expect(h.src()).toBe(
      SRC.replace(
        `          <b data-cd-id="dot" />
          <strong data-cd-id="title">Brand systems</strong>
          <span data-cd-id="blurb">Logos, type and colour</span>
`,
        `          <div data-cd-id="frame" style={{ display: 'flex', flexDirection: 'column' }}>
            <b data-cd-id="dot" />
            <strong data-cd-id="title">Brand systems</strong>
            <span data-cd-id="blurb">Logos, type and colour</span>
          </div>
`
      )
    );
  });

  test('every id survives a frame; the new frame gets a new, readable one (frame-2 on the second)', async () => {
    const h = harness();
    const before = ids(SRC);
    good(await h.run('object.frame', ['title', 'blurb']));
    for (const id of before) expect(ids(h.src())).toContain(id);
    expect(ids(h.src())).toContain('frame');
    good(await h.run('object.frame', ['frame']));
    expect(ids(h.src())).toContain('frame-2');
  });

  test('a selection that is not side by side moves into the frame at the first object', async () => {
    const h = harness();
    good(await h.run('object.frame', ['dot', 'blurb']));
    const s = h.src();
    expect(s.indexOf('data-cd-id="dot"')).toBeLessThan(s.indexOf('data-cd-id="blurb"'));
    expect(s.indexOf('data-cd-id="blurb"')).toBeLessThan(s.indexOf('data-cd-id="title"'));
    expect(s).toContain('</div>\n          <strong data-cd-id="title">');
  });

  test('unframe puts the children where the frame was; frame then unframe is byte-identical', async () => {
    const h = harness();
    good(await h.run('object.frame', ['dot', 'title', 'blurb']));
    const r = good(await h.run('object.unframe', ['frame']));
    expect(h.src()).toBe(SRC);
    expect(r.refs).toEqual([{ artboard: 'desktop', element: 'frame' }]);
  });

  test('refusals: objects in different parents, a frame of words, an unframe of a leaf', async () => {
    const h = harness();
    expect(bad(await h.run('object.frame', ['title', 'footer'])).code).toBe('invalid');
    expect(bad(await h.run('object.unframe', ['title'])).code).toBe('invalid');
    expect(bad(await h.run('object.unframe', ['dot'])).code).toBe('invalid');
    expect(h.src()).toBe(SRC);
  });

  test('a locked object is not framed (locked → 409)', async () => {
    const h = harness();
    good(await h.run('object.lock', ['title']));
    expect(bad(await h.run('object.frame', ['title', 'blurb'])).code).toBe('locked');
  });
});

describe('z-order', () => {
  const order = (src: string) =>
    ['dot', 'title', 'blurb']
      .map((id) => [id, src.indexOf(`data-cd-id="${id}"`)] as const)
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);

  test('bring to front / send to back move to the ends, the siblings keep their order', async () => {
    const h = harness();
    good(await h.run('object.bring-front', ['dot']));
    expect(order(h.src())).toEqual(['title', 'blurb', 'dot']);
    good(await h.run('object.send-back', ['dot']));
    expect(order(h.src())).toEqual(['dot', 'title', 'blurb']);
    expect(h.src()).toBe(SRC);
  });

  test('forward / backward move one step; at the end they change nothing and write nothing', async () => {
    const h = harness();
    good(await h.run('object.bring-forward', ['dot']));
    expect(order(h.src())).toEqual(['title', 'dot', 'blurb']);
    good(await h.run('object.send-backward', ['dot']));
    expect(h.src()).toBe(SRC);
    const noop = good(await h.run('object.send-backward', ['dot']));
    expect(noop.actionId).toBeNull();
    expect(h.src()).toBe(SRC);
  });

  test('a multi-selection moves together; two selected neighbours do not swap with each other', async () => {
    const h = harness();
    good(await h.run('object.bring-forward', ['dot', 'title']));
    expect(order(h.src())).toEqual(['blurb', 'dot', 'title']);
  });

  test('the text of every sibling is byte-for-byte what it was (reorder is a permutation)', async () => {
    const h = harness();
    good(await h.run('object.bring-front', ['title']));
    for (const part of [
      '<b data-cd-id="dot" />',
      '<strong data-cd-id="title">Brand systems</strong>',
      '<span data-cd-id="blurb">Logos, type and colour</span>',
    ])
      expect(h.src()).toContain(part);
  });

  test('objects in a repeat or a condition are refused, not guessed at', async () => {
    const cond = SRC.replace('<b data-cd-id="dot" />', '{true && <b data-cd-id="dot" />}');
    const h = harness(cond);
    expect(bad(await h.run('object.bring-front', ['dot'])).code).toBe('invalid');
    expect(h.src()).toBe(cond);
  });
});

describe('lock is shared, not per user', () => {
  test('a lock one client made is the file’s: another client is refused and can unlock it', async () => {
    const a = harness();
    // a second client: its own dispatcher and write log over the SAME file bytes
    const files = a.files;
    const bDeps: DispatchDeps = {
      resolve: (f) => (files.has(f) ? f : null),
      read: (rel) => files.get(rel) ?? null,
      write: async (rel, _b, after) => {
        files.set(rel, after);
      },
      heldByAi: () => null,
      log: createWriteLog(),
    };
    const b = (op: string, element: string) =>
      dispatchEditOp({ file: FILE, op, targets: [{ artboard: 'desktop', element }] }, bDeps);
    good(await a.run('object.lock', ['title']));
    const refused = bad(await b('object.hide', 'title'));
    expect(refused.code).toBe('locked');
    expect(refused.message).toBe('title is locked · ⇧⌘L unlocks');
    good(await b('object.lock', 'title')); // B unlocks A's lock
    expect(a.src()).toBe(SRC);
  });
});

describe('object.lock / object.hide', () => {
  test('lock stamps data-cd-locked; the same op unlocks (toggle) and an explicit value wins', async () => {
    const h = harness();
    good(await h.run('object.lock', ['title']));
    expect(h.src()).toContain('<strong data-cd-id="title" data-cd-locked>');
    good(await h.run('object.lock', ['title']));
    expect(h.src()).toBe(SRC);
    good(await h.run('object.lock', ['title', 'blurb'], { locked: true }));
    expect(h.src()).toContain('data-cd-locked>Logos');
    good(await h.run('object.lock', ['title', 'blurb'], { locked: false }));
    expect(h.src()).toBe(SRC);
  });

  test('a mixed selection locks all first, then unlocks all', async () => {
    const h = harness();
    good(await h.run('object.lock', ['title']));
    good(await h.run('object.lock', ['title', 'blurb']));
    expect((h.src().match(/data-cd-locked/g) ?? []).length).toBe(2);
    good(await h.run('object.lock', ['title', 'blurb']));
    expect(h.src()).toBe(SRC);
  });

  test('hide writes display:none + the marker and keeps the object; show restores the source', async () => {
    const h = harness();
    good(await h.run('object.hide', ['title']));
    expect(h.src()).toContain('data-cd-hidden=""');
    expect(h.src()).toContain("display: 'none'");
    expect(ids(h.src())).toContain('title');
    good(await h.run('object.hide', ['title']));
    expect(h.src()).toBe(SRC);
  });

  test('a locked object cannot be hidden, but it can be unlocked', async () => {
    const h = harness();
    good(await h.run('object.lock', ['title']));
    expect(bad(await h.run('object.hide', ['title'])).code).toBe('locked');
    good(await h.run('object.lock', ['title']));
    good(await h.run('object.hide', ['title']));
  });
});
