// /_api/ui-prefs end to end (V2-2.7): a real studio server, a real prefs.json in a sandbox, the
// migration's own POST body. Every server here is booted with an EXPLICIT MAUDE_UI_PREFS_PATH, so no
// route can reach the person's real ~/.config/maude/prefs.json whatever the preload does.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { diffPrefs } from '../ui-prefs-migrate.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const fx = (n: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'prefs-v1', n), 'utf8'));
const DISK = fx('disk.json');
const EXPECTED = fx('expected-v2.json');

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function boot(seed?: object) {
  const { root } = makeSandbox();
  const prefsPath = join(root, 'prefs.json');
  if (seed) writeFileSync(prefsPath, JSON.stringify(seed));
  const port = nextPort();
  const proc = await bootServer(root, port, { MAUDE_UI_PREFS_PATH: prefsPath });
  procs.push(proc);
  return { base: `http://localhost:${port}`, prefsPath };
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/_api/ui-prefs`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: base },
    body: JSON.stringify(body),
  });

describe('/_api/ui-prefs', () => {
  test('1.x clients: the same body, the same answers', async () => {
    const { base } = await boot();
    const ok = await post(base, { theme: 'light', minimap: true, layersMode: 'in-inspector' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { theme: string }).theme).toBe('light');
    const bad = await post(base, { theme: 'neon' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe('theme must be light|dark');
    expect((await post(base, { zoom: 'yes' })).status).toBe(400);
    expect((await post(base, { panelSides: { tree: 'middle' } })).status).toBe(400);
  });

  test('the migration posts its delta and the file ends up exactly as the fixture expects', async () => {
    const { base, prefsPath } = await boot(DISK);
    const delta = diffPrefs(DISK, EXPECTED);
    const res = await post(base, delta);
    expect(res.status).toBe(200);
    const got = (await (await fetch(`${base}/_api/ui-prefs`)).json()) as Record<string, unknown>;
    expect(got).toEqual(EXPECTED);
    expect(JSON.parse(readFileSync(prefsPath, 'utf8'))).toEqual(EXPECTED);
    // the same delta again is a no-op
    expect((await post(base, delta)).status).toBe(200);
    expect(JSON.parse(readFileSync(prefsPath, 'utf8'))).toEqual(EXPECTED);
  });

  test('a malformed v2 field is refused and nothing is written', async () => {
    const { base, prefsPath } = await boot(DISK);
    const before = readFileSync(prefsPath, 'utf8');
    for (const body of [
      { fold: { 'a b': true } },
      { seen: { tour: false } },
      { pin: { widths: { left: -5 } } },
      { version: 9 },
    ]) {
      expect((await post(base, body)).status).toBe(400);
    }
    expect(readFileSync(prefsPath, 'utf8')).toBe(before);
  });
});
