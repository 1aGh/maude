// Cloud Phase 3 Task 3 — "Sign in to workspace".
//
// The persona is the invited teammate who has never used git. So alongside the
// mechanics (probe, login, credential custody) these tests assert the WORDS:
// a flow that says "paste your bearer token" has already told that person the
// product isn't for them (DDR-193 §5).

import { describe, expect, test } from 'bun:test';

import {
  type DisclosureItem,
  signInToWorkspace,
  workspaceDisclosure,
} from '../sync/workspace-signin.ts';

/** A fetch stand-in scripted per URL suffix, recording what it was called with. */
function scriptedFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    for (const [suffix, make] of Object.entries(routes)) {
      if (href.endsWith(suffix)) return make();
    }
    throw new Error(`unrouted ${href}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HEALTHY = () => json({ ok: true, version: '0.48.0' });
const LOGGED_IN = () =>
  json({
    token: 'mau_0123456789abcdef0123456789abcdef',
    label: 'u-abcdef012345',
    expiresAt: 1_800_000_000_000,
    user: { email: 'alice@example.com', role: 'member' },
  });

const CREDS = {
  url: 'https://team.example.com',
  email: 'alice@example.com',
  password: 'hunter2222222',
};

describe('input validation speaks to a person, not a developer', () => {
  test('each missing field names what to do next', async () => {
    const saved: string[] = [];
    const save = (u: string) => void saved.push(u);
    for (const [input, expected] of [
      [{}, /address your team sent you/i],
      [{ url: 'https://x.example.com' }, /email address/i],
      [{ url: 'https://x.example.com', email: 'a@b.com' }, /password/i],
    ] as const) {
      const res = await signInToWorkspace(input, { save, fetchImpl: scriptedFetch({}).impl });
      expect(res.status).toBe(400);
      expect(res.json.ok).toBe(false);
      expect((res.json as { error: string }).error).toMatch(expected);
    }
    expect(saved).toEqual([]);
  });

  test('a non-http address is refused before anything is sent', async () => {
    const { impl, calls } = scriptedFetch({});
    const res = await signInToWorkspace(
      { ...CREDS, url: 'file:///etc/passwd' },
      { fetchImpl: impl, save: () => {} }
    );
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('credential custody', () => {
  test('the health probe is TOKENLESS and carries no password', async () => {
    // A lookalike address must never receive a credential (phase-29 A2).
    const { impl, calls } = scriptedFetch({ '/health': HEALTHY, '/auth/login': LOGGED_IN });
    await signInToWorkspace(CREDS, { fetchImpl: impl, save: () => {} });

    const probe = calls.find((c) => c.url.endsWith('/health'));
    expect(probe).toBeDefined();
    expect(probe?.init?.body).toBeUndefined();
    expect(JSON.stringify(probe?.init?.headers ?? {})).not.toContain('Authorization');
  });

  test('the password goes ONLY to the typed address, once, and is never stored', async () => {
    const stored: Array<{ url: string; token: string }> = [];
    const { impl, calls } = scriptedFetch({ '/health': HEALTHY, '/auth/login': LOGGED_IN });
    await signInToWorkspace(CREDS, {
      fetchImpl: impl,
      save: (url, token) => void stored.push({ url, token }),
    });

    const withPassword = calls.filter((c) => String(c.init?.body ?? '').includes('hunter2222222'));
    expect(withPassword).toHaveLength(1);
    expect(withPassword[0]?.url).toBe('https://team.example.com/auth/login');

    // What is persisted is the minted TOKEN — never the password.
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token).toBe('mau_0123456789abcdef0123456789abcdef');
    expect(JSON.stringify(stored)).not.toContain('hunter2222222');
  });

  test('the account the workspace vouched is saved with the token (Settings › Signed in as)', async () => {
    const stored: Array<{ account?: string }> = [];
    const { impl } = scriptedFetch({ '/health': HEALTHY, '/auth/login': LOGGED_IN });
    await signInToWorkspace(CREDS, {
      fetchImpl: impl,
      save: (_u, _t, _r, _e, account) => void stored.push({ account }),
    });
    expect(stored).toEqual([{ account: 'alice@example.com' }]);
  });

  test('nothing is saved when sign-in fails', async () => {
    const stored: string[] = [];
    const { impl } = scriptedFetch({
      '/health': HEALTHY,
      '/auth/login': () => json({ error: 'invalid email or password' }, 401),
    });
    const res = await signInToWorkspace(CREDS, {
      fetchImpl: impl,
      save: (u) => void stored.push(u),
    });
    expect(res.status).toBe(401);
    expect(stored).toEqual([]);
  });
});

describe('failure modes are distinguishable and actionable', () => {
  test('an unreachable address says so, and never reaches login', async () => {
    const { impl, calls } = scriptedFetch({
      '/health': () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const res = await signInToWorkspace(CREDS, { fetchImpl: impl, save: () => {} });
    expect((res.json as { reason: string }).reason).toBe('unreachable');
    expect((res.json as { error: string }).error).toMatch(/couldn't reach/i);
    expect(calls.some((c) => c.url.includes('/auth/login'))).toBe(false);
  });

  test('an address that answers but is not a Maude workspace is named as such', async () => {
    // A typo'd address that lands on someone else's server would otherwise fail
    // later as a mysterious auth error.
    const { impl } = scriptedFetch({ '/health': () => json({ status: 'ok, but not maude' }) });
    const res = await signInToWorkspace(CREDS, { fetchImpl: impl, save: () => {} });
    expect((res.json as { reason: string }).reason).toBe('not-a-maude-workspace');
    expect((res.json as { error: string }).error).toMatch(/isn't a Maude workspace/i);
  });

  test('bad credentials do not guess WHICH half was wrong', async () => {
    // The hub refuses to be a user-existence oracle, so the client must not
    // invent one by saying "wrong password" when the account may not exist.
    const { impl } = scriptedFetch({
      '/health': HEALTHY,
      '/auth/login': () => json({ error: 'invalid email or password' }, 401),
    });
    const res = await signInToWorkspace(CREDS, { fetchImpl: impl, save: () => {} });
    const error = (res.json as { error: string }).error;
    expect(error).not.toMatch(/no such (user|account)/i);
    expect(error).not.toMatch(/wrong password/i);
    expect(error).toMatch(/not accepted/i);
  });

  test('rate limiting says to wait rather than to retry', async () => {
    const { impl } = scriptedFetch({
      '/health': HEALTHY,
      '/auth/login': () => json({ error: 'rate limit exceeded' }, 429),
    });
    const res = await signInToWorkspace(CREDS, { fetchImpl: impl, save: () => {} });
    expect((res.json as { reason: string }).reason).toBe('rate-limited');
    expect((res.json as { error: string }).error).toMatch(/wait a minute/i);
  });

  test("a cloud workspace's 400 message reaches the person verbatim (Phase 23 B3)", async () => {
    // The hub's cloud-identity refusal comes WITH directions ("sign in through
    // Maude Cloud" / what viewing needs). Swallowing it into "try again
    // shortly" turned the most actionable message on this path into a shrug.
    const { impl } = scriptedFetch({
      '/health': HEALTHY,
      '/auth/login': () =>
        json(
          {
            error:
              'This workspace signs in through Maude Cloud — use Sign in to Maude Cloud in the app.',
          },
          400
        ),
    });
    const res = await signInToWorkspace(CREDS, { fetchImpl: impl, save: () => {} });
    expect(res.status).toBe(400);
    expect((res.json as { reason: string }).reason).toBe('cloud-identity');
    expect((res.json as { error: string }).error).toMatch(/signs in through Maude Cloud/);
    expect((res.json as { error: string }).error).not.toMatch(/try again shortly/i);
  });

  test('a failed save is reported instead of pretending success', async () => {
    const { impl } = scriptedFetch({ '/health': HEALTHY, '/auth/login': LOGGED_IN });
    const res = await signInToWorkspace(CREDS, {
      fetchImpl: impl,
      save: () => {
        throw new Error('read-only fs');
      },
    });
    expect((res.json as { reason: string }).reason).toBe('save-failed');
  });
});

describe('success', () => {
  test('returns the person and their session, never the token', async () => {
    const { impl } = scriptedFetch({ '/health': HEALTHY, '/auth/login': LOGGED_IN });
    const res = await signInToWorkspace(CREDS, { fetchImpl: impl, save: () => {} });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      ok: true,
      url: 'https://team.example.com',
      user: { email: 'alice@example.com', role: 'member' },
      expiresAt: 1_800_000_000_000,
      version: '0.48.0',
    });
    // The token must not travel back to the UI layer — it has no use for it and
    // every surface that holds one is a surface that can leak one.
    expect(JSON.stringify(res.json)).not.toContain('mau_');
  });

  test('a trailing slash or bare host normalizes to the same workspace', async () => {
    const stored: string[] = [];
    for (const url of ['https://team.example.com/', 'https://team.example.com']) {
      const { impl } = scriptedFetch({ '/health': HEALTHY, '/auth/login': LOGGED_IN });
      await signInToWorkspace(
        { ...CREDS, url },
        { fetchImpl: impl, save: (u) => void stored.push(u) }
      );
    }
    expect(new Set(stored).size).toBe(1);
  });
});

describe('the disclosure panel — DDR-054 made visible (DDR-192 §6)', () => {
  const text = (items: DisclosureItem[]) => items.map((i) => `${i.title} ${i.detail}`).join(' ');

  test('it says what the operator CAN see, not only what they cannot', () => {
    // A disclosure that only lists reassurances is marketing. The point is that
    // the person can decide, which requires the uncomfortable half.
    const items = workspaceDisclosure({ operator: 'your team', aiAvailable: true });
    const sees = items.filter((i) => i.kind === 'sees');
    expect(sees.length).toBeGreaterThanOrEqual(3);
    expect(text(sees)).toMatch(/edit history/i);
    expect(text(sees)).toMatch(/when you are editing/i);
    expect(text(sees)).toMatch(/comments/i);
  });

  test('it names the containment invariant in words a person understands', () => {
    const items = workspaceDisclosure({ operator: 'Maude Cloud', aiAvailable: true });
    expect(text(items)).toMatch(/never executes them/i);
    expect(text(items)).toMatch(/render here, on your machine/i);
  });

  test('it names the operator, so "who can see this" has an answer', () => {
    const items = workspaceDisclosure({ operator: 'Acme Design Ltd', aiAvailable: true });
    expect(text(items)).toContain('Acme Design Ltd');
  });

  test('the AI-less state is stated as a fact, not an error', () => {
    // Phase 6's persona: an invitee without a Claude subscription gets a
    // first-class product, not a broken one.
    const off = workspaceDisclosure({ operator: 'your team', aiAvailable: false });
    const ai = off.find((i) => i.title.includes('AI'));
    expect(ai?.detail).toMatch(/Everything else works normally/i);
    expect(ai?.detail).not.toMatch(/error|unavailable|failed|missing/i);

    const on = workspaceDisclosure({ operator: 'your team', aiAvailable: true });
    expect(on.find((i) => i.title.includes('AI'))?.detail).toMatch(/your own subscription/i);
  });

  test('it promises the exit, because that is what makes the rest believable', () => {
    const items = workspaceDisclosure({ operator: 'Maude Cloud', aiAvailable: true });
    expect(text(items)).toMatch(/opens without Maude/i);
  });

  test('no jargon reaches the person', () => {
    // DDR-193 §5 — the product word is "project"/"workspace". These words on an
    // invite path tell a non-developer the product is not for them.
    const items = workspaceDisclosure({ operator: 'your team', aiAvailable: false });
    const all = text(items).toLowerCase();
    for (const word of [
      'token',
      'repository',
      'repo ',
      'oauth',
      'bearer',
      'crdt',
      'yjs',
      'commit',
    ]) {
      expect(all).not.toContain(word);
    }
  });
});
