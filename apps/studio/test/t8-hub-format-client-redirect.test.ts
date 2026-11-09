// 2.1.1 T8 — the hub format client (health, mode, setMode, setFormat) never follows a redirect: the
// bearer it carries goes to the server it names and nowhere a 3xx points. A redirect answer reads as a
// refusal, not as the next server's word.
import { describe, expect, test } from 'bun:test';
import { createHubFormatClient } from '../migrate/hub.ts';

function recorder(answer: () => Response) {
  const seen: { url: string; redirect: RequestRedirect | undefined }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), redirect: init?.redirect });
    return answer();
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const HUB = { url: 'https://team.example.test', token: 'hubtok_t8' };
const redirect = () =>
  new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.test/' } });

describe('createHubFormatClient', () => {
  test('every call asks for redirect: manual', async () => {
    const { fetchImpl, seen } = recorder(redirect);
    const c = createHubFormatClient(HUB, fetchImpl);
    await c.health();
    await c.mode();
    await c.setMode('transactions', 1);
    await c.setFormat(2);
    expect(seen).toHaveLength(4);
    for (const s of seen) expect(s.redirect, s.url).toBe('manual');
  });

  test('a redirect answer is a refusal', async () => {
    const { fetchImpl } = recorder(redirect);
    const c = createHubFormatClient(HUB, fetchImpl);
    expect((await c.health()).ok).toBe(false);
    expect((await c.setFormat(2)).ok).toBe(false);
  });
});
