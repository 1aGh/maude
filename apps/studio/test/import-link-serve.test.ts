// p8-import-link — the real studio, booted on a sandbox: (L2/F5) whatever bytes a linked file holds, Assets serves it
// with the type its stored name says and `X-Content-Type-Options: nosniff`, so a polyglot that slipped a sniff can
// never be read as a page; (F2) the link route answers only the shell page — an AI chat's request (the X-Maude-Chat
// header curl-local stamps) gets neither the page key nor an import, and a request without the key is refused.
// No network: every request here is to the sandbox server on loopback.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HTML = Buffer.from(
  '<!doctype html><html><body><script>document.title="ran"</script></body></html>'
);

describe('p8-import-link on a booted studio', () => {
  test('Assets are served with a fixed type and nosniff; the link route answers only the shell page', async () => {
    const { root, designRoot } = makeSandbox();
    const assets = join(designRoot, 'assets');
    mkdirSync(assets, { recursive: true });
    // HTML bytes under media names: what a polyglot that passed a weak sniff would look like on disk
    for (const name of [
      '0000abcd.png',
      '0000abcd.jpg',
      '0000abcd.mp3',
      '0000abcd.mp4',
      '0000abcd.webm',
    ])
      writeFileSync(join(assets, name), HTML);
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    try {
      const at = (p: string, init?: RequestInit) => fetch(`http://localhost:${port}${p}`, init);
      for (const [name, type] of [
        ['0000abcd.png', 'image/png'],
        ['0000abcd.jpg', 'image/jpeg'],
        ['0000abcd.mp3', 'audio/mpeg'],
        ['0000abcd.mp4', 'video/mp4'],
        ['0000abcd.webm', 'video/webm'],
      ] as const) {
        for (const p of [`/assets/${name}`, `/.design/assets/${name}`]) {
          const r = await at(p);
          await r.arrayBuffer();
          expect(`${p} ${r.status} ${r.headers.get('content-type')}`).toBe(`${p} 200 ${type}`);
          expect(`${p} ${r.headers.get('x-content-type-options')}`).toBe(`${p} nosniff`);
        }
      }

      // F2 — the key: a chat's request is refused, the shell's (no chat header) gets it
      const chatKey = await at('/_api/import-link/key', { headers: { 'X-Maude-Chat': 'chat_1' } });
      expect(chatKey.status).toBe(403);
      const keyRes = await at('/_api/import-link/key');
      expect(keyRes.status).toBe(200);
      const { key } = (await keyRes.json()) as { key: string };
      expect(typeof key).toBe('string');
      const post = (headers: Record<string, string>) =>
        at('/_api/import-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          // an http link: a request that gets past the gates is refused by the URL check, before any network
          body: JSON.stringify({ url: 'http://media.example/a.png' }),
        });
      for (const headers of [
        {},
        { 'X-Maude-Link-Key': 'guess' },
        { 'X-Maude-Link-Key': key, 'X-Maude-Chat': 'chat_1' },
      ]) {
        const r = await post(headers);
        expect({
          headers,
          status: r.status,
          reason: ((await r.json()) as { reason: string }).reason,
        }).toEqual({
          headers,
          status: 403,
          reason: 'not-from-shell',
        });
      }
      const shell = await post({ 'X-Maude-Link-Key': key });
      expect({
        status: shell.status,
        reason: ((await shell.json()) as { reason: string }).reason,
      }).toEqual({
        status: 400,
        reason: 'link-not-https',
      });
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
