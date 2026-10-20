// `/_api/figma/*` — the MAIN-origin half of DDR-216 D3.
//
// canvas-origin-gate.test.ts already asserts these routes are unreachable from
// the segregated canvas origin. That proves the wrong property on its own: the
// MAIN origin is reachable from any website the user visits while the dev
// server is up. Round 1 of the DDR-216 security review found the first draft
// named no CSRF / DNS-rebind guard at all, with a working PoC — a CORS-simple
// POST that plants an attacker's PAT (`connect`) or spends the user's on an
// attacker-chosen key (`probe`), opaque response, real side effect.
//
// So this file asserts the complementary half:
//   • cross-site  → 403 (Sec-Fetch-Site, the `sameOriginWrite` guard)
//   • foreign Host header → 403 (the DNS-rebinding `isTrustedRequestHost` guard)
//   • the stored key is NEVER echoed on ANY response path
//   • `probe` is gated as a WRITE even though it stores nothing — it spends the
//     credential and reaches the network.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const TOKEN = 'figd_ROUTECANARY_0123456789abcdef';

let proc: Subprocess;
let port: number;
let base: string;
let keysPath: string;
let keysDir: string;

beforeAll(async () => {
  const { root } = makeSandbox();
  keysDir = mkdtempSync(join(tmpdir(), 'maude-figma-routes-keys-'));
  keysPath = join(keysDir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({ keys: {} }), { mode: 0o600 });
  port = nextPort();
  base = `http://localhost:${port}`;
  proc = await bootServer(root, port, { MAUDE_GEN_KEYS_PATH: keysPath });
});

afterAll(async () => {
  await killProc(proc);
  rmSync(keysDir, { recursive: true, force: true });
});

function storedToken(): string | undefined {
  try {
    return JSON.parse(readFileSync(keysPath, 'utf8')).keys?.figma;
  } catch {
    return undefined;
  }
}

// The WRITE guard in this codebase is `sameOriginWrite`, which keys on `Origin`
// — the header a browser stamps unspoofably on every cross-origin POST/DELETE.
// (`Sec-Fetch-Site` is what `sameOriginRead` uses, for the GET case below where
// browsers do NOT reliably send Origin.) These tests therefore send a real
// cross-origin `Origin`, which is what an attacker page actually produces.
describe('cross-origin writes are refused (the CSRF guard)', () => {
  const EVIL = 'https://evil.example';
  const PLANTED = 'figd_ATTACKER_PLANTED_0123456789';

  test('POST /_api/figma/connect cross-origin is 403 and stores nothing', async () => {
    const res = await fetch(`${base}/_api/figma/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: EVIL },
      body: JSON.stringify({ token: PLANTED }),
    });
    expect(res.status).toBe(403);
    expect(storedToken()).toBeUndefined();
  });

  test('POST /_api/figma/probe cross-origin is 403 — probe spends the credential', async () => {
    const res = await fetch(`${base}/_api/figma/probe`, {
      method: 'POST',
      headers: { Origin: EVIL },
    });
    expect(res.status).toBe(403);
  });

  test('DELETE /_api/figma/connect cross-origin is 403', async () => {
    const res = await fetch(`${base}/_api/figma/connect`, {
      method: 'DELETE',
      headers: { Origin: EVIL },
    });
    expect(res.status).toBe(403);
  });

  test('a CORS-simple POST (no preflight, text/plain) is still refused', async () => {
    // The PoC shape from the DDR-216 review: a simple content type means no
    // preflight and the page cannot read the response — but the side effect
    // would land if the server allowed it. Origin is still stamped.
    const res = await fetch(`${base}/_api/figma/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: EVIL },
      body: JSON.stringify({ token: PLANTED }),
    });
    expect(res.status).toBe(403);
    expect(storedToken()).toBeUndefined();
  });
});

describe('cross-site reads are refused (Sec-Fetch-Site, the GET case)', () => {
  test('GET /_api/figma/status with Sec-Fetch-Site: cross-site is 403', async () => {
    // A no-cors GET from an attacker page passes the loopback guard and may omit
    // Origin entirely, so `sameOriginWrite` cannot see it. Without the read
    // guard this leaks whether the user has Figma connected.
    const res = await fetch(`${base}/_api/figma/status`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(403);
  });
});

describe('a foreign Host header is refused (the DNS-rebinding guard)', () => {
  for (const [label, host] of [
    ['an attacker-controlled name', 'evil.example'],
    ['a rebinding service name', 'figma.127.0.0.1.nip.io'],
  ]) {
    test(`GET /_api/figma/status with Host: ${label} is 403`, async () => {
      const res = await fetch(`${base}/_api/figma/status`, { headers: { Host: host } });
      expect(res.status).toBe(403);
    });
  }
});

describe('method gating', () => {
  test('GET /_api/figma/connect is 405', async () => {
    expect((await fetch(`${base}/_api/figma/connect`)).status).toBe(405);
  });

  test('GET /_api/figma/probe is 405 — probe is a write', async () => {
    expect((await fetch(`${base}/_api/figma/probe`)).status).toBe(405);
  });

  test('POST /_api/figma/status is 405', async () => {
    expect((await fetch(`${base}/_api/figma/status`, { method: 'POST' })).status).toBe(405);
  });
});

describe('same-origin happy path — and the key never comes back out', () => {
  test('status reports presence only, plus the granular scope to ask for', async () => {
    const res = await fetch(`${base}/_api/figma/status`, {
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.configured).toBe(false);
    // The blanket `files:read` scope is deprecated — the UI must never name it.
    expect(body.requiredScope).toBe('file_content:read');
    expect(JSON.stringify(body)).not.toContain('figd_');
  });

  test('connect stores the key and returns presence only — never the value', async () => {
    const res = await fetch(`${base}/_api/figma/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ configured: true });
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain('ROUTECANARY');
    // It really did store it — the assertion above is about the RESPONSE, not
    // about the write silently failing.
    expect(storedToken()).toBe(TOKEN);
  });

  test('status still never echoes the value once one is configured', async () => {
    const res = await fetch(`${base}/_api/figma/status`, {
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    const raw = await res.text();
    expect(JSON.parse(raw).configured).toBe(true);
    expect(raw).not.toContain('ROUTECANARY');
  });

  test('a malformed token is refused with a message that does not echo it', async () => {
    const junk = 'not a token REFLECTION_CANARY';
    const res = await fetch(`${base}/_api/figma/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ token: junk }),
    });
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain('REFLECTION_CANARY');
    // The previously-stored good token is untouched by a failed write.
    expect(storedToken()).toBe(TOKEN);
  });

  test('probe surfaces a typed failure without leaking the token', async () => {
    // No network stub here — the real api.figma.com will reject this canary
    // token (or the call fails to connect in CI). Either way the response must
    // be a typed reason with a code-owned message and no credential in it.
    const res = await fetch(`${base}/_api/figma/probe`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    const raw = await res.text();
    expect(raw).not.toContain('ROUTECANARY');
    expect(raw).not.toContain('figd_');
    const body = JSON.parse(raw) as { ok: boolean; reason?: string };
    if (!body.ok) {
      expect(['unauthorized', 'forbidden', 'network', 'bad_response', 'rate_limited']).toContain(
        body.reason
      );
    }
  });

  test('disconnect clears the key', async () => {
    const res = await fetch(`${base}/_api/figma/connect`, {
      method: 'DELETE',
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
    expect(storedToken()).toBeUndefined();
  });
});

describe('/_api/figma/import — same gate, and a validated body', () => {
  test('cross-origin is 403 — it spends the PAT and writes to disk', async () => {
    const res = await fetch(`${base}/_api/figma/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ mode: 'board', url: 'https://www.figma.com/board/AAAAAAAAAA/x' }),
    });
    expect(res.status).toBe(403);
  });

  test('a foreign Host is 403', async () => {
    const res = await fetch(`${base}/_api/figma/import`, {
      method: 'POST',
      headers: { Host: 'evil.example' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  test('GET is 405', async () => {
    expect((await fetch(`${base}/_api/figma/import`)).status).toBe(405);
  });

  test.each([
    ['no body', {}],
    ['unknown mode', { mode: 'everything', url: 'https://www.figma.com/board/AAAAAAAAAA/x' }],
    ['missing url', { mode: 'board' }],
    ['empty url', { mode: 'board', url: '' }],
  ])('a malformed request is 400 (%s)', async (_label, body) => {
    const res = await fetch(`${base}/_api/figma/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  test('a caller cannot choose an output path', async () => {
    // The body shape is fixed: {mode, url, dryRun}. A slug/path/into field is
    // simply not read — the same "the producer never picks its own target"
    // discipline DDR-174 applies to its authoring agent.
    const res = await fetch(`${base}/_api/figma/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({
        mode: 'board',
        url: 'https://www.figma.com/board/AAAAAAAAAA/x',
        slug: '../../etc/passwd',
        into: '/etc/passwd',
      }),
    });
    // It gets past validation (the url is well-formed) and fails on the
    // credential instead — the point is that the path fields were ignored.
    const raw = await res.text();
    expect(raw).not.toContain('etc/passwd');
    expect([400, 502]).toContain(res.status);
  });

  test('a failure never echoes an upstream string', async () => {
    const res = await fetch(`${base}/_api/figma/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ mode: 'board', url: 'https://www.figma.com/board/AAAAAAAAAA/x' }),
    });
    const raw = await res.text();
    expect(raw).not.toContain('figd_');
    expect(raw).not.toContain('ROUTECANARY');
  });
});

// S8.17 — the Import from Figma sheet's two routes ride the route table, so `guardTableRoute` gives them
// the same two gates the hand-gated routes above carry: both spend the PAT and reach the network, and
// import-frames writes a canvas. (No case here reaches the verb: a token may be stored by now, and the
// real Figma API is never called from a test.)
describe('/_api/figma/frames + /_api/figma/import-frames — the table gates (S8.17)', () => {
  const BODY = { url: 'https://www.figma.com/design/k8Fq2abcdEFGH12345678/x', frames: ['1:2'] };
  for (const path of ['/_api/figma/frames', '/_api/figma/import-frames']) {
    test(`${path}: cross-origin is 403`, async () => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify(BODY),
      });
      expect(res.status).toBe(403);
    });
    test(`${path}: a foreign Host is 403`, async () => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: 'figma.127.0.0.1.nip.io' },
        body: JSON.stringify(BODY),
      });
      expect(res.status).toBe(403);
    });
    test(`${path}: GET is not a route`, async () => {
      expect([404, 405]).toContain((await fetch(`${base}${path}`)).status);
    });
    test(`${path}: a malformed body is a fixed 400, never the key`, async () => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ url: '', frames: ['../../etc/passwd'] }),
      });
      const raw = await res.text();
      expect(res.status).toBe(400);
      expect(JSON.parse(raw)).toEqual({ ok: false, reason: 'bad-request' });
      expect(raw).not.toContain('figd_');
    });
  }
});
