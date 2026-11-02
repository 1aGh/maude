// S11.6 — canvas-source/errors.ts + canvas-build.ts's typed throw. Three broken canvases and the
// positions they report: a syntax error (Bun's parser), a syntax error after non-ASCII text on the
// same line (UTF-16 column), an import that does not resolve (Bun.build → CanvasBuildError), and an
// import the allowlist refuses (message kept, no absolute path in the structured half).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCanvasModule } from '../canvas-build.ts';
import { TranspileError } from '../canvas-pipeline.ts';
import {
  CanvasBuildError,
  canvasErrorOf,
  canvasSourceSig,
  checkCanvasSyntax,
  formatCanvasError,
  recalledCanvasError,
  recordCanvasBuild,
  scrubPaths,
} from '../canvas-source/errors.ts';

const root = mkdtempSync(join(tmpdir(), 'canvas-errors-'));
const designRoot = join(root, '.design');
mkdirSync(join(designRoot, 'ui'), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PRICING = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Pricing() {
  return (
    <DesignCanvas>
      <DCArtboard id="free" label="Free" width={400} height={300}>
        <p>{price)</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

describe('checkCanvasSyntax — the file as it is on disk', () => {
  test("a syntax error: Bun's message, the 1-based line and column, the line itself", () => {
    const canvasAbs = join(designRoot, 'ui', 'Pricing.tsx');
    const e = checkCanvasSyntax(PRICING, { designRoot, canvasAbs });
    expect(e).toEqual({
      kind: 'syntax',
      message: 'Expected "}" but found ")"',
      file: 'ui/Pricing.tsx',
      line: 6,
      column: 18,
      lineText: '        <p>{price)</p>',
    });
    expect(formatCanvasError(e!)).toBe(
      'ui/Pricing.tsx:6:18 SyntaxError: Expected "}" but found ")"'
    );
  });

  test('non-ASCII text before the error on the same line: the column is what an editor shows', () => {
    const src = 'export default () => (\n  <p>😀 é {x)</p>\n);\n';
    const e = checkCanvasSyntax(src, { designRoot, canvasAbs: join(designRoot, 'ui', 'E.tsx') });
    // `  <p>😀 é {x)` — the `)` is the 13th UTF-16 unit (the emoji is two).
    expect(e).toMatchObject({ kind: 'syntax', line: 2, column: 13, lineText: '  <p>😀 é {x)</p>' });
    expect([...'  <p>😀 é {x)'].length).toBe(12);
    expect('  <p>😀 é {x)'.length).toBe(13);
  });

  test('a canvas that parses has no error', () => {
    const ok = PRICING.replace('{price)', '{price}');
    expect(
      checkCanvasSyntax(ok, { designRoot, canvasAbs: join(designRoot, 'ui', 'P.tsx') })
    ).toBeNull();
  });

  test("pass 1's TranspileError converts through the same check", () => {
    const canvasAbs = join(designRoot, 'ui', 'Pricing.tsx');
    const err = new TranspileError('oxc-parser failed', { canvas: canvasAbs, byte: 0 });
    expect(canvasErrorOf(err, { designRoot, canvasAbs, source: PRICING })).toMatchObject({
      kind: 'syntax',
      line: 6,
      column: 18,
    });
  });
});

describe('buildCanvasModule throws CanvasBuildError (Bun.build positions)', () => {
  test('an import that does not resolve: kind resolve, the import line', async () => {
    const canvasAbs = join(designRoot, 'ui', 'Missing.tsx');
    const src = `import { DCArtboard } from '@maude/canvas-lib';\nimport Card from './nope-card';\nexport default () => <DCArtboard id="a"><Card /></DCArtboard>;\n`;
    writeFileSync(canvasAbs, src);
    let caught: unknown;
    try {
      await buildCanvasModule(canvasAbs, src, { designRoot, restrictImportsTo: designRoot });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanvasBuildError);
    const e = (caught as CanvasBuildError).errors[0]!;
    expect(e).toMatchObject({
      file: 'ui/Missing.tsx',
      line: 2,
      lineText: "import Card from './nope-card';",
    });
    expect(e.column).toBe(18);
    expect(e.message).toContain('nope-card');
    expect(JSON.stringify((caught as CanvasBuildError).errors)).not.toContain(root);
    expect(canvasErrorOf(caught, { designRoot, canvasAbs, source: src })).toEqual(e);
  });

  test('an import the allowlist refuses: the old message, a positioned error, no absolute path', async () => {
    const canvasAbs = join(designRoot, 'ui', 'Escape.tsx');
    const src = `import secret from '../../outside.txt';\nexport default () => <p>{String(secret)}</p>;\n`;
    writeFileSync(canvasAbs, src);
    writeFileSync(join(root, 'outside.txt'), 'nope');
    let caught: unknown;
    try {
      await buildCanvasModule(canvasAbs, src, { designRoot, restrictImportsTo: designRoot });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanvasBuildError);
    const err = caught as CanvasBuildError;
    expect(err.rejectedImports).toBe(1);
    expect(err.message.length).toBeGreaterThan(0);
    const e = err.errors[0]!;
    expect(e.file).toBe('ui/Escape.tsx');
    expect(JSON.stringify(err.errors)).not.toContain(root);
  });
});

describe('the recorded live-build error', () => {
  test('is recalled only while the source is still the one that failed', () => {
    const abs = join(designRoot, 'ui', 'R.tsx');
    const e = {
      kind: 'resolve' as const,
      message: 'x',
      file: 'ui/R.tsx',
      line: 1,
      column: 1,
      lineText: '',
    };
    recordCanvasBuild(abs, canvasSourceSig('a'), e);
    expect(recalledCanvasError(abs, canvasSourceSig('a'))).toEqual(e);
    expect(recalledCanvasError(abs, canvasSourceSig('b'))).toBeNull();
    recordCanvasBuild(abs, canvasSourceSig('a'), null);
    expect(recalledCanvasError(abs, canvasSourceSig('a'))).toBeNull();
  });

  test('scrubPaths keeps a design-root path relative and drops any other absolute path to its name', () => {
    expect(
      scrubPaths(
        `"x" is imported from ${join(designRoot, 'ui', 'a.tsx')} and /etc/hosts`,
        designRoot
      )
    ).toBe('"x" is imported from ui/a.tsx and hosts');
  });
});
