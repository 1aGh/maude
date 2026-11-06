// #207 — `/_index-data` on a desktop answers from the last build; a change still shows up.
//
// A real server on a sandbox: the cached tree follows a changed sidecar and a new canvas (file
// events invalidate it), concurrent first requests all get the same whole answer, and after a
// restart the first request is the previous run's copy (`indexStale`) while the real build runs —
// then the real tree, without the canvas deleted in between.
import { describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

interface Index {
  groups: Array<{ label: string; paths: string[] }>;
  canvasDesignSystems: Record<string, string>;
  indexStale?: boolean;
}

const CANVAS = (title: string) =>
  `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\nexport default function C() { return <DesignCanvas><DCArtboard id="a" label="${title}" width={100} height={100}><div /></DCArtboard></DesignCanvas>; }\n`;

async function index(base: string, q = ''): Promise<Index> {
  const r = await fetch(`${base}/_index-data${q}`);
  expect(r.status).toBe(200);
  return (await r.json()) as Index;
}
const allPaths = (ix: Index) => ix.groups.flatMap((g) => g.paths);

async function eventually(check: () => Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  expect(await check()).toBe(true);
}

describe('/_index-data from the last build (#207)', () => {
  test('a changed sidecar and a new canvas show up; concurrent first requests agree', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'a.tsx'), CANVAS('A'));
    writeFileSync(join(designRoot, 'ui', 'a.meta.json'), JSON.stringify({ designSystem: 'one' }));
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_BOOT_COVERS: '1' });
    const base = `http://localhost:${port}`;
    try {
      const first = await Promise.all([index(base), index(base), index(base), index(base)]);
      for (const ix of first) expect(JSON.stringify(ix)).toBe(JSON.stringify(first[0]));
      expect(first[0]?.canvasDesignSystems['.design/ui/a.tsx']).toBe('one');
      expect(first[0]?.indexStale).toBeUndefined();

      // a runtime write leaves it standing; a sidecar edit does not
      writeFileSync(join(designRoot, '_canvas-state-probe.json'), '{}');
      writeFileSync(join(designRoot, 'ui', 'a.meta.json'), JSON.stringify({ designSystem: 'two' }));
      await eventually(
        async () => (await index(base)).canvasDesignSystems['.design/ui/a.tsx'] === 'two'
      );

      writeFileSync(join(designRoot, 'ui', 'b.tsx'), CANVAS('B'));
      await eventually(async () => allPaths(await index(base)).includes('.design/ui/b.tsx'));
    } finally {
      killProc(proc);
    }
  }, 60_000);

  test("after a restart: the previous run's copy at once, then the real tree", async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'keep.tsx'), CANVAS('Keep'));
    writeFileSync(join(designRoot, 'ui', 'gone.tsx'), CANVAS('Gone'));
    let port = nextPort();
    let proc = await bootServer(root, port, { MAUDE_NO_BOOT_COVERS: '1' });
    try {
      const ix = await index(`http://localhost:${port}`);
      expect(allPaths(ix)).toContain('.design/ui/gone.tsx');
      await Bun.sleep(1500); // the disk copy is written after a quiet second
    } finally {
      killProc(proc);
    }
    await Bun.sleep(300);
    rmSync(join(designRoot, 'ui', 'gone.tsx')); // while no server runs
    port = nextPort();
    proc = await bootServer(root, port, { MAUDE_NO_BOOT_COVERS: '1' });
    const base = `http://localhost:${port}`;
    try {
      const copy = await index(base);
      expect(copy.indexStale).toBe(true);
      expect(allPaths(copy)).toContain('.design/ui/gone.tsx');
      await eventually(async () => {
        const ix = await index(base);
        return ix.indexStale === undefined && !allPaths(ix).includes('.design/ui/gone.tsx');
      });
      expect(allPaths(await index(base))).toContain('.design/ui/keep.tsx');
    } finally {
      killProc(proc);
    }
  }, 60_000);
});
