// S2.11 (ed-lay-auto · ed-lay-reorder · ed-lay-free) — the layout edit-ops through the real
// dispatcher: Place freely, constraints, and reorder (earlier / later / to a slot / as a copy).
// Goldens are the "same result by hand" of rule 14. The canvas half (gap bands, token ruler, the
// reorder slot) is test/edit-layout-client.test.tsx.

import { describe, expect, test } from 'bun:test';

import { readAttributeState } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';

const FILE = 'ui/Home.tsx';

// A frame with three cards in an auto layout (Services, ed-lay-auto).
const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <section data-cd-id="services" style={{ display: "flex", gap: "24px", padding: "24px" }}>
          <div data-cd-id="apps">Small apps</div>
          <div data-cd-id="product">Product design</div>
          <div data-cd-id="brand">Brand systems</div>
        </section>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

// A social post places things freely (ed-lay-free): Datum is 216 wide, 64 from the corner.
const POST = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post 1:1" width={1080} height={1080}>
        <div data-cd-id="datum" style={{ position: "absolute", left: "800px", top: "64px", width: 216, height: 216 }}>9. 5.</div>
        <p data-cd-id="flow">Flows</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness(initial: string, artboard: string) {
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
  };
  const run = (op: string, targets: string[], params?: Record<string, unknown>) =>
    dispatchEditOp(
      {
        file: FILE,
        op,
        targets: targets.map((element) => ({ artboard, element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  return { files, run, src: () => files.get(FILE) as string, writes: () => writes };
}
const home = () => harness(HOME, 'desktop');
const post = () => harness(POST, 'post');

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
/** the writer appends with the canvas-edit spacing (` , `); a golden compares the declarations */
const tidy = (src: string) => src.replace(/\s+,/g, ',').replace(/ +\}\}/g, ' }}');
const style = (src: string, id: string, prop: string) => {
  const s = readAttributeState(FILE, src, id, `style.${prop}`);
  return s.kind === 'literal' ? s.value : s.kind;
};
/** the order of the three cards as written */
const order = (src: string) =>
  [...src.matchAll(/data-cd-id="(apps|product|brand)"/g)].map((m) => m[1]);

describe('the op table', () => {
  test('every S2.11 op is registered under its registry id', () => {
    const have = new Set(EDIT_OPS.map((o) => o.id));
    for (const id of [
      'object.place-freely',
      'object.constrain',
      'object.reorder-earlier',
      'object.reorder-later',
      'object.reorder-to',
    ])
      expect(have.has(id)).toBe(true);
  });
});

describe('object.place-freely (writes CSS, not data-cd-*)', () => {
  const BOX = { x: 24, y: 24, w: 400, h: 232 };

  test('the card keeps its box: position absolute, left, top, width, height', async () => {
    const h = home();
    good(await h.run('object.place-freely', ['apps'], BOX));
    expect(style(h.src(), 'apps', 'position')).toBe('absolute');
    expect(style(h.src(), 'apps', 'left')).toBe('24px');
    expect(style(h.src(), 'apps', 'top')).toBe('24px');
    expect(style(h.src(), 'apps', 'width')).toBe('400px');
    expect(style(h.src(), 'apps', 'height')).toBe('232px');
  });

  test('golden: the one-line edit an agent would make by hand', async () => {
    const h = home();
    good(await h.run('object.place-freely', ['apps'], BOX));
    expect(tidy(h.src())).toBe(
      HOME.replace(
        '<div data-cd-id="apps">',
        '<div style={{ position: "absolute", left: "24px", top: "24px", width: "400px", height: "232px" }} data-cd-id="apps">'
      )
    );
  });

  test('the frame becomes the reference when it is not placed yet (second target)', async () => {
    const h = home();
    good(
      await h.run('object.place-freely', ['apps', 'services'], { ...BOX, relativeParent: true })
    );
    expect(style(h.src(), 'services', 'position')).toBe('relative');
    expect(style(h.src(), 'services', 'display')).toBe('flex'); // the rest of its style is kept
    expect(style(h.src(), 'apps', 'position')).toBe('absolute');
  });

  test('no data-cd-* attribute is added or changed', async () => {
    const h = home();
    good(
      await h.run('object.place-freely', ['apps', 'services'], { ...BOX, relativeParent: true })
    );
    const cd = (s: string) => [...s.matchAll(/data-cd-[a-z-]+="[^"]*"/g)].map((m) => m[0]).sort();
    expect(cd(h.src())).toEqual(cd(HOME));
  });

  test('an object that is already placed freely: nothing is written', async () => {
    const h = post();
    const r = good(await h.run('object.place-freely', ['datum'], BOX));
    expect(r.actionId).toBeNull();
    expect(h.src()).toBe(POST);
    expect(h.writes()).toBe(0);
  });

  test('a position the file computes is refused in plain words', async () => {
    const h = harness(
      HOME.replace('data-cd-id="apps"', 'style={s.card} data-cd-id="apps"'),
      'desktop'
    );
    const r = bad(await h.run('object.place-freely', ['apps'], BOX));
    expect(r.code).toBe('invalid');
    expect(r.message).toMatch(/computed|code/i);
  });

  test('the canvas must say where the object is', async () => {
    const h = home();
    const r = bad(await h.run('object.place-freely', ['apps'], { x: 'a', y: 1, w: 2, h: 3 }));
    expect(r.code).toBe('invalid');
    expect(h.src()).toBe(HOME);
  });

  test('a locked object is refused (the dispatcher’s rule, not ours)', async () => {
    const h = harness(
      HOME.replace('data-cd-id="apps"', 'data-cd-id="apps" data-cd-locked="true"'),
      'desktop'
    );
    expect(bad(await h.run('object.place-freely', ['apps'], BOX)).code).toBe('locked');
  });
});

describe('object.constrain (Datum keeps 64 from the corner)', () => {
  const G = { x: 800, y: 64, w: 216, h: 216, parentW: 1080, parentH: 1080 };

  test('Right and Top: right carries the distance, left is taken out', async () => {
    const h = post();
    good(await h.run('object.constrain', ['datum'], { h: 'right', v: 'top', geometry: G }));
    expect(style(h.src(), 'datum', 'right')).toBe('64px');
    expect(style(h.src(), 'datum', 'left')).toBe('absent');
    expect(style(h.src(), 'datum', 'top')).toBe('64px');
    expect(style(h.src(), 'datum', 'width')).toBe('216');
  });

  test('golden: the by-hand edit', async () => {
    const h = post();
    good(await h.run('object.constrain', ['datum'], { h: 'right', v: 'top', geometry: G }));
    expect(tidy(h.src())).toBe(
      POST.replace('left: "800px", top: "64px"', 'top: "64px"').replace(
        'height: 216 }}',
        'height: 216, right: "64px" }}'
      )
    );
  });

  test('the 9:16 copy keeps the same distance: nothing in the file depends on the width', async () => {
    // Duplicate at another size = the same source in a taller, equally wide artboard. Right: 64
    // and Top: 64 are the whole placement, so the corner distance is 64 whatever the parent is.
    const h = post();
    good(await h.run('object.constrain', ['datum'], { h: 'right', v: 'top', geometry: G }));
    const story = h.src().replace('width={1080} height={1080}', 'width={1080} height={1920}');
    expect(style(story, 'datum', 'right')).toBe('64px');
    expect(style(story, 'datum', 'top')).toBe('64px');
    expect(style(story, 'datum', 'left')).toBe('absent');
  });

  test('Left & Right: both edges, the width is taken out', async () => {
    const h = post();
    good(await h.run('object.constrain', ['datum'], { h: 'both', v: 'top', geometry: G }));
    expect(style(h.src(), 'datum', 'left')).toBe('800px');
    expect(style(h.src(), 'datum', 'right')).toBe('64px');
    expect(style(h.src(), 'datum', 'width')).toBe('absent');
  });

  test('an object that sits in a layout is not constrained', async () => {
    const h = home();
    const r = bad(await h.run('object.constrain', ['apps'], { h: 'right', v: 'top', geometry: G }));
    expect(r.code).toBe('invalid');
    expect(r.message).toMatch(/freely/i);
    expect(h.src()).toBe(HOME);
  });

  test('a pin the words do not know is refused', async () => {
    const h = post();
    expect(
      bad(await h.run('object.constrain', ['datum'], { h: 'diagonal', v: 'top', geometry: G })).code
    ).toBe('invalid');
  });
});

describe('reorder (one request = one write = one action)', () => {
  test('object.reorder-earlier: Product design moves before Small apps', async () => {
    const h = home();
    good(await h.run('object.reorder-earlier', ['product']));
    expect(order(h.src())).toEqual(['product', 'apps', 'brand']);
    expect(h.writes()).toBe(1);
  });

  test('object.reorder-later: Small apps moves after Product design', async () => {
    const h = home();
    good(await h.run('object.reorder-later', ['apps']));
    expect(order(h.src())).toEqual(['product', 'apps', 'brand']);
  });

  test('the last card has no later place: nothing is written', async () => {
    const h = home();
    const r = good(await h.run('object.reorder-later', ['brand']));
    expect(r.actionId).toBeNull();
    expect(h.writes()).toBe(0);
    expect(h.src()).toBe(HOME);
  });

  test('object.reorder-to: Brand systems goes to the front of Services (before Small apps)', async () => {
    const h = home();
    good(await h.run('object.reorder-to', ['brand', 'apps'], { position: 'before' }));
    expect(order(h.src())).toEqual(['brand', 'apps', 'product']);
    expect(h.writes()).toBe(1);
  });

  test('object.reorder-to: after a neighbour', async () => {
    const h = home();
    good(await h.run('object.reorder-to', ['apps', 'brand'], { position: 'after' }));
    expect(order(h.src())).toEqual(['product', 'brand', 'apps']);
  });

  test('object.reorder-to with copy: the original stays, a copy lands in the slot, still one write', async () => {
    const h = home();
    good(await h.run('object.reorder-to', ['brand', 'apps'], { position: 'before', copy: true }));
    const cards = [
      ...h.src().matchAll(/<div[^>]*>(Small apps|Product design|Brand systems)</g),
    ].map((m) => m[1]);
    expect(cards).toEqual(['Brand systems', 'Small apps', 'Product design', 'Brand systems']);
    expect(h.writes()).toBe(1);
    // the copy never inherits the original's id
    expect(h.src().match(/data-cd-id="brand"/g)?.length).toBe(1);
  });

  test('r1 #15 — ⌥-drop of a placed object: the copy follows the original and takes the drop’s left / top, one write', async () => {
    const h = home();
    good(
      await h.run('object.reorder-to', ['brand', 'brand'], {
        position: 'after',
        copy: true,
        at: { left: 250.4, top: 220 },
      })
    );
    expect(h.writes()).toBe(1);
    const cards = [
      ...h.src().matchAll(/<div[^>]*>(Small apps|Product design|Brand systems)</g),
    ].map((m) => m[0]);
    const brands = cards.filter((c) => c.endsWith('Brand systems'));
    expect(brands).toHaveLength(2);
    expect(brands[0]).toMatch(/data-cd-id="brand"/);
    expect(brands[0]).not.toMatch(/left: "250px"/); // the original stays put
    expect(brands[1]).toMatch(/left: "250px"/);
    expect(brands[1]).toMatch(/top: "220px"/);
    expect(brands[1]).not.toMatch(/data-cd-id="brand"/);
  });

  test('r1 #15 — next to itself is still refused without a copy and a place; a place without a copy too', async () => {
    const h = home();
    expect(
      bad(await h.run('object.reorder-to', ['brand', 'brand'], { position: 'after', copy: true }))
        .code
    ).toBe('invalid');
    expect(
      bad(
        await h.run('object.reorder-to', ['brand', 'apps'], {
          position: 'after',
          at: { left: 1, top: 2 },
        })
      ).code
    ).toBe('invalid');
    expect(h.src()).toBe(HOME);
  });

  test('a card cannot be moved into itself', async () => {
    const h = home();
    expect(
      bad(await h.run('object.reorder-to', ['services', 'apps'], { position: 'inside-end' })).code
    ).toBe('invalid');
    expect(h.src()).toBe(HOME);
  });

  test('an unknown position is refused', async () => {
    const h = home();
    expect(
      bad(await h.run('object.reorder-to', ['apps', 'brand'], { position: 'sideways' })).code
    ).toBe('invalid');
  });

  test('reorder-to needs the neighbour as a second target', async () => {
    const h = home();
    expect(bad(await h.run('object.reorder-to', ['apps'], { position: 'before' })).code).toBe(
      'invalid'
    );
  });
});
