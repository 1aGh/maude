// 2.1.1 T8 — the team-server address check (`POST /_api/hub-signin/check`) never sends its GET to a
// private, link-local or reserved IP literal, nor to this Mac's own app services on loopback (Home,
// the token bridge). A loopback team server for local development and a public server still answer.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { guardTableRoute } from '../http.ts';
import { checkTargetRefusal, createHubSigninRoutes } from '../routes/hub-signin.ts';

const SELF = 'http://127.0.0.1:4399';
const HOME_PORT = 51111;
const BRIDGE_PORT = 52222;
const refusedLocalPort = (p: number) => p === HOME_PORT || p === BRIDGE_PORT;

function route() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return Response.json({ ok: true, version: '2.1.1' });
  }) as typeof fetch;
  const spec = createHubSigninRoutes({ fetchImpl, refusedLocalPort }).find(
    (s) => s.path === '/_api/hub-signin/check'
  );
  if (!spec) throw new Error('no check route');
  return { route: guardTableRoute(spec), calls };
}

const post = (url: string) =>
  new Request(`${SELF}/_api/hub-signin/check`, {
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

describe('checkTargetRefusal', () => {
  test('private, link-local and reserved IP literals are refused', () => {
    for (const url of [
      'https://10.0.0.5',
      'https://192.168.1.10:8443',
      'https://172.16.0.1',
      'https://169.254.169.254',
      'https://[fe80::1]',
      'https://[fd00::1]',
      'https://0.0.0.0',
    ])
      expect(checkTargetRefusal(url, refusedLocalPort), url).toBe('private-address');
  });
  test("this Mac's Home and token-bridge ports are refused on loopback", () => {
    expect(checkTargetRefusal(`http://127.0.0.1:${HOME_PORT}`, refusedLocalPort)).toBe(
      'local-service'
    );
    expect(checkTargetRefusal(`http://localhost:${BRIDGE_PORT}`, refusedLocalPort)).toBe(
      'local-service'
    );
    expect(checkTargetRefusal(`http://[::1]:${BRIDGE_PORT}`, refusedLocalPort)).toBe(
      'local-service'
    );
  });
  test('a local dev team server, a public IP and a host name pass', () => {
    expect(checkTargetRefusal('http://127.0.0.1:4500', refusedLocalPort)).toBeNull();
    expect(checkTargetRefusal('https://93.184.216.34', refusedLocalPort)).toBeNull();
    expect(checkTargetRefusal('https://design.team.example', refusedLocalPort)).toBeNull();
  });
});

describe('POST /_api/hub-signin/check', () => {
  test('a refused target answers bad-address and sends nothing', async () => {
    const { route: r, calls } = route();
    for (const url of ['https://169.254.169.254', `http://127.0.0.1:${HOME_PORT}`]) {
      const res = await r.handle(post(url), {});
      expect(res.status, url).toBe(400);
      expect((await res.json()).reason, url).toBe('bad-address');
    }
    expect(calls).toHaveLength(0);
  });
  test('a loopback dev server is still checked', async () => {
    const { route: r, calls } = route();
    const res = await r.handle(post('http://127.0.0.1:4500'), {});
    expect(res.status).toBe(200);
    expect(calls).toEqual(['http://127.0.0.1:4500/health']);
  });
});
