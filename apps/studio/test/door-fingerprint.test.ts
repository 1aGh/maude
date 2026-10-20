// S8.5b-1 — the file-hash check behind the cloud render door (contract S8.5b §6, threats T3/T7).
// The desktop lists what the canvas reads at SEND time; the hub judges that list against its own
// checkout, only over rels the session sees, so the answer is no oracle.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { closureFor } from '../access/closure.ts';
import { diskProjectReader } from '../access/request.ts';
import { resolveAccess, sees } from '../access/scope.ts';
import {
  closureFingerprint,
  type FingerprintEntry,
  judgeFreshness,
  MAX_BEHIND_NAMED,
  MAX_FINGERPRINT_ENTRIES,
  parseFingerprint,
} from '../exporters/door-fingerprint.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const FILES: Record<string, string> = {
  'config.json': JSON.stringify({ designSystems: [{ name: 'brand', path: 'system/brand' }] }),
  'ui/Hype.tsx': [
    `import { Card } from '../shared/Card';`,
    `import './Hype.css';`,
    `export default () => <><Card /><img src="assets/a1b2c3d4.png" /></>;`,
  ].join('\n'),
  'ui/Hype.meta.json': JSON.stringify({ designSystem: 'brand' }),
  'ui/Hype.css': '.h {}',
  'ui/Other.tsx': `import './other.css';\nexport default () => <div>other</div>;`,
  'ui/other.css': '.o {}',
  'shared/Card.tsx': `import './card.css';\nexport const Card = () => <b>card</b>;`,
  'shared/card.css': '.card {}',
  'shared/Secret.tsx': 'export const Secret = 1;',
  'system/brand/colors_and_type.css': ':root{--bg-0:#fff}',
  'assets/a1b2c3d4.png': 'PNG',
};

function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
}

const all = () => true;
const fp = (root: string, c: string | string[]) => {
  const r = closureFingerprint(root, c);
  if (!r.ok) throw new Error('too large');
  return r.expect;
};

let base: string;
let desk: string;
let cell: string;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 's85b1-'));
  desk = join(base, 'desk');
  cell = join(base, 'cell');
  writeTree(desk, FILES);
  writeTree(cell, FILES);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('closureFingerprint (desktop, at send time)', () => {
  test('the canvas, its sidecars, imports, DS and assets — code by hash, a content-addressed asset by presence', () => {
    const list = fp(desk, 'ui/Hype.tsx');
    const by = new Map(list.map((e) => [e.rel, e.sha256]));
    expect(by.get('ui/Hype.tsx')).toBe(sha(FILES['ui/Hype.tsx'] as string));
    expect(by.get('shared/Card.tsx')).toBe(sha(FILES['shared/Card.tsx'] as string));
    expect(by.has('shared/card.css')).toBe(true);
    expect(by.has('ui/Hype.css')).toBe(true);
    expect(by.has('system/brand/colors_and_type.css')).toBe(true);
    expect(by.get('assets/a1b2c3d4.png')).toBeNull();
    expect(by.has('ui/Other.tsx')).toBe(false);
    expect(by.has('shared/Secret.tsx')).toBe(false);
    expect(list.map((e) => e.rel)).toEqual([...list.map((e) => e.rel)].sort());
  });

  test('a folder is the union of its canvases', () => {
    const rels = fp(desk, ['ui/Hype.tsx', 'ui/Other.tsx']).map((e) => e.rel);
    expect(rels).toContain('ui/other.css');
    expect(rels).toContain('shared/Card.tsx');
  });

  test(`over ${MAX_FINGERPRINT_ENTRIES} entries: too large (render it on this Mac)`, () => {
    const big = join(base, 'big');
    const n = MAX_FINGERPRINT_ENTRIES + 5;
    const imports = Array.from({ length: n }, (_, i) => `import './p/s${i}.css';`).join('\n');
    writeTree(big, { 'ui/Big.tsx': `${imports}\nexport default () => null;` });
    mkdirSync(join(big, 'ui/p'), { recursive: true });
    for (let i = 0; i < n; i++) writeFileSync(join(big, `ui/p/s${i}.css`), '');
    const r = closureFingerprint(big, 'ui/Big.tsx');
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe('too-large');
  });
});

describe('judgeFreshness (hub, against its checkout)', () => {
  test('in sync: ok', () => {
    expect(judgeFreshness(fp(desk, 'ui/Hype.tsx'), { root: cell, visible: all })).toEqual({
      ok: true,
    });
  });

  test('a shared module edited on this Mac and not yet up: behind names exactly it', () => {
    writeFileSync(
      join(desk, 'shared/Card.tsx'),
      `import './card.css';\nexport const Card = () => <i/>;`
    );
    expect(judgeFreshness(fp(desk, 'ui/Hype.tsx'), { root: cell, visible: all })).toEqual({
      ok: false,
      behind: ['shared/Card.tsx'],
    });
    writeFileSync(join(cell, 'shared/Card.tsx'), readFileSync(join(desk, 'shared/Card.tsx')));
    expect(judgeFreshness(fp(desk, 'ui/Hype.tsx'), { root: cell, visible: all }).ok).toBe(true);
  });

  test("a teammate's edit outside the closure never blocks", () => {
    writeFileSync(join(cell, 'ui/Other.tsx'), 'export default () => <div>teammate</div>;');
    expect(judgeFreshness(fp(desk, 'ui/Hype.tsx'), { root: cell, visible: all }).ok).toBe(true);
  });

  test('a new import and a new asset made offline are behind until they arrive', () => {
    writeFileSync(
      join(desk, 'ui/Hype.tsx'),
      `import { Card } from '../shared/Card';\nimport { Badge } from '../shared/Badge';\nimport './Hype.css';\nexport default () => <><Card /><Badge /><img src="assets/a1b2c3d4.png" /><img src="assets/feedface.png" /></>;`
    );
    writeFileSync(join(desk, 'shared/Badge.tsx'), 'export const Badge = () => null;');
    writeFileSync(join(desk, 'assets/feedface.png'), 'PNG2');
    const r = judgeFreshness(fp(desk, 'ui/Hype.tsx'), { root: cell, visible: all });
    expect(r.ok ? [] : [...r.behind].sort()).toEqual(
      ['assets/feedface.png', 'shared/Badge.tsx', 'ui/Hype.tsx'].sort()
    );
  });

  test('T7 no oracle: a canvas-only session probing outside its closure hears nothing', () => {
    const access = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/Hype.tsx', r: 'member' }] });
    const cl = closureFor(
      access,
      diskProjectReader(cell, () => 'h')
    );
    const visible = (rel: string) => sees(access, cl, rel);
    const probe: FingerprintEntry[] = [
      { rel: 'shared/Secret.tsx', sha256: 'f'.repeat(64) }, // exists, outside the closure
      { rel: 'shared/Nope.tsx', sha256: 'f'.repeat(64) }, // does not exist at all
    ];
    expect(judgeFreshness(probe, { root: cell, visible })).toEqual({ ok: true });
    expect(
      judgeFreshness([{ rel: 'ui/Hype.css', sha256: 'e'.repeat(64) }], { root: cell, visible })
    ).toEqual({ ok: false, behind: ['ui/Hype.css'] });
  });

  test('a rel that climbs out, is absolute, or names runtime state is skipped unread', () => {
    writeFileSync(join(base, 'outside.txt'), 'secret');
    mkdirSync(join(cell, '_chat'), { recursive: true });
    writeFileSync(join(cell, '_chat/log.json'), '{}');
    const probe: FingerprintEntry[] = [
      { rel: '../outside.txt', sha256: 'f'.repeat(64) },
      { rel: join(base, 'outside.txt'), sha256: 'f'.repeat(64) },
      { rel: 'ui/../../outside.txt', sha256: 'f'.repeat(64) },
      { rel: '_chat/log.json', sha256: 'f'.repeat(64) },
      { rel: 'ui\\Hype.css', sha256: 'f'.repeat(64) },
    ];
    expect(judgeFreshness(probe, { root: cell, visible: all })).toEqual({ ok: true });
  });

  test('a symlink out of the checkout answers like a missing file (never read through)', () => {
    const outside = join(base, 'linked.css');
    writeFileSync(outside, '.x{}');
    symlinkSync(outside, join(cell, 'ui/linked.css'));
    expect(
      judgeFreshness([{ rel: 'ui/linked.css', sha256: sha('.x{}') }], { root: cell, visible: all })
    ).toEqual({ ok: false, behind: ['ui/linked.css'] });
  });

  test(`behind names at most ${MAX_BEHIND_NAMED}`, () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ rel: `ui/x${i}.css`, sha256: null }));
    const r = judgeFreshness(many, { root: cell, visible: all });
    expect(r.ok ? 0 : r.behind.length).toBe(MAX_BEHIND_NAMED);
  });
});

describe('parseFingerprint (the untrusted body)', () => {
  test('a well-formed list passes through', () => {
    const ok = [
      { rel: 'ui/a.tsx', sha256: 'a'.repeat(64) },
      { rel: 'assets/a1b2c3d4.png', sha256: null },
    ];
    expect(parseFingerprint(ok)).toEqual(ok);
  });
  test('anything else is refused whole', () => {
    for (const bad of [
      null,
      'x',
      {},
      [{ rel: 'a' }],
      [{ rel: 'a', sha256: 'A'.repeat(64) }],
      [{ rel: 'a', sha256: 'a'.repeat(63) }],
      [{ rel: '', sha256: null }],
      [{ rel: 'a', sha256: null, extra: 1 }],
      [
        { rel: 'a', sha256: null },
        { rel: 'a', sha256: null },
      ],
      [{ rel: 'x'.repeat(513), sha256: null }],
      Array.from({ length: MAX_FINGERPRINT_ENTRIES + 1 }, (_, i) => ({
        rel: `r${i}`,
        sha256: null,
      })),
    ]) {
      expect(parseFingerprint(bad)).toBeNull();
    }
  });
});

test('the hub can import it: Node strip-only TypeScript loads the module and judges', () => {
  const mod = join(import.meta.dir, '..', 'exporters', 'door-fingerprint.ts');
  const script = `const m = await import(${JSON.stringify(mod)});
const r = m.judgeFreshness([{ rel: 'ui/Hype.css', sha256: null }], { root: ${JSON.stringify(cell)}, visible: () => true });
console.log(JSON.stringify(r));`;
  const p = Bun.spawnSync(['node', '--input-type=module', '-e', script], { stderr: 'pipe' });
  expect(p.stderr.toString()).not.toContain('Error');
  expect(JSON.parse(p.stdout.toString().trim())).toEqual({ ok: true });
});
