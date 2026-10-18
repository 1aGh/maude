// S11.6 — `maude design canvas-errors` / `canvas-source` (bin/_canvas-errors.mjs) ≡ the routes.
// One local studio: the verb's `--json` is the route's answer plus the untrusted marker; the text
// form prints `ui/Broken.tsx:6:20 SyntaxError: …` inside the untrusted block; `--artboard` prints
// that artboard's numbered lines.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { formatError } from '../bin/_canvas-errors.mjs';
import { type CanvasError, formatCanvasError } from '../canvas-source/errors.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SHIM = join(import.meta.dir, '..', 'bin', '_canvas-errors.mjs');
const SOURCE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Pricing() {
  return (
    <DesignCanvas>
      <DCArtboard id="free" label="Free" width={400} height={300}>
        <main />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const BROKEN = SOURCE.replace('<main />', '  <p>{price)</p>');

const procs: Subprocess[] = [];
let root = '';
let base = '';
beforeAll(async () => {
  const s = makeSandbox();
  root = s.root;
  writeFileSync(join(s.designRoot, 'ui', 'Pricing.tsx'), SOURCE);
  writeFileSync(join(s.designRoot, 'ui', 'Broken.tsx'), BROKEN);
  const port = nextPort();
  procs.push(await bootServer(s.root, port, { MAUDE_NO_AUTOBUILD: '1' }));
  base = `http://localhost:${port}`;
});
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function verb(...args: string[]) {
  const p = Bun.spawn(['bun', SHIM, ...args, '--root', root], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, code };
}

const strip = (j: Record<string, unknown>) => {
  const { untrusted, notice, ...rest } = j;
  expect(untrusted).toBe(true);
  expect(typeof notice).toBe('string');
  return rest;
};

describe('the verb answers what the route answers', () => {
  test('canvas-errors --json ≡ GET /_api/canvas-errors (all, and one canvas)', async () => {
    const all = await verb('errors', '--json');
    expect(all.code).toBe(0);
    expect(strip(JSON.parse(all.out))).toEqual(
      await (await fetch(`${base}/_api/canvas-errors`)).json()
    );
    const one = await verb('errors', 'ui/Broken.tsx', '--json');
    expect(strip(JSON.parse(one.out))).toEqual(
      await (await fetch(`${base}/_api/canvas-errors?canvas=.design/ui/Broken.tsx`)).json()
    );
  }, 30000);

  test('canvas-errors prints file:line:column inside the untrusted block', async () => {
    const r = await verb('errors');
    expect(r.code).toBe(0);
    expect(r.out).toContain('<<<BEGIN UNTRUSTED DATA');
    expect(r.out).toContain('ui/Broken.tsx:6:20 SyntaxError: Expected "}" but found ")"\n');
    expect(r.out).not.toContain('Pricing.tsx');
    const clean = await verb('errors', 'ui/Pricing.tsx');
    expect(clean.out).toBe('no errors\n');
  }, 30000);

  test('canvas-source --json ≡ GET /_api/canvas-source; --artboard prints its numbered lines', async () => {
    const j = await verb('source', 'ui/Pricing.tsx', '--json');
    expect(strip(JSON.parse(j.out))).toEqual(
      await (await fetch(`${base}/_api/canvas-source?canvas=.design/ui/Pricing.tsx`)).json()
    );
    const a = await verb('source', 'ui/Pricing.tsx', '--artboard', 'free');
    expect(a.code).toBe(0);
    expect(a.out).toContain(
      '5        <DCArtboard id="free" label="Free" width={400} height={300}>\n6          <main />\n7        </DCArtboard>\n'
    );
    const none = await verb('source', 'ui/Pricing.tsx', '--artboard', 'ghost');
    expect(none.code).toBe(1);
    expect((await verb('source')).code).toBe(2);
    expect((await verb('errors', 'ui/a.css')).code).toBe(2);
  }, 30000);

  test("the verb's formatter is the module's", () => {
    const cases: CanvasError[] = [
      { kind: 'syntax', message: 'm', file: 'ui/a.tsx', line: 3, column: 4, lineText: 'x' },
      {
        kind: 'resolve',
        message: 'Could not resolve: "./x"',
        file: 'ui/b.tsx',
        line: 1,
        column: 15,
        lineText: '',
      },
      {
        kind: 'build',
        message: 'Build failed',
        file: 'ui/c.tsx',
        line: 0,
        column: 0,
        lineText: '',
      },
    ];
    for (const c of cases) expect(formatError(c)).toBe(formatCanvasError(c));
  });
});
