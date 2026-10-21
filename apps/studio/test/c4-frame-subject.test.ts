// gate-b-c4b — the frame key's subject in a cell (lead: Option A). The proxy's vouched member
// (`x-maude-user`) first; a session it vouches with no member falls back to that SESSION — so its
// canvas renders — and one session's capability never opens a frame for another session (or for
// a member). A request nobody vouched gets no key at all.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { frameSubjectOf } from '../access/frame.ts';
import { A_REL, type AclCell, bootAclCell, frameCap, get, OWNER, withFc } from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

describe('frameSubjectOf', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  test('member first, then the session, then nobody', () => {
    expect(frameSubjectOf(h({ 'x-maude-user': 'a@x.cz', 'x-maude-session': 's1' }))).toBe('a@x.cz');
    expect(frameSubjectOf(h({ 'x-maude-session': 's1' }))).toBe('\0session\0s1');
    expect(frameSubjectOf(h({}))).toBeNull();
    expect(frameSubjectOf(h({ 'x-maude-user': '  ' }))).toBeNull();
  });
  test('a session subject is never a member subject', () => {
    expect(frameSubjectOf(h({ 'x-maude-session': 'a@x.cz' }))).not.toBe(
      frameSubjectOf(h({ 'x-maude-user': 'a@x.cz' }))
    );
  });
});

describe('booted cell', () => {
  let cell: AclCell;
  const S1 = { ...OWNER, 'x-maude-session': 'sess-one' };
  const S2 = { ...OWNER, 'x-maude-session': 'sess-two' };
  const MOD = `/.design/${A_REL}`;
  beforeAll(async () => {
    cell = await bootAclCell();
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  test('a session with no member gets a frame key, and its frame renders', async () => {
    const fc = await frameCap(cell, S1, A_REL);
    expect(fc).toBeTruthy();
    expect((await get(withFc(cell.canvasBase + MOD, fc), S1)).status).toBe(200);
  });

  test("two sessions cannot use each other's capability", async () => {
    const fc1 = await frameCap(cell, S1, A_REL);
    const fc2 = await frameCap(cell, S2, A_REL);
    expect(fc1).not.toBe(fc2);
    expect((await get(withFc(cell.canvasBase + MOD, fc1), S2)).status).toBe(403);
    expect((await get(withFc(cell.canvasBase + MOD, fc2), S1)).status).toBe(403);
    // …nor a member's, nor a member a session's
    const member = { ...OWNER, 'x-maude-user': 'sess-one' };
    expect((await get(withFc(cell.canvasBase + MOD, fc1), member)).status).toBe(403);
  });

  test('a request nobody vouched gets no key', async () => {
    expect(await frameCap(cell, OWNER, A_REL)).toBeNull();
  });
});
