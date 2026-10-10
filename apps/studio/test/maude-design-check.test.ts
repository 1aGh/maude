// V2-2.4b — `maude design check` (contract V2-1.11 §5.2/§5.3, V2-1.18 §5.3): validate the files
// Claude writes, by kind. Exit 0 ok · 1 errors (`[code] where · what · fix`) · 2 usage.
// Red first: no check module, no verb.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ID_CHECK_SOURCE } from '../check/ids.ts';
import { checkFile, formatFindings, kindOf } from '../check/index.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const MAUDE = join(ROOT, 'cli', 'bin', 'maude.mjs');

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" width={800} height={600}><h1 data-cd-id="title">Hi</h1></DCArtboard>
      <DCArtboard id="pricing" width={800} height={600}><p>x</p></DCArtboard>
    </DesignCanvas>
  );
}
`;

describe('kindOf — the V2-1.18 §5.3 dispatch by path', () => {
  test.each([
    ['ui/Pricing.tsx', 'canvas-tsx'],
    ['ui/Pricing.annotations.json', 'annotations'],
    ['ui/Pricing.meta.json', 'canvas-meta'],
    ['ui/cut.edl.json', 'edl'],
    ['assets/a.footage.json', 'footage'],
    ['assets/a.photo.json', 'photo-edit'],
    ['config.json', 'design-config'],
    ['system/acme/tokens.json', 'ds'],
    ['system/acme/colors_and_type.css', 'ds'],
    ['system/acme/revisions/3.json', 'ds-managed'],
    ['system/acme/head.json', 'ds-managed'],
    ['system/acme/preview/button.tsx', 'skip'],
    ['_runs/r_abcd/handoff/board-reader-0.out.json', 'handoff'],
    ['_runs/r_abcd/run.json', 'skip'],
    ['_history/x/1.tsx', 'skip'],
    ['ui/notes.md', 'skip'],
    ['ui/data.json', 'json'],
  ])('%s → %s', (rel, kind) => expect(kindOf(rel)).toBe(kind as ReturnType<typeof kindOf>));
});

describe('checkFile', () => {
  test('a clean canvas is ok', () => {
    const r = checkFile('ui/C.tsx', CANVAS, { strict: true });
    expect({ ok: r.ok, errors: r.errors }).toEqual({ ok: true, errors: [] });
    expect(r.kind).toBe('canvas-tsx');
  });

  test('a canvas that no longer parses is an error with a line', () => {
    const r = checkFile('ui/C.tsx', CANVAS.replace('</h1>', '</h2>'), { strict: true });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('parse');
    expect(r.errors[0]?.where).toMatch(/^ui\/C\.tsx:\d+$/);
  });

  test('duplicate / missing / computed DCArtboard ids are errors', () => {
    const dup = checkFile('ui/C.tsx', CANVAS.replace('id="pricing"', 'id="hero"'));
    expect(dup.errors.map((e) => e.code)).toEqual(['artboard-duplicate']);
    expect(dup.errors[0]?.where).toBe('ui/C.tsx:6 #hero');
    const none = checkFile('ui/C.tsx', CANVAS.replace(' id="pricing"', ''));
    expect(none.errors.map((e) => e.code)).toEqual(['artboard-id-missing']);
    const expr = checkFile('ui/C.tsx', CANVAS.replace('id="pricing"', 'id={name}'));
    expect(expr.errors.map((e) => e.code)).toEqual(['artboard-id-expression']);
  });

  test('a board the lenient loader drops from: error when strict, warning when not', () => {
    const board = JSON.stringify({
      format: 'maude.annotations',
      v: 2,
      elements: [{ id: 'x', type: 'sticky' }],
    });
    const strict = checkFile('ui/C.annotations.json', board, { strict: true });
    const lenient = checkFile('ui/C.annotations.json', board, { strict: false });
    expect(strict.ok).toBe(false);
    expect(strict.errors.length).toBeGreaterThan(0);
    expect(lenient.ok).toBe(true);
    expect(lenient.warnings.length).toBeGreaterThan(0);
  });

  test('canvas-meta: JSON object, no viewport (DDR-115)', () => {
    expect(checkFile('ui/C.meta.json', '{"layout":{}}').ok).toBe(true);
    expect(checkFile('ui/C.meta.json', '{"viewport":{"x":0}}').errors[0]?.code).toBe(
      'meta-viewport'
    );
    expect(checkFile('ui/C.meta.json', '{nope').errors[0]?.code).toBe('json');
  });

  test('a hand-off declares the contract and the role its name says', () => {
    const rel = '_runs/r_abcd/handoff/board-reader-0.out.json';
    expect(checkFile(rel, '{"contract":"maude.agent-handoff/1","role":"out"}').ok).toBe(true);
    expect(checkFile(rel, '{"contract":"maude.agent-handoff/1","role":"in"}').ok).toBe(false);
  });

  test('a DS-managed file is refused; runtime and unknown files are skipped', () => {
    expect(checkFile('system/acme/head.json', '{}').errors[0]?.code).toBe('ds-managed');
    expect(checkFile('_history/x.tsx', 'not tsx at all <').ok).toBe(true);
    expect(checkFile('ui/notes.md', '# x').kind).toBe('skip');
  });

  test('the fast tier fits its budget on a large canvas (≤ 300 ms of the 1.5 s)', () => {
    const big = CANVAS.replace(
      '<p>x</p>',
      Array.from({ length: 2000 }, (_, i) => `<div data-cd-id="e-${i}">${i}</div>`).join('\n')
    );
    const r = checkFile('ui/Big.tsx', big, { strict: true, tier: 'fast' });
    expect(r.ok).toBe(true);
    expect(r.ms).toBeLessThan(300);
  });

  test('formatFindings prints `error [code] where · what · fix`', () => {
    const r = checkFile('ui/C.meta.json', '{"viewport":{}}');
    expect(formatFindings([r])).toMatch(
      /^error \[meta-viewport\] ui\/C\.meta\.json › viewport · .+ · remove `viewport`$/
    );
  });

  // V2-2.19's checkIds (element-ids.ts) is the V2-1.4 id check: id-lost vs the pre-edit snapshot
  // blocks, id-duplicate blocks one-sided, and without a snapshot nothing is diffed.
  test('the id check is V2-2.19 checkIds (element-ids.ts)', () => {
    expect(ID_CHECK_SOURCE).toBe('element-ids');
    const codes = (r: ReturnType<typeof checkFile>) => [...new Set(r.errors.map((e) => e.code))];
    const lost = CANVAS.replace('<h1 data-cd-id="title">', '<h1>');
    const r = checkFile('ui/C.tsx', lost, { against: CANVAS });
    expect(codes(r)).toEqual(['id-lost']);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.element).toMatchObject({ tag: 'h1', artboard: 'hero' });
    expect(checkFile('ui/C.tsx', lost).ok).toBe(true);
    const dup = CANVAS.replace('<p>x</p>', '<p data-cd-id="title">x</p>');
    expect(codes(checkFile('ui/C.tsx', dup))).toEqual(['id-duplicate']);
  });
});

describe('`maude design check` (the verb)', () => {
  let project: string;
  beforeAll(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), 'maude-check-')));
    mkdirSync(join(project, '.design', 'ui'), { recursive: true });
    writeFileSync(join(project, '.design', 'config.json'), '{}');
    writeFileSync(join(project, '.design', 'ui', 'Good.tsx'), CANVAS);
    writeFileSync(
      join(project, '.design', 'ui', 'Bad.tsx'),
      CANVAS.replace('id="pricing"', 'id="hero"')
    );
    writeFileSync(join(project, '.design', 'ui', 'Before.tsx'), CANVAS);
  });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  const run = (...a: string[]) =>
    Bun.spawnSync(['node', MAUDE, 'design', 'check', ...a, '--root', project], {
      env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1', CLAUDE_PROJECT_DIR: '' },
    });

  test('ok → 0; errors → 1 with `[code] where · what · fix`; usage → 2', () => {
    expect(run('ui/Good.tsx').exitCode).toBe(0);
    const bad = run('ui/Bad.tsx');
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout.toString()).toContain('error [artboard-duplicate] ui/Bad.tsx:6 #hero · ');
    expect(run().exitCode).toBe(2);
    expect(run('ui/Missing.tsx').exitCode).toBe(2);
    expect(run('ui/Good.tsx', '--tier', 'slow').exitCode).toBe(2);
    expect(
      run('ui/Good.tsx', 'ui/Bad.tsx', '--against', join(project, '.design/ui/Before.tsx')).exitCode
    ).toBe(2);
  });

  test('--json is the V2-1.18 §5.3 row shape; .design/-prefixed paths work', () => {
    const r = run('.design/ui/Bad.tsx', 'ui/Good.tsx', '--json', '--strict');
    expect(r.exitCode).toBe(1);
    const rows = JSON.parse(r.stdout.toString()) as Record<string, unknown>[];
    expect(rows.map((x) => [x.file, x.kind, x.ok])).toEqual([
      ['ui/Bad.tsx', 'canvas-tsx', false],
      ['ui/Good.tsx', 'canvas-tsx', true],
    ]);
    expect(Object.keys(rows[0] as object).sort()).toEqual(
      ['errors', 'file', 'infos', 'kind', 'ms', 'ok', 'warnings'].sort()
    );
  });

  test('--help exits 0', () => {
    const r = Bun.spawnSync(['node', MAUDE, 'design', 'check', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain('maude design check');
  });
});
