// #169 T8.1c — `@maude/canvas-lib` is ONE shared browser module, not a copy inlined into every
// canvas module (decision v2-2.17-version-picture-budget-open: "the lever is smaller canvas modules").
//
//   1. the shared module: one output, no self-import, no install path, the hash in its URL;
//   2. a canvas build with it leaves the specifier external and inlines none of canvas-lib's files —
//      and falls back to inlining when it would still carry one of them (a second copy of a
//      canvas-lib module is a second copy of its state);
//   3. the server: the shell's importmap maps the specifier (under its CSP), the module is served
//      under `/_canvas-runtime/` on the canvas and capture origins without a frame (Maude's own
//      code, no project content), immutable, GET-only on the capture origin; an unknown hash is a
//      404; `MAUDE_SHARED_CANVAS_LIB=0` restores inlining in both the shell and the build.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCanvasModule } from '../canvas-build.ts';
import {
  SHARED_LIB_SLUG_RE,
  setSharedCanvasLibBuilderForTest,
  sharedCanvasLib,
  withSharedCanvasLib,
} from '../canvas-lib-module.ts';
import { canvasLibPath } from '../canvas-lib-resolver.ts';
import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Part } from "./part.tsx";
export default function Home() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="S">
        <DCArtboard id="a" label="A" width={200} height={120}><Part /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const PART = 'export function Part() { return <p>part</p>; }\n';

afterEach(() => setSharedCanvasLibBuilderForTest(null));

function project(): { designRoot: string; canvas: string; part: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 't81c-lib-'));
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const canvas = join(designRoot, 'ui', 'Home.tsx');
  const part = join(designRoot, 'ui', 'part.tsx');
  writeFileSync(canvas, CANVAS);
  writeFileSync(part, PART);
  return {
    designRoot,
    canvas,
    part,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('the shared canvas-lib module', () => {
  test('one self-contained module: runtime packages external, no self-import, no install path', async () => {
    const lib = await sharedCanvasLib();
    const text = new TextDecoder().decode(lib.bytes);
    expect(lib.url).toBe(`./_canvas-runtime/canvas-lib.${lib.hash}.js`);
    expect(SHARED_LIB_SLUG_RE.test(lib.url.slice('./_canvas-runtime/'.length))).toBe(true);
    expect(text).not.toContain('@maude/canvas-lib');
    expect(text).not.toContain(process.cwd());
    expect(text).toMatch(/from\s*"react"/);
    expect(text).toContain('DesignCanvas');
    expect(lib.inputs.has(canvasLibPath())).toBe(true);
    // the same build answers until invalidated
    expect(await sharedCanvasLib()).toBe(lib);
  });

  test('the shell importmap gains the mapping and keeps every other entry', () => {
    const html =
      '<head><script type="importmap">\n{ "imports": { "react": "./_canvas-runtime/react.js" } }\n</script></head>';
    const out = withSharedCanvasLib(html, './_canvas-runtime/canvas-lib.0123456789abcdef.js');
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(out)?.[1] ?? '{}');
    expect(map.imports).toEqual({
      react: './_canvas-runtime/react.js',
      '@maude/canvas-lib': './_canvas-runtime/canvas-lib.0123456789abcdef.js',
    });
    expect(withSharedCanvasLib('<p>no map</p>', './x.js')).toBe('<p>no map</p>');
  });
});

describe('a canvas build against the shared module', () => {
  test('leaves @maude/canvas-lib external and inlines none of its files', async () => {
    const p = project();
    try {
      const lib = await sharedCanvasLib();
      const shared = await buildCanvasModule(p.canvas, CANVAS, {
        designRoot: p.designRoot,
        restrictImportsTo: p.designRoot,
        sharedCanvasLib: lib,
      });
      const inlined = await buildCanvasModule(p.canvas, CANVAS, {
        designRoot: p.designRoot,
        restrictImportsTo: p.designRoot,
      });
      expect(shared.sharedLib).toBe(true);
      expect(shared.js).toMatch(/from\s*"@maude\/canvas-lib"/);
      expect(shared.inputs.some((f) => lib.inputs.has(f))).toBe(false);
      expect(shared.inputs.some((f) => f.endsWith('part.tsx'))).toBe(true);
      expect(inlined.sharedLib).toBe(false);
      expect(inlined.js).not.toMatch(/from\s*"@maude\/canvas-lib"/);
      // the point of it: the canvas module carries its own code, not the library
      expect(shared.js.length * 20).toBeLessThan(inlined.js.length);
    } finally {
      p.cleanup();
    }
  });

  test('a build that would still inline a shared file falls back to inlining canvas-lib', async () => {
    const p = project();
    try {
      // a shared module that (in this fixture) owns the canvas's own `part.tsx`: sharing would put a
      // second copy of it beside the shared one
      const built = await buildCanvasModule(p.canvas, CANVAS, {
        designRoot: p.designRoot,
        restrictImportsTo: p.designRoot,
        // (the bundler reports real paths — macOS tmp is /private/var)
        sharedCanvasLib: { inputs: new Set([realpathSync(p.part), canvasLibPath()]) },
      });
      expect(built.sharedLib).toBe(false);
      expect(built.js).not.toMatch(/from\s*"@maude\/canvas-lib"/);
    } finally {
      p.cleanup();
    }
  });
});

const BASE_ENV = { MAUDE_NO_AUTOBUILD: '1' };

async function served(
  env: Record<string, string>,
  fn: (o: {
    port: number;
    capture: string;
    canvasOrigin: string;
    designRoot: string;
  }) => Promise<void>
) {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'Home.tsx'), CANVAS);
  writeFileSync(join(designRoot, 'ui', 'part.tsx'), PART);
  const port = nextPort();
  const proc = await bootServer(root, port, { ...BASE_ENV, ...env });
  try {
    const r = await fetch(`http://localhost:${port}/_canvas-shell.html?canvas=ui/Home.tsx`, {
      redirect: 'manual',
    });
    expect(r.status).toBe(307);
    const capture = new URL(r.headers.get('location') ?? '').origin;
    const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
    await fn({ port, capture, canvasOrigin: String(info.canvasOrigin), designRoot });
  } finally {
    killProc(proc);
  }
}

const importmapOf = (html: string) =>
  JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}') as {
    imports: Record<string, string>;
  };

describe('the server serves canvases against the shared module', () => {
  test('shell mapping under its CSP, frameless immutable module, small canvas module', async () => {
    await served({}, async ({ port, capture, canvasOrigin }) => {
      const fc = await frameCap({ base: `http://localhost:${port}` }, {}, 'ui/Home.tsx');
      for (const origin of [canvasOrigin, capture]) {
        const shell = await fetch(withFc(`${origin}/_canvas-shell.html?canvas=ui/Home.tsx`, fc));
        expect(shell.status).toBe(200);
        const html = await shell.text();
        const url = importmapOf(html).imports['@maude/canvas-lib'] ?? '';
        expect(url).toMatch(/^\.\/_canvas-runtime\/canvas-lib\.[0-9a-f]+\.js$/);
        // the CSP hashes the importmap script AS SERVED (the mapping is inside it)
        const mapScript = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
        const sha = new Bun.CryptoHasher('sha256').update(mapScript).digest('base64');
        expect(shell.headers.get('content-security-policy') ?? '').toContain(`'sha256-${sha}'`);

        // Maude's own code: no frame capability needed, cached for good
        const lib = await fetch(`${origin}/${url.slice(2)}`);
        expect(lib.status).toBe(200);
        expect(lib.headers.get('cache-control')).toContain('immutable');
        expect(lib.headers.get('content-type')).toContain('javascript');
        expect((await lib.text()).length).toBeGreaterThan(100_000);
        expect(
          (await fetch(`${origin}/_canvas-runtime/canvas-lib.0000000000000000.js`)).status
        ).toBe(404);

        const mod = await fetch(withFc(`${origin}/.design/ui/Home.tsx`, fc));
        expect(mod.status).toBe(200);
        const js = await mod.text();
        expect(js).toMatch(/from\s*"@maude\/canvas-lib"/);
        expect(js.length).toBeLessThan(100_000);
      }
      // the capture origin stays read-only
      const lib = importmapOf(
        await (await fetch(withFc(`${capture}/_canvas-shell.html?canvas=ui/Home.tsx`, fc))).text()
      ).imports['@maude/canvas-lib'] as string;
      expect((await fetch(`${capture}/${lib.slice(2)}`, { method: 'POST' })).status).toBe(405);
    });
  }, 60_000);

  test('MAUDE_SHARED_CANVAS_LIB=0: no mapping in the shell, canvas-lib inlined in the module', async () => {
    await served({ MAUDE_SHARED_CANVAS_LIB: '0' }, async ({ port, canvasOrigin }) => {
      const fc = await frameCap({ base: `http://localhost:${port}` }, {}, 'ui/Home.tsx');
      const html = await (
        await fetch(withFc(`${canvasOrigin}/_canvas-shell.html?canvas=ui/Home.tsx`, fc))
      ).text();
      expect(importmapOf(html).imports['@maude/canvas-lib']).toBeUndefined();
      const js = await (await fetch(withFc(`${canvasOrigin}/.design/ui/Home.tsx`, fc))).text();
      expect(js).not.toMatch(/from\s*"@maude\/canvas-lib"/);
      expect(js.length).toBeGreaterThan(100_000);
    });
  }, 60_000);
});
