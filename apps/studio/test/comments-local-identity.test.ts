// rc.1 finding F08 — on a Mac with no git `user.name` a local comment is signed with the account name
// (`localAuthor`), but `/_api/git-user` (the viewer's identity for the Comments panel's Mine filter,
// presence, `maude design comments --mine`) answered "" — so the viewer was nobody, Mine read 0 after two
// comments they had just written, and the top bar fell back to "Y". One identity: the route answers the
// same name a new comment is stamped with.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { localAuthor } from '../comments/local-author.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

let proc: Subprocess | null = null;
let base = '';

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'card.tsx'), 'export default () => <p>card</p>;\n');
  const port = nextPort();
  proc = await bootServer(root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    // no git identity anywhere: the sandbox is no repo, and the global/system config is empty
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: root,
    XDG_CONFIG_HOME: join(root, '.config'),
  });
  base = `http://localhost:${port}`;
}, 40_000);

afterAll(async () => {
  if (proc) await killProc(proc);
});

describe('one local identity (F08)', () => {
  test('/_api/git-user names the viewer even with no git user.name', async () => {
    const r = await fetch(`${base}/_api/git-user`);
    const { name } = (await r.json()) as { name: string };
    expect(name).not.toBe('');
    expect(name).toBe(localAuthor(''));
  });

  test('a new comment is signed with that same name', async () => {
    const { name } = (await (await fetch(`${base}/_api/git-user`)).json()) as { name: string };
    const file = '.design/ui/card.tsx';
    const r = await fetch(`${base}/_api/comments/op`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ op: 'add', file, text: 'hello' }),
    });
    const j = (await r.json()) as { comment?: { author?: string } };
    expect(r.status).toBe(200);
    expect(j.comment?.author).toBe(name);
  });
});
