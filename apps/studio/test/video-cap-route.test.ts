// S7.18 (C22) — "Allow longer" over the real route: `PATCH /_api/present-meta { file, maxFrames: { id: n | null } }`
// writes `artboardMeta[id].maxFrames` and keeps every other key (the role refusals of the whole route are
// pinned in test/present-meta-route.test.ts against test/_role-refusals.ts).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const FILE = '.design/ui/Reel.tsx';
const SOURCE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Reel() {
  return (
    <DesignCanvas>
      <DCArtboard id="a" label="Recap" width={400} height={300}><main /></DCArtboard>
      <DCArtboard id="b" label="Recap 16:9" width={400} height={300}><main /></DCArtboard>
    </DesignCanvas>
  );
}
`;
const META = {
  title: 'Reel',
  layout: { artboards: [{ id: 'a', x: 0, y: 0 }] },
  artboardMeta: { a: { poster: 3, snap: 'beat' } },
};

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

describe('PATCH /_api/present-meta maxFrames', () => {
  let base = '';
  let metaAbs = '';
  beforeAll(async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Reel.tsx'), SOURCE);
    metaAbs = join(designRoot, 'ui', 'Reel.meta.json');
    writeFileSync(metaAbs, `${JSON.stringify(META, null, 2)}\n`);
    const port = nextPort();
    procs.push(await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' }));
    base = `http://localhost:${port}`;
  });
  const patch = (body: unknown) =>
    fetch(`${base}/_api/present-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const onDisk = () => JSON.parse(readFileSync(metaAbs, 'utf8')) as Record<string, unknown>;

  test('Allow longer is written next to the poster and the snap, and answered back', async () => {
    const res = await patch({ file: FILE, maxFrames: { a: 18000 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, maxFrames: { a: 18000 }, poster: { a: 3 } });
    expect(onDisk().artboardMeta).toEqual({ a: { poster: 3, snap: 'beat', maxFrames: 18000 } });
    expect(onDisk().layout).toEqual(META.layout);
  });

  test('past the exporter’s ceiling, or not a whole number, is refused and writes nothing', async () => {
    const before = readFileSync(metaAbs, 'utf8');
    for (const bad of [18001, 0, 9000.5, '9000']) {
      const res = await patch({ file: FILE, maxFrames: { a: bad } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad-field', field: 'maxFrames.a' });
    }
    expect(readFileSync(metaAbs, 'utf8')).toBe(before);
  });

  test('an artboard the canvas does not have is refused', async () => {
    const res = await patch({ file: FILE, maxFrames: { ghost: 9000 } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'unknown-artboard', ids: ['ghost'] });
  });

  test('Back to the limit takes it off and leaves the rest', async () => {
    const res = await patch({ file: FILE, maxFrames: { a: null } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { maxFrames: unknown }).maxFrames).toEqual({});
    expect(onDisk().artboardMeta).toEqual({ a: { poster: 3, snap: 'beat' } });
  });
});
