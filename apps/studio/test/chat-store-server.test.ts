// S5.7 — the chat store over a real server: the legacy list key grows ?group= / ?trashed=,
// and the new table routes are mounted behind the CSRF + loopback guard.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

function seed(designRoot: string, id: string, text: string, meta?: object) {
  const dir = join(designRoot, '_chat');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify({ role: 'user', text })}\n`);
  if (meta) writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify(meta));
}

describe('chat store routes on a booted server', () => {
  test('list, group, trash, restore and search — and the CSRF guard on the writes', async () => {
    const { root, designRoot } = makeSandbox();
    seed(designRoot, 'a', 'Three reel covers', { canvas: 'ui/reel.tsx' });
    seed(designRoot, 'b', 'Fix the pricing table', { canvas: 'ui/pricing.tsx' });
    seed(designRoot, 'c', 'A chat with no canvas');
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    try {
      const base = `http://localhost:${port}`;
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${base}${path}`, {
          method: 'POST',
          headers: { origin: base, 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });

      // the flat list is unchanged
      const flat = (await (await fetch(`${base}/_api/acp/chats`)).json()) as Array<{ id: string }>;
      expect(flat.map((c) => c.id).sort()).toEqual(['a', 'b', 'c']);

      // ?group=canvas
      const grouped = (await (await fetch(`${base}/_api/acp/chats?group=canvas`)).json()) as {
        groups: Array<{ canvas: string | null; chats: Array<{ id: string }> }>;
      };
      expect(
        grouped.groups.map((g) => g.canvas).filter((c): c is string => c !== null).sort()
      ).toEqual(['ui/pricing.tsx', 'ui/reel.tsx']);
      expect(grouped.groups.at(-1)?.canvas).toBeNull();

      // a cross-site trash is refused and changes nothing
      const forged = await post(
        '/_api/acp/chats/trash',
        { id: 'a' },
        { origin: 'http://evil.example' }
      );
      expect(forged.status).toBe(403);
      const evil = `evil.example:${port}`;
      const rebound = await post(
        '/_api/acp/chats/trash',
        { id: 'a' },
        { origin: `http://${evil}`, host: evil }
      );
      expect(rebound.status).toBe(403);
      expect(((await (await fetch(`${base}/_api/acp/chats`)).json()) as unknown[]).length).toBe(3);

      // the shell's own request trashes it
      const trashed = await post('/_api/acp/chats/trash', { id: 'a' });
      expect(trashed.status).toBe(200);
      const after = (await (await fetch(`${base}/_api/acp/chats`)).json()) as Array<{ id: string }>;
      expect(after.map((c) => c.id).sort()).toEqual(['b', 'c']);
      const bin = (await (await fetch(`${base}/_api/acp/chats?trashed=1`)).json()) as Array<{
        id: string;
        trashedAt: number;
      }>;
      expect(bin.map((c) => c.id)).toEqual(['a']);
      expect(typeof bin[0]?.trashedAt).toBe('number');

      // search skips the trash
      const s1 = (await (await fetch(`${base}/_api/acp/chats/search?q=reel`)).json()) as {
        hits: unknown[];
      };
      expect(s1.hits).toEqual([]);
      expect((await post('/_api/acp/chats/restore', { id: 'a' })).status).toBe(200);
      const s2 = (await (await fetch(`${base}/_api/acp/chats/search?q=reel`)).json()) as {
        hits: Array<{ id: string }>;
      };
      expect(s2.hits.map((h) => h.id)).toEqual(['a']);
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
