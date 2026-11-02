// gate-b-c4k (LOW) — the inspector socket's scope check reads the canvas a `comments-add` frame
// WRITES (`payload.file`, what the handler and the comment check read), not a top-level `file`
// the frame may carry beside it. A canvas-only socket naming a visible A at the top and B in the
// payload is answered as if B did not exist — nothing at all — like a frame naming B outright.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import { A_ONLY, A_REL, type AclCell, asUser, B_REL, bootAclCell, until } from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

async function openSocket(url: string, headers: Record<string, string>) {
  const ws = new WebSocket(url, { headers } as unknown as string[]);
  const texts: string[] = [];
  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') texts.push(e.data);
  });
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve(true);
    });
    ws.addEventListener('error', () => resolve(false));
  });
  return ok ? { ws, texts } : null;
}

describe('booted cell — a canvas-only socket cannot borrow a visible file for its scope check', () => {
  let cell: AclCell;
  beforeAll(async () => {
    cell = await bootAclCell();
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  test('comments-add with file: A and payload.file: B is answered with nothing, stores nothing', async () => {
    const sock = await openSocket(
      `${cell.base.replace('http', 'ws')}/_ws`,
      asUser(A_ONLY, 'grantee@example.com')
    );
    expect(sock).not.toBeNull();
    if (!sock) return;
    await Bun.sleep(300);
    sock.texts.length = 0;
    sock.ws.send(
      JSON.stringify({
        type: 'comments-add',
        file: `.design/${A_REL}`,
        payload: { file: `.design/${B_REL}`, selector: 'img', text: 'SMUGGLED' },
      })
    );
    const answered = await until(() => sock.texts.some((t) => t.includes('"refused"')), 1500);
    sock.ws.close();
    expect(answered).toBe(false);
    const sidecar = join(
      cell.designRoot,
      '_comments',
      `${canvasSlugFromRel(B_REL, '.design')}.json`
    );
    let stored = '';
    try {
      stored = readFileSync(sidecar, 'utf8');
    } catch {
      /* none — as expected */
    }
    expect(stored).not.toContain('SMUGGLED');
  });
});
