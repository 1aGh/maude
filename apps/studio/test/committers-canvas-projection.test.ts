// V2-2.8 S6 — committer e-mails never reach the untrusted canvas origin.
//
// `/_api/git-committers` (`git shortlog -sne`, top 20) feeds the @mention
// suggestions of the comment composer, which runs INSIDE the canvas iframe —
// the untrusted, segregated origin (DDR-054). It sat in both canvas allowlists
// (DDR-088) and answered names AND e-mail addresses, so any canvas code (a
// synced teammate's `.tsx`) could read every committer's e-mail (V2-1.16
// L15/L17).
//
// Decision (lead, decision:maude/v2-2.8-s6-committers-projection — a deliberate
// deviation from V2-1.16, which said "remove"): the feature stays, the leak
// goes. The canvas origin gets a projection with NO e-mail field at all
// (names and commit counts only); the main origin — the trusted shell — keeps
// the full answer. A mention is inserted and stored as `@firstname`, so nothing
// downstream needs the address.

import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const AUTHORS = [
  { name: 'Alice Example', email: 'alice.example@studio-mail.example.com' },
  { name: 'Bob Builder', email: 'bob+maude@builders.example.org' },
  // A name that IS an address — still an address.
  { name: 'carol@carol-design.example.net', email: 'carol@carol-design.example.net' },
];

function git(root: string, args: string[], env: Record<string, string> = {}): void {
  const r = Bun.spawnSync(['git', ...args], {
    cwd: root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
}

function seedRepo(root: string): void {
  git(root, ['init', '-q', '-b', 'main']);
  AUTHORS.forEach((a, i) => {
    writeFileSync(join(root, `f${i}.txt`), String(i));
    git(root, ['add', `f${i}.txt`]);
    git(root, ['commit', '-q', '-m', `c${i}`], {
      GIT_AUTHOR_NAME: a.name,
      GIT_AUTHOR_EMAIL: a.email,
      GIT_COMMITTER_NAME: a.name,
      GIT_COMMITTER_EMAIL: a.email,
    });
  });
}

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

type Row = Record<string, unknown>;

describe('/_api/git-committers — canvas-origin projection (V2-2.8 S6)', () => {
  test('the canvas origin answers names without any e-mail; the shell keeps the full list', async () => {
    const { root, designRoot } = makeSandbox();
    seedRepo(root);
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    try {
      const canvas = await readCanvasOrigin(designRoot);

      const c = await fetch(`${canvas}/_api/git-committers`);
      expect(c.status).toBe(200);
      const raw = await c.text();
      // Not one address — in a field, in a name, anywhere in the body.
      expect(raw).not.toContain('@');
      for (const a of AUTHORS) expect(raw).not.toContain(a.email);
      const rows = (JSON.parse(raw) as { committers: Row[] }).committers;
      expect(rows.length).toBe(AUTHORS.length);
      for (const row of rows) {
        expect('email' in row).toBe(false); // absent, not a blank string
        expect(typeof row.name).toBe('string');
        expect(typeof row.commits).toBe('number');
      }
      const names = rows.map((r) => r.name);
      expect(names).toContain('Alice Example');
      expect(names).toContain('Bob Builder');
      expect(names).toContain('carol'); // the address-shaped name keeps its handle only

      // The trusted shell (main origin) is unchanged: names AND e-mails.
      const m = await fetch(`http://localhost:${port}/_api/git-committers`);
      expect(m.status).toBe(200);
      const full = (await m.json()) as { committers: Row[] };
      const emails = full.committers.map((r) => r.email);
      for (const a of AUTHORS) expect(emails).toContain(a.email);

      // Still a GET-only route on the canvas origin (DDR-088 posture).
      const post = await fetch(`${canvas}/_api/git-committers`, { method: 'POST', body: '{}' });
      expect(post.status).toBe(405);
    } finally {
      await killProc(proc);
    }
  }, 30_000);
});
