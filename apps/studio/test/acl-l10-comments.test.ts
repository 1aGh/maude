// S9.10 — V2-1.16 L10: comments, browser door (the ws half is S9.11's `visibleTo`).
//
// B's comment holds the canary. As A-only: `/_comments-all` holds no B key; a reply to B's
// id answers exactly like a reply to an id that never existed (U1) — and B's thread is not
// touched, even when the body names A as its file; `/_comments?file=B` is the `not-in-scope`
// a missing file gets. A reply to A's own comment still lands (the gate resolves id → file).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  A,
  A_COMMENT_ID,
  A_ONLY,
  B,
  B_COMMENT_ID,
  bootCanaryCell,
  type Cell,
  canaries,
  canvasOnly,
  get,
  OWNER,
  send,
} from './_acl-canvas-fixture.ts';

let cell: Cell;
beforeAll(async () => {
  cell = await bootCanaryCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

const bThread = () =>
  (
    JSON.parse(readFileSync(join(cell.designRoot, '_comments', 'b.json'), 'utf8')) as Array<{
      thread: unknown[];
    }>
  )[0]?.thread ?? [];

describe('L10 — comments for a canvas-only session', () => {
  test('/_comments-all: only A; the owner sees B', async () => {
    const owner = await get(cell, '/_comments-all', OWNER);
    expect(canaries(owner.text).length).toBeGreaterThan(0);
    const r = await get(cell, '/_comments-all', A_ONLY);
    expect(r.status).toBe(200);
    expect(canaries(r.text)).toEqual([]);
    expect(Object.keys(r.json as object)).toEqual([A]);
  });

  test('a reply to B’s id is a reply to a missing id, and B is untouched', async () => {
    const reply = (id: string, body: Record<string, unknown> = {}) =>
      send(cell, 'POST', `/_api/comments/${id}/reply`, A_ONLY, { body: 'hi', ...body });
    const toB = await reply(B_COMMENT_ID);
    const toMissing = await reply('c_000000000000');
    expect(toB.status).toBe(404);
    expect({ status: toB.status, text: toB.text }).toEqual({
      status: toMissing.status,
      text: toMissing.text,
    });
    // Naming A as the file does not smuggle the reply onto B's id.
    const smuggled = await reply(B_COMMENT_ID, { file: A });
    expect({ status: smuggled.status, text: smuggled.text }).toEqual({
      status: toMissing.status,
      text: toMissing.text,
    });
    expect(bThread()).toEqual([]);
    expect(canaries(toB.text + smuggled.text)).toEqual([]);
  });

  test('a reply to A’s own comment lands; an observer grant is refused', async () => {
    const ok = await send(cell, 'POST', `/_api/comments/${A_COMMENT_ID}/reply`, A_ONLY, {
      body: 'reply on A',
    });
    expect(ok.status).toBe(200);
    expect(canaries(ok.text)).toEqual([]);
    const observer = await send(
      cell,
      'POST',
      `/_api/comments/${A_COMMENT_ID}/reply`,
      canvasOnly('observer'),
      { body: 'nope' }
    );
    expect(observer.status).toBe(403);
    expect((observer.json as { error?: string }).error).toBe('read-only');
  });

  test('/_comments?file=B is the not-in-scope a missing file gets', async () => {
    const b = await get(cell, `/_comments?file=${encodeURIComponent(B)}`, A_ONLY);
    const missing = await get(cell, '/_comments?file=.design/ui/missing.tsx', A_ONLY);
    expect(b.status).toBe(403);
    expect(b.text).toBe(missing.text);
  });
});
