// S2.7 (ed-obj-multi) — align / distribute / rotate as edit-ops through the real dispatcher:
// goldens (the route result ≡ the documented file edit, rule 14), the refusals, and that a locked
// object is never moved. The canvas half (bar, handle, artboards) is test/edit-multi-client.test.tsx.

import { describe, expect, test } from 'bun:test';

import { readAttributeState } from '../canvas-edit.ts';
import { type DispatchDeps, dispatchEditOp, EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { rotationOf } from '../edit-ops/words-css.ts';

const FILE = 'ui/Post.tsx';

// Three freely placed objects (Titulek, Podtitulek, ZAPIŠ SE): one line each, so a golden is a
// one-token replace of this text.
const POST = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="post" label="Post" width={1080} height={1080}>
        <h1 data-cd-id="title" style={{ position: "absolute", left: "64px", top: "100px", width: 900, height: 80 }}>Titulek</h1>
        <p data-cd-id="sub" style={{ position: "absolute", left: "70px", top: "200px", width: 600, height: 40 }}>Podtitulek</p>
        <a data-cd-id="btn" style={{ position: "absolute", left: "64px", top: "300px", width: 300, height: 60 }}>ZAPIŠ SE</a>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const POST_ITEMS = [
  { x: 64, y: 100, w: 900, h: 80, left: 64, top: 100 },
  { x: 70, y: 200, w: 600, h: 40, left: 70, top: 200 },
  { x: 64, y: 300, w: 300, h: 60, left: 64, top: 300 },
];

// Three boxes with unequal gaps, for distribute.
const ROW = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Row() {
  return (
    <DesignCanvas>
      <DCArtboard id="row" label="Row" width={800} height={600}>
        <i data-cd-id="a" style={{ position: "absolute", left: "0px", top: "0px", width: 100, height: 50 }} />
        <i data-cd-id="b" style={{ position: "absolute", left: "130px", top: "60px", width: 100, height: 50 }} />
        <i data-cd-id="c" style={{ position: "absolute", left: "400px", top: "300px", width: 100, height: 50 }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const ROW_ITEMS = [
  { x: 0, y: 0, w: 100, h: 50, left: 0, top: 0 },
  { x: 130, y: 60, w: 100, h: 50, left: 130, top: 60 },
  { x: 400, y: 300, w: 100, h: 50, left: 400, top: 300 },
];

function harness(initial: string, artboard: string) {
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
        targets: targets.map((element) => ({ artboard, element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  return { files, run, src: () => files.get(FILE) as string };
}
const post = () => harness(POST, 'post');
const row = () => harness(ROW, 'row');

const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const bad = (r: EditOpResult) => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const T3 = ['title', 'sub', 'btn'];

describe('the op table', () => {
  test('every S2.7 op is registered under its registry id', () => {
    const have = new Set(EDIT_OPS.map((o) => o.id));
    for (const id of [
      'align.left',
      'align.hcentre',
      'align.right',
      'align.top',
      'align.vmiddle',
      'align.bottom',
      'distribute.h',
      'distribute.v',
      'object.rotate',
    ])
      expect(have.has(id)).toBe(true);
  });
});

describe('align goldens (the selection’s own bounds are the reference)', () => {
  test('align.left: Podtitulek, 6 px off, joins the others at 64', async () => {
    const h = post();
    good(await h.run('align.left', T3, { items: POST_ITEMS }));
    expect(h.src()).toBe(POST.replace('left: "70px"', 'left: "64px"'));
  });
  test('align.right: everything ends at the widest right edge, 964', async () => {
    const h = post();
    good(await h.run('align.right', T3, { items: POST_ITEMS }));
    expect(h.src()).toBe(
      POST.replace('left: "70px"', 'left: "364px"').replace(
        'left: "64px", top: "300px"',
        'left: "664px", top: "300px"'
      )
    );
  });
  test('align.hcentre: shares the centre of the selection, 514', async () => {
    const h = post();
    good(await h.run('align.hcentre', T3, { items: POST_ITEMS }));
    expect(h.src()).toBe(
      POST.replace('left: "70px"', 'left: "214px"').replace(
        'left: "64px", top: "300px"',
        'left: "364px", top: "300px"'
      )
    );
  });
  test('align.top: all at the highest top, 100; left is never touched', async () => {
    const h = post();
    good(await h.run('align.top', T3, { items: POST_ITEMS }));
    expect(h.src()).toBe(
      POST.replace('top: "200px"', 'top: "100px"').replace('top: "300px"', 'top: "100px"')
    );
  });
  test('align.bottom: all end at 360', async () => {
    const h = post();
    good(await h.run('align.bottom', T3, { items: POST_ITEMS }));
    expect(h.src()).toBe(
      POST.replace('top: "100px"', 'top: "280px"').replace('top: "200px"', 'top: "320px"')
    );
  });
  test('align.vmiddle: shares the middle of the selection, 230', async () => {
    const h = post();
    good(await h.run('align.vmiddle', T3, { items: POST_ITEMS }));
    expect(h.src()).toBe(
      POST.replace('top: "100px"', 'top: "190px"')
        .replace('top: "200px"', 'top: "210px"')
        .replace('top: "300px"', 'top: "200px"')
    );
  });
  test('an already aligned selection writes nothing', async () => {
    const h = post();
    const r = good(
      await h.run('align.left', ['title', 'btn'], { items: [POST_ITEMS[0], POST_ITEMS[2]] })
    );
    expect(r.actionId).toBeNull();
    expect(h.src()).toBe(POST);
  });
  test('a position given in the style of a class (no inline left) gets one written', async () => {
    const src = POST.replace('left: "70px", ', '');
    const h = harness(src, 'post');
    good(await h.run('align.left', T3, { items: POST_ITEMS }));
    expect(h.src()).toContain('left: "64px"');
  });
});

describe('distribute goldens (first and last stay, the middle takes equal gaps)', () => {
  test('distribute.h: b moves from 130 to 200 and keeps its top', async () => {
    const h = row();
    good(await h.run('distribute.h', ['a', 'b', 'c'], { items: ROW_ITEMS }));
    expect(h.src()).toBe(ROW.replace('left: "130px"', 'left: "200px"'));
  });
  test('distribute.v: b moves from 60 to 150 and keeps its left', async () => {
    const h = row();
    good(await h.run('distribute.v', ['a', 'b', 'c'], { items: ROW_ITEMS }));
    expect(h.src()).toBe(ROW.replace('top: "60px"', 'top: "150px"'));
  });
  test('selection order does not matter, the order on the canvas does', async () => {
    const h = row();
    good(
      await h.run('distribute.h', ['c', 'a', 'b'], {
        items: [ROW_ITEMS[2], ROW_ITEMS[0], ROW_ITEMS[1]],
      })
    );
    expect(h.src()).toBe(ROW.replace('left: "130px"', 'left: "200px"'));
  });
});

describe('align / distribute refusals', () => {
  test('one object is not enough to align, two are not enough to distribute', async () => {
    expect(bad(await post().run('align.left', ['title'], { items: [POST_ITEMS[0]] })).code).toBe(
      'invalid'
    );
    expect(
      bad(await post().run('distribute.h', ['title', 'sub'], { items: POST_ITEMS.slice(0, 2) }))
        .code
    ).toBe('invalid');
  });
  test('items must line up with the targets and be plain numbers', async () => {
    const h = post();
    expect(bad(await h.run('align.left', T3, { items: POST_ITEMS.slice(0, 2) })).code).toBe(
      'invalid'
    );
    expect(bad(await h.run('align.left', T3)).code).toBe('invalid');
    const nan = POST_ITEMS.map((i) => ({ ...i }));
    (nan[1] as { x: number }).x = Number.NaN;
    expect(bad(await h.run('align.left', T3, { items: nan })).code).toBe('invalid');
    const text = POST_ITEMS.map((i) => ({ ...i, left: '64px' }));
    expect(bad(await h.run('align.left', T3, { items: text })).code).toBe('invalid');
    expect(h.src()).toBe(POST);
  });
  test('a locked object is never moved', async () => {
    const h = harness(
      POST.replace('<p data-cd-id="sub"', '<p data-cd-id="sub" data-cd-locked'),
      'post'
    );
    const r = bad(await h.run('align.left', T3, { items: POST_ITEMS }));
    expect(r.code).toBe('locked');
  });
  test('a style the file computes cannot be written', async () => {
    const h = harness(
      POST.replace(
        'style={{ position: "absolute", left: "70px", top: "200px", width: 600, height: 40 }}',
        'style={dynamic}'
      ),
      'post'
    );
    const r = bad(await h.run('align.left', T3, { items: POST_ITEMS }));
    expect(r.code).toBe('invalid');
  });
});

// ── rotate ───────────────────────────────────────────────────────────────────────────────────────

const SPIN = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Spin() {
  return (
    <DesignCanvas>
      <DCArtboard id="spin" label="Spin" width={400} height={400}>
        <i data-cd-id="plain" style={{ position: "absolute", left: "10px" }} />
        <i data-cd-id="moved" style={{ transform: "translateX(4px) rotate(10deg)" }} />
        <i data-cd-id="bare" />
        <i data-cd-id="calc" style={{ transform: tilt }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const spin = () => harness(SPIN, 'spin');
const rotOf = (src: string, id: string) => {
  const s = readAttributeState(FILE, src, id, 'style.transform');
  return s.kind === 'literal' ? rotationOf(s.value) : s.kind === 'absent' ? 0 : Number.NaN;
};
const transformOf = (src: string, id: string) => {
  const s = readAttributeState(FILE, src, id, 'style.transform');
  return s.kind === 'literal' ? s.value : null;
};

describe('object.rotate', () => {
  test('degrees sets the rotation and adds a transform to an element without one', async () => {
    const h = spin();
    good(await h.run('object.rotate', ['plain'], { degrees: 15 }));
    expect(transformOf(h.src(), 'plain')).toBe('rotate(15deg)');
  });
  test('degrees keeps the rest of the transform', async () => {
    const h = spin();
    good(await h.run('object.rotate', ['moved'], { degrees: 45 }));
    expect(transformOf(h.src(), 'moved')).toBe('translateX(4px) rotate(45deg)');
  });
  test('by adds to what is already there', async () => {
    const h = spin();
    good(await h.run('object.rotate', ['moved'], { by: 5 }));
    expect(rotOf(h.src(), 'moved')).toBe(15);
    good(await h.run('object.rotate', ['bare', 'plain'], { by: -30 }));
    expect(rotOf(h.src(), 'bare')).toBe(-30);
    expect(rotOf(h.src(), 'plain')).toBe(-30);
  });
  test('0° takes the rotate out, and the whole transform when nothing else is left', async () => {
    const h = spin();
    good(await h.run('object.rotate', ['moved'], { degrees: 0 }));
    expect(transformOf(h.src(), 'moved')).toBe('translateX(4px)');
    good(await h.run('object.rotate', ['plain'], { degrees: 20 }));
    good(await h.run('object.rotate', ['plain'], { degrees: 0 }));
    expect(readAttributeState(FILE, h.src(), 'plain', 'style.transform').kind).toBe('absent');
    expect(h.src()).toContain('left: "10px"');
  });
  test('angles are kept in −180…180', async () => {
    const h = spin();
    good(await h.run('object.rotate', ['bare'], { degrees: 190 }));
    expect(rotOf(h.src(), 'bare')).toBe(-170);
    good(await h.run('object.rotate', ['bare'], { degrees: 180 }));
    expect(rotOf(h.src(), 'bare')).toBe(180);
    good(await h.run('object.rotate', ['bare'], { by: 360 }));
    expect(rotOf(h.src(), 'bare')).toBe(180);
  });
  test('rotating to the angle it already has writes nothing', async () => {
    const h = spin();
    const r = good(await h.run('object.rotate', ['moved'], { degrees: 10 }));
    expect(r.actionId).toBeNull();
    expect(h.src()).toBe(SPIN);
  });
  test('refusals: no angle, not a number, a computed transform', async () => {
    const h = spin();
    expect(bad(await h.run('object.rotate', ['bare'])).code).toBe('invalid');
    expect(bad(await h.run('object.rotate', ['bare'], { degrees: 'ninety' })).code).toBe('invalid');
    expect(bad(await h.run('object.rotate', ['bare'], { degrees: Number.NaN })).code).toBe(
      'invalid'
    );
    expect(bad(await h.run('object.rotate', ['calc'], { degrees: 10 })).code).toBe('invalid');
    expect(h.src()).toBe(SPIN);
  });
});
