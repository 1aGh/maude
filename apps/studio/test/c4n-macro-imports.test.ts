// gate-b-c4n — Bun runs a macro import at BUILD time. A canvas carrying
//   import { readFileSync } from 'node:fs' with { type: 'macro' };
// inlined any file on disk into its module (and a `node:child_process` / `writeFileSync` macro is
// code execution in the studio or the build sandbox). Every entry point that hands project text to
// Bun refuses it first (`macro-guard.ts`): the build's own source, every file the bundle loads, the
// identity pass's transpiler, the syntax check, the handoff import scan, and the sandbox worker (which runs the same build).
// Each case below proves the refusal AND that the macro never ran (no canary in any output, no
// marker file written).

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildCanvasModule } from '../canvas-build.ts';
import { buildCanvasSandboxed } from '../canvas-build-sandbox.ts';
import { transpileCanvasSource } from '../canvas-pipeline.ts';
import { checkCanvasSyntax } from '../canvas-source/errors.ts';
import { classifyImports } from '../handoff.ts';
import { hasMacroImport } from '../macro-guard.ts';
import { makeSandbox } from './_helpers.ts';

const CANARY = 'C4N_MACRO_CANARY_7f3a';
const REFUSAL = 'macro imports are not allowed in canvases';

function fixture() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const secret = join(root, 'outside-secret.txt');
  writeFileSync(secret, `${CANARY}\n`);
  const marker = join(root, 'MACRO_RAN');
  return { root, designRoot, secret, marker };
}

/** The probe: a node:fs macro reads a file outside the project into the module. */
const fsMacro = (secret: string) =>
  `import { readFileSync } from 'node:fs' with { type: 'macro' };\n` +
  `const s = readFileSync(${JSON.stringify(secret)}, 'utf8');\n` +
  `export default function A() { return <p>{s}</p>; }\n`;

/** A macro with a side effect — the marker exists iff the macro executed. */
const writeMacro = (marker: string) =>
  `import { writeFileSync } from 'node:fs' with { type: 'macro' };\n` +
  `writeFileSync(${JSON.stringify(marker)}, 'ran');\n` +
  `export default function A() { return <p>ok</p>; }\n`;

async function outcome(abs: string, src: string, designRoot: string, restrict: boolean) {
  try {
    const r = await buildCanvasModule(abs, src, {
      designRoot,
      ...(restrict ? { restrictImportsTo: designRoot } : {}),
    });
    return { js: r.js, err: null as Error | null };
  } catch (e) {
    return { js: '', err: e as Error };
  }
}

describe('hasMacroImport — the raw-text check fails closed', () => {
  const yes = [
    `import { a } from 'x' with { type: 'macro' };`,
    `import { a } from "x" with {type:"macro"}`,
    `import { a } from 'x' assert { type: 'macro' };`,
    `import { a } from 'x' with { "type": 'macro' };`,
    `import { a } from 'x' with { 'type' : "macro" };`,
    `import { a } from 'x' with { foo: 'bar', type: 'macro' };`,
    `import { a } from 'x' with {\n  type:\n  'macro'\n};`,
    `import { a } from 'x' with { type: /* c */ 'macro' };`,
    `import { a } from 'x' with { type: // c\n 'macro' };`,
    `import { a } from 'x' with { type: 'm\\u0061cro' };`,
    `import { a } from 'x' with { type: "mac\\x72o" };`,
    `import { a } from 'x' with { type: 'm\\u{61}cro' };`,
    `import { a } from 'x' with { type: 'mac\\\nro' };`,
    `import { a } from 'x' with { t\\u0079pe: 'macro' };`,
    `import { a } from 'x' with { type: '\\macro' };`,
    `import { a } from 'x' with { type: 'MACRO' };`,
    `const m = await import('x', { with: { type: 'macro' } });`,
    `// a comment: with { type: 'macro' }`,
  ];
  for (const s of yes)
    test(`refuses ${JSON.stringify(s)}`, () => expect(hasMacroImport(s)).toBe(true));
  const no = [
    `const macro = 'macro'; export const kind = { type: 'module', label: 'Macro' };`,
    `import data from './a.json' with { type: 'json' };`,
    `import t from './a.txt' with { type: 'text' };`,
    `export default () => <p>Record a macro — type: shortcut</p>;`,
    `const subtype = 'macro'; const prototype = { x: 'macro' };`,
  ];
  for (const s of no)
    test(`admits ${JSON.stringify(s)}`, () => expect(hasMacroImport(s)).toBe(false));
});

describe('the in-process build (buildCanvasModule)', () => {
  for (const restrict of [true, false]) {
    const label = restrict ? 'restricted (cell / frame)' : 'unrestricted (desktop)';

    test(`${label}: a node:fs macro in the canvas is refused; the outside file is not inlined`, async () => {
      const { designRoot, secret } = fixture();
      const abs = join(designRoot, 'ui', 'a.tsx');
      const src = fsMacro(secret);
      writeFileSync(abs, src);
      const r = await outcome(abs, src, designRoot, restrict);
      expect(r.err?.message ?? '').toContain(REFUSAL);
      expect(r.js).not.toContain(CANARY);
      expect(String(r.err?.message)).not.toContain(CANARY);
    });

    test(`${label}: a side-effect macro never runs`, async () => {
      const { designRoot, marker } = fixture();
      const abs = join(designRoot, 'ui', 'w.tsx');
      const src = writeMacro(marker);
      writeFileSync(abs, src);
      const r = await outcome(abs, src, designRoot, restrict);
      expect(r.err?.message ?? '').toContain(REFUSAL);
      expect(existsSync(marker)).toBe(false);
    });

    test(`${label}: an absolute-path project-module macro is refused and never runs`, async () => {
      const { designRoot, marker } = fixture();
      const mod = join(designRoot, 'ui', 'mk.ts');
      writeFileSync(
        mod,
        `export function mk() { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); return 1; }\n`
      );
      const abs = join(designRoot, 'ui', 'p.tsx');
      const src =
        `import { mk } from ${JSON.stringify(mod)} with { type: 'macro' };\n` +
        `const v = mk();\nexport default function A() { return <p>{v}</p>; }\n`;
      writeFileSync(abs, src);
      const r = await outcome(abs, src, designRoot, restrict);
      expect(r.err?.message ?? '').toContain(REFUSAL);
      expect(existsSync(marker)).toBe(false);
    });

    test(`${label}: a macro in a file the canvas imports is refused (the load hook)`, async () => {
      const { designRoot, secret, marker } = fixture();
      writeFileSync(
        join(designRoot, 'ui', 'helper.ts'),
        fsMacro(secret).replace(/<p>.*<\/p>/, 's')
      );
      writeFileSync(
        join(designRoot, 'ui', 'side.ts'),
        writeMacro(marker).replace(/<p>.*<\/p>/, '1')
      );
      for (const [name, spec] of [
        ['h.tsx', './helper.ts'],
        ['s.tsx', './side.ts'],
      ] as const) {
        const abs = join(designRoot, 'ui', name);
        const src = `import H from '${spec}';\nexport default function A() { return <p>{String(H)}</p>; }\n`;
        writeFileSync(abs, src);
        const r = await outcome(abs, src, designRoot, restrict);
        expect(r.err?.message ?? '').toContain(REFUSAL);
        expect(r.js).not.toContain(CANARY);
      }
      expect(existsSync(marker)).toBe(false);
    });

    test(`${label}: a .txt imported as tsx carrying a macro is refused`, async () => {
      const { designRoot, secret } = fixture();
      writeFileSync(join(designRoot, 'ui', 'evil.txt'), fsMacro(secret));
      const abs = join(designRoot, 'ui', 't.tsx');
      const src =
        `import E from './evil.txt' with { type: 'tsx' };\n` +
        `export default function A() { return <E />; }\n`;
      writeFileSync(abs, src);
      const r = await outcome(abs, src, designRoot, restrict);
      expect(r.err?.message ?? '').toContain(REFUSAL);
      expect(r.js).not.toContain(CANARY);
    });
  }

  test('the word "macro" in ordinary canvas code still builds', async () => {
    const { designRoot } = fixture();
    const abs = join(designRoot, 'ui', 'ok.tsx');
    const src =
      `const macro = { kind: 'macro', type: 'shortcut', label: 'Record a macro' };\n` +
      `export default function A() { return <p data-type="macro">{macro.label}</p>; }\n`;
    writeFileSync(abs, src);
    const r = await outcome(abs, src, designRoot, true);
    expect(r.err).toBeNull();
    expect(r.js).toContain('Record a macro');
  });
});

describe('the other Bun.Transpiler entry points', () => {
  test('transpileCanvasSource (pass 1) refuses before its transpiler runs', () => {
    const { designRoot, marker } = fixture();
    const abs = join(designRoot, 'ui', 'w.tsx');
    expect(() => transpileCanvasSource(abs, writeMacro(marker))).toThrow(REFUSAL);
    expect(existsSync(marker)).toBe(false);
  });

  test('checkCanvasSyntax (the listing / source route) answers the refusal, never transpiles', () => {
    const { designRoot, marker } = fixture();
    const abs = join(designRoot, 'ui', 'w.tsx');
    const e = checkCanvasSyntax(writeMacro(marker), { designRoot, canvasAbs: abs });
    expect(e?.message ?? '').toContain(REFUSAL);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('handoff (classifyImports — Bun.Transpiler.scanImports)', () => {
  test('a macro canvas is refused before the scanner sees it', () => {
    const { designRoot, secret } = fixture();
    const abs = join(designRoot, 'ui', 'a.tsx');
    expect(() => classifyImports(abs, fsMacro(secret))).toThrow(REFUSAL);
    expect(classifyImports(abs, `import { motion } from 'motion/react';\n`).dependencies).toContain(
      'motion'
    );
  });
});

describe('the sandbox worker (canvas-build-worker.ts)', () => {
  test('a node:fs macro and a side-effect macro are refused; nothing leaks, nothing runs', async () => {
    const { designRoot, secret, marker } = fixture();
    for (const [name, src] of [
      ['sa.tsx', fsMacro(secret)],
      ['sw.tsx', writeMacro(marker)],
    ] as const) {
      const abs = join(designRoot, 'ui', name);
      writeFileSync(abs, src);
      const r = await buildCanvasSandboxed({
        designRoot,
        canvasAbs: abs,
        env: { ...process.env, MAUDE_BUN_PATH: process.execPath },
      });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error).toContain(REFUSAL);
      expect(r.error).not.toContain(CANARY);
    }
    expect(existsSync(marker)).toBe(false);
  }, 60_000);
});
