// gate-b-c4h (defender round 3, M3) — a frame whose closure admits another canvas through the
// opener's access is READ-ONLY (unit halves; booted halves in c4h-import-read-only.test.ts).
//
// Mallory edits A but cannot see B; she adds `import B from './b.tsx'`; V (reads B) opens A. A's
// frame builds B into the module, and A's code could write B's content into A's Y-doc / meta /
// comments / board, where Mallory reads it. So that frame holds A at `observer`: read and the
// per-user camera, no write of any kind. A canvas importing only helpers stays editable.

import { describe, expect, test } from 'bun:test';

import { closureFor, importedCanvasReport, type ProjectReader } from '../access/closure.ts';
import { frameAccess, narrowToFrame } from '../access/frame.ts';
import { type Access, resolveAccess, writes } from '../access/scope.ts';

const FILES: Record<string, string> = {
  'ui/a.tsx': "import B from './b.tsx';\nexport default () => <B />;\n",
  'ui/a.meta.json': '{}',
  'ui/b.tsx': 'export default () => <p>CANARY-B</p>;\n',
  'ui/b.meta.json': '{}',
  // only a stylesheet of B — still B's (the same-name stylesheet rule)
  'ui/c.tsx': "import './b.css';\nexport default () => <p>C</p>;\n",
  'ui/b.css': '.b{}',
  // helpers, components, system: editable
  'ui/h.tsx':
    "import Btn from '../components/btn.tsx';\nimport '../system/ds/tokens.css';\nexport default () => <Btn />;\n",
  'components/btn.tsx': 'export default () => <button />;\n',
  'system/ds/tokens.css': ':root{}',
  // a canvas through a helper: still a canvas import
  'ui/d.tsx': "import W from '../components/wrap.tsx';\nexport default () => <W />;\n",
  'components/wrap.tsx': "import B from '../ui/b.tsx';\nexport default () => <B />;\n",
};

function project(files: Record<string, string>): ProjectReader {
  return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
}

const OWNER = resolveAccess({ v: 1, role: 'owner' });
const MEMBER = resolveAccess({ v: 1, role: 'member' });
/** A teammate holding A and B (Can edit both) — sees B, so A's frame admits it. */
const BOTH = resolveAccess({
  v: 1,
  role: null,
  grants: [
    { c: 'ui/a.tsx', r: 'member' },
    { c: 'ui/b.tsx', r: 'member' },
  ],
});
const closureOf = (a: Access) => closureFor(a, project(FILES));

// `request` (Ask to edit) stays with `observer`: no canvas-origin route takes it, and it is a plea, not a
// write the author could read.
const WRITE_CAPS = ['edit', 'annotate', 'comment', 'vote', 'export', 'trash', 'summon'] as const;

describe('closure.importedCanvases', () => {
  test("the owner's frame on A records B", () => {
    const c = closureFor(narrowToFrame(OWNER, ['ui/a.tsx']), project(FILES));
    expect([...c.importedCanvases]).toEqual(['ui/b.tsx']);
    expect(c.read.has('ui/b.tsx')).toBe(true); // A still renders
  });
  test('a stylesheet of B and a canvas reached through a helper count too', () => {
    for (const canvas of ['ui/c.tsx', 'ui/d.tsx'])
      expect([...closureOf(narrowToFrame(OWNER, [canvas])).importedCanvases]).toEqual(['ui/b.tsx']);
  });
  test('helpers, components and the system are not canvases', () => {
    expect(closureOf(narrowToFrame(OWNER, ['ui/h.tsx'])).importedCanvases.size).toBe(0);
  });
  test('a canvas the reader cannot see is not admitted, so not recorded', () => {
    const aOnly = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] });
    const c = closureOf(narrowToFrame(aOnly, ['ui/a.tsx']));
    expect(c.importedCanvases.size).toBe(0);
    expect(c.read.has('ui/b.tsx')).toBe(false);
  });
  test('a canvas inside the grant is not "outside" it', () => {
    expect(closureOf(BOTH).importedCanvases.size).toBe(0);
  });
});

describe('frameAccess — read-only when the closure admits another canvas', () => {
  for (const [who, base] of [
    ['owner (desktop)', OWNER],
    ['project member', MEMBER],
    ['member holding A and B', BOTH],
  ] as const) {
    test(`${who}: A's frame holds A at observer and says why`, () => {
      const f = frameAccess(base, ['ui/a.tsx'], closureOf);
      expect(f.readOnlyBecause).toEqual({ imports: ['ui/b.tsx'] });
      expect(f.grants).toEqual([{ c: 'ui/a.tsx', r: 'observer' }]);
      expect(f.can('read', 'ui/a.tsx')).toBe(true);
      expect(f.can('session', 'ui/a.tsx')).toBe(true); // the per-user camera
      for (const cap of WRITE_CAPS) {
        expect({ cap, a: f.can(cap, 'ui/a.tsx'), p: f.can(cap, null) }).toEqual({
          cap,
          a: false,
          p: false,
        });
      }
      // the owned files and a new asset: no write
      const c = closureOf(f) as NonNullable<ReturnType<typeof closureOf>>;
      for (const rel of ['ui/a.tsx', 'ui/a.meta.json', 'ui-a.annotations.json'])
        expect({ rel, w: writes(f, c, rel, { exists: true }) }).toEqual({ rel, w: false });
      expect(writes(f, c, 'assets/new0001.png', { exists: false })).toBe(false);
      // still the opener's question for reads
      expect(f.unnarrowed).toBe(base);
      expect(c.read.has('ui/b.tsx')).toBe(true);
    });
  }

  test('a frame whose imports are helpers stays editable', () => {
    const f = frameAccess(OWNER, ['ui/h.tsx'], closureOf);
    expect(f.readOnlyBecause).toBeUndefined();
    expect(f.can('edit', 'ui/h.tsx')).toBe(true);
    expect(f.grants).toEqual([{ c: 'ui/h.tsx', r: 'member' }]);
  });

  test('a frame-less request is unchanged (no grants, nothing to judge)', () => {
    const f = frameAccess(OWNER, null, closureOf);
    expect(f.grants).toEqual([]);
    expect(f.readOnlyBecause).toBeUndefined();
  });

  test('a viewer opener stays a viewer on a canvas without canvas imports', () => {
    const v = resolveAccess({ v: 1, role: 'viewer' });
    const f = frameAccess(v, ['ui/h.tsx'], closureOf);
    expect(f.can('comment', 'ui/h.tsx')).toBe(true);
    expect(frameAccess(v, ['ui/a.tsx'], closureOf).can('comment', 'ui/a.tsx')).toBe(false);
  });
});

describe('importedCanvasReport — what the shell reads', () => {
  const all = Object.keys(FILES).filter((f) => f.startsWith('ui/') && f.endsWith('.tsx'));
  test('the owner: A, C and D import B; B and H import no canvas', () => {
    const r = importedCanvasReport(project(FILES), all, (c) => OWNER.seesCanvas(c));
    expect(Object.fromEntries(r)).toEqual({
      'ui/a.tsx': ['ui/b.tsx'],
      'ui/c.tsx': ['ui/b.tsx'],
      'ui/d.tsx': ['ui/b.tsx'],
    });
  });
  test('agrees with the frame: every reported canvas opens read-only, the rest do not', () => {
    const r = importedCanvasReport(project(FILES), all, (c) => OWNER.seesCanvas(c));
    for (const canvas of all)
      expect({ canvas, ro: !!frameAccess(OWNER, [canvas], closureOf).readOnlyBecause }).toEqual({
        canvas,
        ro: r.has(canvas),
      });
  });
  test('a reader who cannot see B gets no entry naming B', () => {
    const r = importedCanvasReport(project(FILES), ['ui/a.tsx'], (c) => c === 'ui/a.tsx');
    expect(r.size).toBe(0);
  });
});
