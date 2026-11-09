// 2.1.1 N5 — `POST /_api/hub-signin/start` refuses the same targets as `/check` (private, link-local and
// reserved IP literals; this Mac's own app services on loopback) before it probes anything. A loopback
// team server for local development and a public server still start.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { guardTableRoute } from '../http.ts';
import { createHubSigninRoutes } from '../routes/hub-signin.ts';

const SELF = 'http://127.0.0.1:4399';
const HOME_PORT = 51111;
const BRIDGE_PORT = 52222;
const refusedLocalPort = (p: number) => p === HOME_PORT || p === BRIDGE_PORT;

function route() {
  const started: string[] = [];
  const signIn = {
    start: async (url: string) => {
      started.push(url);
      return { ok: true, id: 's1', open: `${url}/sign-in` };
    },
    poll: () => ({ ok: true }),
    cancel: () => {},
    onReturn: async () => ({ ok: true }),
  };
  const spec = createHubSigninRoutes({ signIn, refusedLocalPort } as never).find(
    (s) => s.path === '/_api/hub-signin/start'
  );
  if (!spec) throw new Error('no start route');
  return { route: guardTableRoute(spec), started };
}

const post = (url: string) =>
  new Request(`${SELF}/_api/hub-signin/start`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:4399',
      origin: SELF,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

let logs: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  logs = (['log', 'warn', 'error', 'info'] as const).map((k) =>
    spyOn(console, k).mockImplementation(() => {})
  );
});
afterEach(() => {
  for (const s of logs) s.mockRestore();
});

describe('POST /_api/hub-signin/start', () => {
  test('a refused target answers bad-address and starts nothing', async () => {
    const { route: r, started } = route();
    for (const url of [
      'https://169.254.169.254',
      'https://10.0.0.8',
      `http://127.0.0.1:${HOME_PORT}`,
      `http://localhost:${BRIDGE_PORT}`,
    ]) {
      const res = await r.handle(post(url), {});
      expect(res.status, url).toBe(400);
      expect((await res.json()).reason, url).toBe('bad-address');
    }
    expect(started).toHaveLength(0);
  });

  test('a loopback dev server and a public server still start', async () => {
    const { route: r, started } = route();
    for (const url of ['http://127.0.0.1:4500', 'https://design.team.example']) {
      const res = await r.handle(post(url), {});
      expect(res.status, url).toBe(200);
    }
    expect(started).toEqual(['http://127.0.0.1:4500', 'https://design.team.example']);
  });
});
