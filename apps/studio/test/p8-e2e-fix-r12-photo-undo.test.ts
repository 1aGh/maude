// p8-e2e-fix-r12 §1 — two studio writes the local home's watcher reads once are two ⌘Z steps.
//
// photo-per-use e2e, r11 pass C2: a look on one use, Reset, ⌘Z — and GET undo-stack answered `entries: []`, so
// ⌘Z had nothing to take back. Not the hub's 8 s answer wait (`land`, routes/edit.ts): the fixture is a local
// home, and `photo.use-edit` writes no layout, so it never goes through `land`. Each write is said to the local
// home (`source-writing`, a note per canvas lane) and recorded when the watcher next reads the canvas. The note
// was ONE slot per lane, so a second write before that read replaced the first note: the read then saw only the
// final bytes. Under a loaded machine (FSEvents late, the 300 ms settle stretched) the look and the Reset fell in
// one read; the disk was back to what the store held, so nothing at all was recorded. Two writes that do not
// cancel became ONE step under the second's label.
//
// The flow at API level, with no read in between: PUT the per-use file, `photo.use-edit` → edit8, then
// `photo.use-edit` → null, both before the watcher's read.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const IMG = '5e15c0de';
const FILE = '.design/ui/Smoke.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · PHOTO" width={900} height={420}>
        <img data-cd-id="photo" src="assets/${IMG}.png" alt="" style={{ width: 300, height: 400, objectFit: "cover" }} />
        <img data-cd-id="photo-2" src="assets/${IMG}.png" alt="" style={{ width: 300, height: 400, objectFit: "cover" }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('studio writes faster than the local home reads them', () => {
  let proc: Subprocess | null = null;
  let root = '';
  let designRoot = '';
  let base = '';
  const post = (p: string, body: unknown) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
  const look = async (adjustments: Record<string, number>) => {
    const put = await fetch(`${base}/_api/photo-edit?asset=assets/${IMG}.png&perUse=1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ adjustments }),
    });
    return ((await put.json()) as { edit: string }).edit;
  };
  const useEdit = async (edit: string | null) =>
    (await (
      await post('/_api/edit-op', {
        file: 'ui/Smoke.tsx',
        op: 'photo.use-edit',
        targets: [{ artboard: 'smoke', element: 'photo' }],
        params: { edit },
      })
    ).json()) as { ok: boolean; actionId?: string | null; writeId?: string };
  // what the shell's ⌘Z reads (newest first)
  const stack = async () =>
    (await (
      await fetch(`${base}/_api/project/undo-stack?canvas=${encodeURIComponent(FILE)}`)
    ).json()) as { ok: boolean; entries?: { actionId: string; label?: string }[] };
  const undo = async () => {
    const top = (await stack()).entries?.[0]?.actionId;
    expect(typeof top).toBe('string');
    expect((await post('/_api/project/undo', { actionId: top })).status).toBe(200);
  };
  const attr = () => {
    const src = readFileSync(join(designRoot, 'ui', 'Smoke.tsx'), 'utf8');
    const tag = src.match(/<img [^>]*>/g)?.find((t) => t.includes('data-cd-id="photo"')) ?? '';
    return /data-photo-edit="([0-9a-f]+)"/.exec(tag)?.[1] ?? null;
  };

  beforeAll(async () => {
    ({ root, designRoot } = makeSandbox());
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(join(designRoot, 'assets', `${IMG}.png`), PNG);
    writeFileSync(join(designRoot, 'ui', 'Smoke.tsx'), SRC);
    const port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      XDG_CONFIG_HOME: join(root, '.config'),
    });
    base = `http://localhost:${port}`;
    for (let i = 0; i < 80; i++) {
      const h = (await (await fetch(`${base}/_api/project/history`)).json()) as {
        ok: boolean;
        history?: unknown[];
      };
      if (h.ok && (h.history?.length ?? 0) > 0) break;
      await Bun.sleep(100);
    }
  }, 40_000);

  afterAll(async () => {
    if (proc) await killProc(proc);
    rmSync(root, { recursive: true, force: true });
  });

  test('a look then Reset, in one read: two entries, and ⌘Z puts the look back', async () => {
    const mono = await look({ grayscale: 1 });
    expect((await useEdit(mono)).ok).toBe(true);
    expect(attr()).toBe(mono);
    expect((await useEdit(null)).ok).toBe(true);
    expect(attr()).toBeNull();
    const s = await stack();
    expect(s.ok).toBe(true);
    expect(s.entries?.map((e) => e.label)).toEqual([
      'Edited this use of a photo',
      'Edited this use of a photo',
    ]);
    await undo();
    expect(attr()).toBe(mono);
    await undo();
    expect(attr()).toBeNull();
  }, 30_000);

  test('two looks in one read are two ⌘Z steps, not one', async () => {
    const before = (await stack()).entries?.length ?? 0;
    const warm = await look({ contrast: 0.3 });
    const cool = await look({ saturation: 0.2 });
    expect((await useEdit(warm)).ok).toBe(true);
    expect((await useEdit(cool)).ok).toBe(true);
    expect(attr()).toBe(cool);
    expect(((await stack()).entries?.length ?? 0) - before).toBe(2);
    await undo();
    expect(attr()).toBe(warm);
  }, 30_000);
});
