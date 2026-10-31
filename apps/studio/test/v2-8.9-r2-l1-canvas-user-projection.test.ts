// V2-8.9 r2 L1 (defender) — `/_api/git-user` answers `localAuthor(...)`: the git `user.name`, else THIS
// MAC'S ACCOUNT NAME (`os.userInfo().username`). The route is canvas-safe, so canvas code could read the
// account name and write it into a canvas element or comment that syncs to the team server. The canvas
// origins now get a narrower answer — the git name, or "You", never the OS-account fallback (the
// `canvasCommitters` pattern, decision v2-2.8-s6-committers-projection). The shell keeps its answer.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import { canvasUserName } from '../http.ts';
import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

async function readCanvasOrigin(designRoot: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not written yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

describe('canvasUserName (pure)', () => {
  test('the git name, else "You" — never an OS account', () => {
    expect(canvasUserName('Ada Lovelace')).toBe('Ada Lovelace');
    expect(canvasUserName('  ')).toBe('You');
    expect(canvasUserName('')).toBe('You');
  });
});

describe('/_api/git-user — canvas-origin projection', () => {
  test('no git user.name: the canvas origin says "You", the shell keeps the account name', async () => {
    const account = userInfo().username;
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'c.tsx'), 'export default function C(){return <main/>}\n');
    const port = nextPort();
    // no global / system git config: `git config user.name` answers nothing
    const proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    });
    try {
      const canvas = await readCanvasOrigin(designRoot);
      const fc = await frameCap({ base: `http://localhost:${port}` }, {}, 'ui/c.tsx');
      const c = await fetch(withFc(`${canvas}/_api/git-user`, fc));
      expect(c.status).toBe(200);
      const raw = await c.text();
      expect((JSON.parse(raw) as { name: string }).name).toBe('You');
      if (account) expect(raw).not.toContain(account);

      const m = await fetch(`http://localhost:${port}/_api/git-user`);
      expect(m.status).toBe(200);
      expect(((await m.json()) as { name: string }).name).toBe(account || 'You');

      const post = await fetch(withFc(`${canvas}/_api/git-user`, fc), { method: 'POST' });
      expect(post.status).toBe(405);
    } finally {
      await killProc(proc);
    }
  }, 30_000);
});
