// Issue #204 task S — the desktop studio owns no login method for a team server. A request to open
// or prepare a team-server project that still carries an email or a password is refused with a
// plain 400 and NOTHING is sent to the hub; the only ways in are the hub's own sign-in page (a
// one-time code back, tested in hub-browser-signin.test.ts) and the pasted access token (the
// emergency path, tested in hub-link.test.ts and v2-settings.test.tsx).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NO_PASSWORD_WORDS,
  type PrepareInput,
  parsePrepareBody,
  prepareManagedProject,
} from '../managed-projects.ts';

const PASSWORD = 'never-leaves-the-app-9c1e';

let dir: string;
let hubsPath: string;
let calls: { url: string; init?: RequestInit }[];

/** A fetch that records every request and answers like a hub with a bootstrap. */
const spyFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init });
  const u = new URL(String(input));
  if (u.pathname.endsWith('/bootstrap'))
    return Response.json({ projectId: 'team-a', canvasGroups: ['ui'], mode: 'transactions' });
  return Response.json({ ok: true, token: 'peer-from-a-password-login' });
}) as unknown as typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maude-nopw-'));
  hubsPath = join(dir, 'hubs.json');
  calls = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('prepareManagedProject — a team server password is refused', () => {
  test('kind "hub" with an email and password → 400, nothing sent, nothing stored', async () => {
    const r = await prepareManagedProject(
      {},
      {
        kind: 'hub',
        url: 'https://team.example.test',
        email: 'ana@example.test',
        password: PASSWORD,
      } as unknown as PrepareInput,
      { hubsConfigPath: hubsPath, fetchImpl: spyFetch }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toBe(NO_PASSWORD_WORDS);
    expect(calls).toEqual([]);
    expect(existsSync(hubsPath)).toBe(false);
  });

  test('a password riding on a known-hub open is refused too, before any request', async () => {
    writeFileSync(
      hubsPath,
      JSON.stringify({ hubs: { 'https://team.example.test': { token: 'peer-held' } } })
    );
    const r = await prepareManagedProject(
      {},
      {
        kind: 'known-hub',
        url: 'https://team.example.test',
        password: PASSWORD,
      } as unknown as PrepareInput,
      { hubsConfigPath: hubsPath, fetchImpl: spyFetch }
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test('a credential this computer already holds still opens the project (known-hub)', async () => {
    writeFileSync(
      hubsPath,
      JSON.stringify({ hubs: { 'https://team.example.test': { token: 'peer-held' } } })
    );
    const r = await prepareManagedProject(
      {},
      { kind: 'known-hub', url: 'https://team.example.test' },
      { hubsConfigPath: hubsPath, fetchImpl: spyFetch }
    );
    expect(r.ok).toBe(true);
    // only the bootstrap read, with the stored token — never a login
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/projects/current/v1/bootstrap',
    ]);
    expect(readFileSync(hubsPath, 'utf8')).not.toContain(PASSWORD);
  });
});

describe('parsePrepareBody — the /_api/projects/prepare body', () => {
  test.each([
    [
      'hub kind',
      { kind: 'hub', url: 'https://t.example.test', email: 'a@b.test', password: PASSWORD },
    ],
    [
      'a password on known-hub',
      { kind: 'known-hub', url: 'https://t.example.test', password: PASSWORD },
    ],
    [
      'an email on known-hub',
      { kind: 'known-hub', url: 'https://t.example.test', email: 'a@b.test' },
    ],
    ['a password on a cloud open', { kind: 'cloud', projectId: 'p', password: PASSWORD }],
  ])('%s → refused with a 400 and the sign-in words', (_n, body) => {
    const r = parsePrepareBody(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toBe(NO_PASSWORD_WORDS);
    // the secret is never echoed back
    expect(JSON.stringify(r)).not.toContain(PASSWORD);
  });

  test('the kinds that stay parse as before', () => {
    expect(parsePrepareBody({ kind: 'cloud', projectId: 'p1' })).toEqual({
      ok: true,
      input: { kind: 'cloud', projectId: 'p1' },
    });
    expect(parsePrepareBody({ kind: 'handoff', code: 'c', claimedProject: '' })).toEqual({
      ok: true,
      input: { kind: 'handoff', code: 'c', claimedProject: undefined },
    });
    expect(parsePrepareBody({ kind: 'known-hub', url: 'https://t.example.test' })).toEqual({
      ok: true,
      input: { kind: 'known-hub', url: 'https://t.example.test' },
    });
  });

  test('an unknown kind is a 400', () => {
    const r = parsePrepareBody({ kind: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});
