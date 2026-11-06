// #207 (list speed) — on the first open ever (no previous run's copy), the tree loader's request is
// answered with the bare listing before any content is read; what the content says still arrives.
//
// StudyFi (605 MB, 69 canvases): the tree waited for every sidecar read and both import walks of
// the first build. The tree loader now asks `partial=1`: it gets the listing at once, marked
// `indexPartial` + `indexStale`, with nothing derived (no design system, kind or import report —
// so nothing a canvas-only reader could be granted by), and asks again for the whole answer. Every
// other caller of `/_index-data` still gets the whole answer, as before.
//
// MAUDE_TEST_INDEX_DETAILS_GATE holds the build's content reads until the gate file exists, so the
// order is proven, not raced.
import { describe, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

interface Index {
  groups: Array<{ label: string; paths: string[] }>;
  canvasDesignSystems: Record<string, string>;
  canvasImportsCanvases?: Record<string, string[]>;
  canvasMissingImports?: Record<string, string[]>;
  indexStale?: boolean;
  indexPartial?: boolean;
}

const CANVAS = (title: string, imports = '') =>
  `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\n${imports}export default function C() { return <DesignCanvas><DCArtboard id="a" label="${title}" width={100} height={100}><div /></DCArtboard></DesignCanvas>; }\n`;

async function index(base: string, q = ''): Promise<Index> {
  const r = await fetch(`${base}/_index-data${q}`);
  expect(r.status).toBe(200);
  return (await r.json()) as Index;
}
const allPaths = (ix: Index) => ix.groups.flatMap((g) => g.paths);

describe('/_index-data — the listing first, the details after (#207)', () => {
  test('partial=1 answers before any content read; the whole answer still carries every detail', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'a.tsx'), CANVAS('A'));
    writeFileSync(join(designRoot, 'ui', 'a.meta.json'), JSON.stringify({ designSystem: 'one' }));
    writeFileSync(join(designRoot, 'ui', 'b.tsx'), CANVAS('B', "import A from './a.tsx';\n"));
    writeFileSync(join(designRoot, 'ui', 'c.tsx'), CANVAS('C', "import M from './missing.tsx';\n"));
    const gate = join(root, 'details-gate');
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_NO_BOOT_COVERS: '1',
      MAUDE_TEST_INDEX_DETAILS_GATE: gate,
    });
    const base = `http://localhost:${port}`;
    try {
      // a caller that did not ask for a partial answer waits for the whole one, as before
      let whole: Index | null = null;
      const wholeReq = index(base).then((ix) => {
        whole = ix;
      });

      const t0 = performance.now();
      const first = await index(base, '?partial=1');
      const ms = performance.now() - t0;
      expect(existsSync(gate)).toBe(false); // no content was read yet
      expect(ms).toBeLessThan(2000);
      expect(first.indexPartial).toBe(true);
      expect(first.indexStale).toBe(true);
      expect(allPaths(first)).toEqual(
        expect.arrayContaining(['.design/ui/a.tsx', '.design/ui/b.tsx', '.design/ui/c.tsx'])
      );
      // nothing derived from content is in the listing
      expect(first.canvasDesignSystems).toEqual({});
      expect(first.canvasImportsCanvases).toBeUndefined();
      expect(first.canvasMissingImports).toBeUndefined();

      await Bun.sleep(300);
      expect(whole).toBeNull();

      writeFileSync(gate, '');
      await wholeReq;
      const w = whole as unknown as Index;
      expect(w.indexPartial).toBeUndefined();
      expect(w.indexStale).toBeUndefined();
      expect(w.canvasDesignSystems['.design/ui/a.tsx']).toBe('one');
      expect(JSON.stringify(w.canvasImportsCanvases?.['.design/ui/b.tsx'] ?? [])).toContain(
        'a.tsx'
      );
      expect(JSON.stringify(w.canvasMissingImports?.['.design/ui/c.tsx'] ?? [])).toContain(
        'missing'
      );
      // the tree loader's next (fresh) request and any later partial one get the whole answer too
      const fresh = await index(base, '?fresh=1');
      expect(fresh.canvasDesignSystems).toEqual(w.canvasDesignSystems);
      const later = await index(base, '?partial=1');
      expect(later.indexPartial).toBeUndefined();
      expect(later.canvasImportsCanvases).toEqual(w.canvasImportsCanvases);
    } finally {
      killProc(proc);
    }
  }, 60_000);
});
