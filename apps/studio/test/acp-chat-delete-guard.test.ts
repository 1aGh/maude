// V2-2.8 S2 — `DELETE /_api/acp/chat` carries the same guard as its siblings.
//
// The chat switcher's Rename / Archive (`PATCH`) on this very route, and every
// other privileged ACP write (`/_api/acp/focus`, `/_api/claude/signin`, …),
// require BOTH the CSRF Origin check (`sameOriginWrite`) and the DNS-rebinding
// Host check (`isTrustedRequestHost`). The `DELETE` branch had neither, so a
// cross-site page — or a rebound hostname — could erase a chat transcript with
// one blind request. This boots a real server and proves the DELETE is refused
// from both untrusted shapes while the shell's own same-origin request (and a
// non-browser client that sends no Origin) still deletes.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

function seedChat(designRoot: string, id: string): string {
  const dir = join(designRoot, '_chat');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ role: 'user', text: 'keep me' })}\n`);
  return file;
}

describe('DELETE /_api/acp/chat — CSRF + DNS-rebinding guard (V2-2.8 S2)', () => {
  test('a cross-origin or rebound DELETE is refused; the same-origin DELETE still works', async () => {
    const { root, designRoot } = makeSandbox();
    const victim = seedChat(designRoot, 'victim');
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    try {
      const base = `http://localhost:${port}`;

      // A forged cross-site DELETE: the browser stamps an Origin it cannot hide.
      const csrf = await fetch(`${base}/_api/acp/chat?id=victim`, {
        method: 'DELETE',
        headers: { origin: 'http://evil.example' },
      });
      expect(csrf.status).toBe(403);
      expect(existsSync(victim)).toBe(true);

      // A DNS-rebound page: Origin and Host are both the attacker's name, so the
      // Origin check alone passes — the loopback Host check must refuse it.
      const evil = `evil.example:${port}`;
      const rebound = await fetch(`${base}/_api/acp/chat?id=victim`, {
        method: 'DELETE',
        headers: { origin: `http://${evil}`, host: evil },
      });
      expect(rebound.status).toBe(403);
      expect(existsSync(victim)).toBe(true);

      // The shell itself (same origin, loopback Host) still deletes.
      const own = await fetch(`${base}/_api/acp/chat?id=victim`, {
        method: 'DELETE',
        headers: { origin: base },
      });
      expect(own.status).toBe(200);
      expect(((await own.json()) as { ok: boolean }).ok).toBe(true);
      expect(existsSync(victim)).toBe(false);

      // A non-browser client (no Origin — the CLI, curl) is not the CSRF threat
      // and keeps working, exactly as for PATCH.
      const cli = seedChat(designRoot, 'cli');
      const plain = await fetch(`${base}/_api/acp/chat?id=cli`, { method: 'DELETE' });
      expect(plain.status).toBe(200);
      expect(existsSync(cli)).toBe(false);
    } finally {
      await killProc(proc);
    }
  }, 30_000);
});
