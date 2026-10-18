// S9.22b — `/_config.canComment`: the server's answer, from the session's access, to "may this session
// comment?". Before it the server never sent the field, so a Can comment session (read-only, `ro=1`) never
// got `cm=1` on its canvas URL and could not reply or resolve in the overlay.
//
// The answer is the SERVER's (the proxy-stamped access claim, never a client flag): true for Can comment
// and up, false for Can view; a canvas-only session answers exactly like a session with no claim at all
// (project-level `comment` needs a project role — the op door still judges each op on its own canvas).
// Bytes on the wire, never the DOM.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  asRole,
  bootCanaryCell,
  type Cell,
  canvasOnly,
  get,
  OWNER,
} from './_acl-canvas-fixture.ts';

let cell: Cell;
beforeAll(async () => {
  cell = await bootCanaryCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

const canComment = async (headers: Record<string, string>) => {
  const r = await get(cell, '/_config', headers);
  expect(r.status).toBe(200);
  return (r.json as { canComment?: unknown }).canComment;
};

describe('/_config canComment (S9.22b)', () => {
  test('Can comment and up: true — even while read-only', async () => {
    expect(await canComment(OWNER)).toBe(true);
    expect(await canComment(asRole('member'))).toBe(true);
    const viewer = await get(cell, '/_config', asRole('viewer'));
    expect((viewer.json as { readOnly: boolean }).readOnly).toBe(true);
    expect((viewer.json as { canComment: boolean }).canComment).toBe(true);
  });

  test('Can view: false', async () => {
    expect(await canComment(asRole('observer'))).toBe(false);
  });

  test('a canvas-only session gets the same answer as a missing field (no), whatever its grant', async () => {
    // The client reads `data.canComment === true`; an older server sends no field at all.
    const project = (v: unknown) => v === true;
    for (const r of ['observer', 'viewer', 'member'] as const) {
      const got = await canComment(canvasOnly(r));
      expect(got).toBe(false);
      expect(project(got)).toBe(project(undefined));
    }
  });

  test('a client cannot talk its way in: a forged readonly / role header changes nothing', async () => {
    const forged = {
      ...asRole('observer'),
      'x-maude-role': 'owner',
      'x-maude-readonly': '0',
      'x-maude-can-comment': '1',
    };
    expect(await canComment(forged)).toBe(false);
  });
});
