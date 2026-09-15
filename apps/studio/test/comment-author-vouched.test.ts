// In a cloud cell a comment is signed by the member who wrote it (plan T31,
// L11). The cell's own git identity is the machine ("Maude Workspace"), and
// every comment carried it: nobody's comment was theirs, so nobody could edit
// their own. The proxy vouches the member per request and per socket; the
// studio signs with that, and a frame cannot claim somebody else.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CANVAS = '.design/ui/fixture.html';

function vouched(user: string) {
  return {
    'x-maude-session': 'aaaaaaaaaaaaaaaa',
    'x-maude-role': 'member',
    'x-maude-readonly': '0',
    'x-maude-user': user,
  };
}

describe('comment authorship in a cell', () => {
  test('a new comment and a reply are signed by the vouched member', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    });
    try {
      const ws = new WebSocket(`ws://localhost:${port}/_ws`, {
        headers: vouched('alice@team.test'),
      } as unknown as string[]);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no socket')), 5000);
        ws.addEventListener('open', () => {
          clearTimeout(t);
          resolve();
        });
        ws.addEventListener('error', (e) => reject(e));
      });
      // The frame claims someone else; the socket says who it is.
      ws.send(
        JSON.stringify({
          type: 'comments-add',
          payload: { file: CANVAS, selector: 'h1', text: 'Tighten this', author: 'Mallory' },
        })
      );
      const sidecar = join(designRoot, '_comments', 'ui-fixture.json');
      const read = () => {
        try {
          const j = JSON.parse(readFileSync(sidecar, 'utf8'));
          return (Array.isArray(j) ? j : (j.comments ?? [])) as Array<{
            id: string;
            author: string;
            thread?: Array<{ author: string }>;
          }>;
        } catch {
          return [];
        }
      };
      const deadline = Date.now() + 5000;
      while (read().length === 0 && Date.now() < deadline) await Bun.sleep(50);
      const [c] = read();
      expect(c?.author).toBe('alice@team.test');

      const r = await fetch(`http://localhost:${port}/_api/comments/${c?.id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...vouched('bob@team.test') },
        body: JSON.stringify({ body: 'On it', author: 'Mallory' }),
      });
      expect(r.status).toBe(200);
      expect(read()[0]?.thread?.[0]?.author).toBe('bob@team.test');
      ws.close();
    } finally {
      await killProc(proc);
    }
  });
});
