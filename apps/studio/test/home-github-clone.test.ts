// S6.10 — the clone behind "From GitHub" on Home (`/_home/internal/github/clone`, Rust's
// github_clone). Internal only; the URL is rebuilt from a validated owner/repo; the token goes to
// the clone as auth and never comes back in an answer; a project without a design system gets one.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHomeGithub } from '../home/github.ts';
import { HOST, homeFetch, homeReq, TOKEN } from './_home-fixtures.ts';

const SECRET = 'gho_s610SECRET000000000000000000000000';
const ROUTE = '/_home/internal/github/clone';

type Call = { url: string; dir: string; token?: string };

function fakeClone(result: { ok: boolean; authRequired?: boolean; error?: string } = { ok: true }) {
  const calls: Call[] = [];
  const clone = async (url: string, dir: string, token?: string) => {
    calls.push({ url, dir, token });
    if (result.ok) writeFileSync(join(dir, 'README.md'), '# cloned\n');
    return result.ok ? { ok: true as const, dir } : { ok: false as const, ...result };
  };
  return { calls, clone: clone as never };
}

const emptyDir = () => {
  const d = join(mkdtempSync(join(tmpdir(), 'maude-s610-')), 'brand');
  mkdirSync(d);
  return d;
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://${HOST}${ROUTE}`, {
    method: 'POST',
    headers: {
      host: HOST,
      'x-maude-home': '1',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('Home GitHub clone (S6.10)', () => {
  test('is internal: the page secret alone, or no bearer, is refused', async () => {
    const f = fakeClone();
    const fetchHome = homeFetch({ github: createHomeGithub({ clone: f.clone }) });
    const body = JSON.stringify({ owner: 'o', repo: 'r', target: emptyDir() });
    const page = await fetchHome(
      homeReq(ROUTE, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
    );
    expect(page.status).toBe(403);
    const noBearer = await fetchHome(post({ owner: 'o', repo: 'r' }, { authorization: '' }));
    expect(noBearer.status).toBe(403);
    expect(f.calls).toEqual([]);
  });

  test('clones the canonical URL with the token as auth, and never answers the token', async () => {
    const f = fakeClone();
    const fetchHome = homeFetch({ github: createHomeGithub({ clone: f.clone }) });
    const target = emptyDir();
    const res = await fetchHome(
      post({ owner: 'brno-alligators', repo: 'brand', target, token: SECRET })
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(f.calls).toEqual([
      { url: 'https://github.com/brno-alligators/brand.git', dir: target, token: SECRET },
    ]);
    const j = JSON.parse(text);
    expect(j.ok).toBe(true);
    expect(j.hadDesign).toBe(false);
    // a repo with no design system opens as a project: it gets the one every new project gets
    expect(existsSync(join(target, '.design'))).toBe(true);
  });

  test('a public repo clones without a token', async () => {
    const f = fakeClone();
    const fetchHome = homeFetch({ github: createHomeGithub({ clone: f.clone }) });
    const res = await fetchHome(post({ owner: '1aGh', repo: 'personal-page', target: emptyDir() }));
    expect(res.status).toBe(200);
    expect(f.calls[0].token).toBeUndefined();
  });

  test('refuses what Rust would never send: bad names, a used or linked folder, an odd token', async () => {
    const f = fakeClone();
    const fetchHome = homeFetch({ github: createHomeGithub({ clone: f.clone }) });
    const used = emptyDir();
    writeFileSync(join(used, 'x'), 'x');
    const link = join(mkdtempSync(join(tmpdir(), 'maude-s610-')), 'link');
    symlinkSync(emptyDir(), link);
    for (const body of [
      { owner: 'evil.example/x', repo: 'r', target: emptyDir() },
      { owner: '-o', repo: 'r', target: emptyDir() },
      { owner: 'o', repo: '..', target: emptyDir() },
      { owner: 'o', repo: 'r/../../x', target: emptyDir() },
      { owner: 'o', repo: 'r', target: used },
      { owner: 'o', repo: 'r', target: link },
      { owner: 'o', repo: 'r', target: 'relative/dir' },
      { owner: 'o', repo: 'r', target: emptyDir(), token: 'a b' },
      { owner: 'o', repo: 'r', target: emptyDir(), token: 42 },
    ]) {
      const res = await fetchHome(post(body));
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(f.calls).toEqual([]);
  });

  test('a failed clone answers fixed words, never what the clone said', async () => {
    for (const [result, status] of [
      [{ ok: false, authRequired: true, error: `401 for ${SECRET}` }, 401],
      [{ ok: false, error: `fatal: https://${SECRET}@github.com/o/r` }, 502],
    ] as const) {
      const f = fakeClone(result);
      const fetchHome = homeFetch({ github: createHomeGithub({ clone: f.clone }) });
      const res = await fetchHome(
        post({ owner: 'o', repo: 'r', target: emptyDir(), token: SECRET })
      );
      expect(res.status).toBe(status);
      expect(await res.text()).not.toContain(SECRET);
    }
  });
});
