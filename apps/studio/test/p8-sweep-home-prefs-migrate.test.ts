// P8 dynamic dead-control sweep — every Home boot logged `GET /_api/ui-prefs 404`: the 1.x prefs
// migration runs before the shell mode is known, and the Home server has no project preferences to
// move. The Home window (Tauri label `home`) skips it; a project window still migrates.
import { describe, expect, test } from 'bun:test';

import { migrateAtBoot } from '../client/v2/settings/prefs-migrate.js';

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
const win = (label: string) => ({
  __TAURI_INTERNALS__: { metadata: { currentWebview: { label } } },
  location: { hostname: '127.0.0.1' },
});

describe('the 1.x prefs migration at boot', () => {
  test('the Home window asks its server for no project preferences', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (u: string) => {
      calls.push(String(u));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    const r = await migrateAtBoot({ win: win('home'), fetchImpl, storage: memStorage() });
    expect(calls).toEqual([]);
    expect(r.status).toBe('skipped');
  });

  test('a project window still migrates', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (u: string) => {
      calls.push(String(u));
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await migrateAtBoot({ win: win('p-1'), fetchImpl, storage: memStorage() });
    expect(calls[0]).toBe('/_api/ui-prefs');
  });
});
