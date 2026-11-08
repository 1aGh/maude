// Phase 2c of the loopback API key (contract client/v2/contracts/sec-loopback-bearer.md §7.2, §7.3,
// §7.8): the review fixes. A caller with no key gets no canvas capability from the exempt shell
// redirect; the header key every helper and verb sends is not "the person" (spend approval, spend
// limits, publishing, invitations, cloud); the session cookie is a random server-held value that
// rotates and expires; the launch-nonce store forgets only expired tokens.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Subprocess } from 'bun';

import {
  API_KEY_ENV,
  API_KEY_HEADER,
  LAUNCH_PARAM,
  mainOriginKeyRefusal,
  mintLaunchToken,
  SESSION_IDLE_MS,
  SESSION_PATH,
  sessionCookieName,
} from '../shell/api-key.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const KEY = 'a7'.repeat(32);
const BASE = 'http://127.0.0.1:4400';
const PROBE_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function Probe() {
  return (<DesignCanvas><DCSection id="s" title="S"><DCArtboard id="a" label="A" width={100} height={100}><div>probe</div></DCArtboard></DCSection></DesignCanvas>);
}
`;

function req(path: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`${BASE}${path}`, { method, headers: { host: '127.0.0.1:4400', ...headers } });
}

/** A throwaway HOME + XDG config so a booted server never touches this Mac's prefs or keys. */
function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'p2c-home-'));
  return {
    [API_KEY_ENV]: KEY,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    MAUDE_CLOUD_CONFIG: join(home, 'cloud.json'),
    HUBS_CONFIG_PATH: join(home, 'hubs.json'),
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
  };
}

describe('the session cookie (pure)', () => {
  const opts = (sessions: Map<string, number>, now: number) => ({
    key: KEY,
    required: true,
    workspace: false,
    usedNonces: new Map<string, number>(),
    sessions,
    now,
  });
  const NOW = 1_800_000_000;
  const name = sessionCookieName(KEY);
  const mint = (sessions: Map<string, number>, now: number, cookie?: string) => {
    const r = mainOriginKeyRefusal(
      req(SESSION_PATH, { [API_KEY_HEADER]: KEY, ...(cookie ? { cookie } : {}) }, 'POST'),
      opts(sessions, now)
    );
    expect(r?.status).toBe(204);
    return (r?.headers.get('set-cookie') ?? '').split(';')[0];
  };

  test('each exchange mints a fresh random value; the one presented is dropped (rotation)', () => {
    const s = new Map<string, number>();
    const a = mint(s, NOW);
    const b = mint(s, NOW);
    expect(a.startsWith(`${name}=`)).toBe(true);
    expect(a).not.toBe(b);
    // both live (two windows of one project); a re-exchange carrying `a` retires it
    expect(mainOriginKeyRefusal(req('/_config', { cookie: a }), opts(s, NOW))).toBeNull();
    const c = mint(s, NOW, a);
    expect(mainOriginKeyRefusal(req('/_config', { cookie: a }), opts(s, NOW))?.status).toBe(401);
    expect(mainOriginKeyRefusal(req('/_config', { cookie: c }), opts(s, NOW))).toBeNull();
    expect(mainOriginKeyRefusal(req('/_config', { cookie: b }), opts(s, NOW))).toBeNull();
  });

  test('a session unused for 12 h is gone; use keeps it alive', () => {
    const s = new Map<string, number>();
    const a = mint(s, NOW);
    const idle = SESSION_IDLE_MS / 1000;
    expect(
      mainOriginKeyRefusal(req('/_config', { cookie: a }), opts(s, NOW + idle - 10))
    ).toBeNull();
    expect(
      mainOriginKeyRefusal(req('/_config', { cookie: a }), opts(s, NOW + 2 * idle - 20))
    ).toBeNull();
    expect(
      mainOriginKeyRefusal(req('/_config', { cookie: a }), opts(s, NOW + 3 * idle))?.status
    ).toBe(401);
  });

  test('a cookie on a request whose Origin is another host never counts', () => {
    const s = new Map<string, number>();
    const a = mint(s, NOW);
    expect(
      mainOriginKeyRefusal(
        req('/_config', { cookie: a, origin: 'http://127.0.0.1:4401' }),
        opts(s, NOW)
      )?.status
    ).toBe(401);
    expect(
      mainOriginKeyRefusal(req('/_config', { cookie: a, origin: BASE }), opts(s, NOW))
    ).toBeNull();
  });

  test('the two exchanges answer a loopback Host only', () => {
    const s = new Map<string, number>();
    const rebound = (path: string, headers: Record<string, string>, method = 'GET') =>
      new Request(`http://rebound.example:4400${path}`, {
        method,
        headers: { host: 'rebound.example:4400', ...headers },
      });
    expect(
      mainOriginKeyRefusal(rebound(SESSION_PATH, { [API_KEY_HEADER]: KEY }, 'POST'), opts(s, NOW))
        ?.status
    ).toBe(403);
    expect(
      mainOriginKeyRefusal(
        rebound(`/?${LAUNCH_PARAM}=${mintLaunchToken(KEY, NOW)}`, {}),
        opts(s, NOW)
      )?.status
    ).toBe(403);
  });
});

describe('the used-nonce store (pure)', () => {
  test('full: it drops only expired tokens, never a live one', () => {
    const NOW = 1_800_000_000;
    const used = new Map<string, number>();
    const opts = {
      key: KEY,
      required: true,
      workspace: false,
      usedNonces: used,
      sessions: new Map<string, number>(),
    };
    const live = mintLaunchToken(KEY, NOW);
    expect(
      mainOriginKeyRefusal(req(`/?${LAUNCH_PARAM}=${live}`), { ...opts, now: NOW })?.status
    ).toBe(303);
    // fill the store with live entries
    for (let i = 0; used.size < 4096; i++) used.set(`f${i}`, NOW);
    const next = mintLaunchToken(KEY, NOW);
    // still full of live tokens: refused, and the spent `live` is NOT forgotten
    expect(
      mainOriginKeyRefusal(req(`/?${LAUNCH_PARAM}=${next}`), { ...opts, now: NOW + 1 })?.status
    ).toBe(429);
    expect(
      mainOriginKeyRefusal(req(`/?${LAUNCH_PARAM}=${live}`), { ...opts, now: NOW + 2 })?.status
    ).toBe(401);
    // once the fillers have expired, they make room
    for (const k of used.keys()) if (k.startsWith('f')) used.set(k, NOW - 400);
    const later = mintLaunchToken(KEY, NOW + 3);
    expect(
      mainOriginKeyRefusal(req(`/?${LAUNCH_PARAM}=${later}`), { ...opts, now: NOW + 3 })?.status
    ).toBe(303);
  });
});

describe('a one-time opening link never rides argv (static)', () => {
  const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
  test('the bug-report shell capture hands screenshot.sh a 0600 file, not --url', () => {
    const http = read('http.ts');
    expect(http).not.toMatch(/'--url',\s*`http:\/\/localhost:\$\{port\}\/\?maude-launch=/);
    expect(http).toContain("target = ['--url-file', linkFile]");
    expect(read('bin/screenshot.sh')).toMatch(
      /--url-file\) URL="\$\(head -n1 "\$2"[^\n]*rm -f "\$2"/
    );
  });
  test('perf.sh hands its probes a file, never --launch <token>', () => {
    const perf = read('bin/perf.sh');
    expect(perf).not.toContain('--launch "$(studio_launch_url');
    expect(perf).toContain('--launch-file "$(launch_file)"');
  });
});

describe('a key-required server (split on)', () => {
  let proc: Subprocess;
  let base: string;
  let cookie: string;
  beforeAll(async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Probe.tsx'), PROBE_TSX);
    const port = nextPort();
    base = `http://127.0.0.1:${port}`;
    proc = await bootServer(root, port, isolatedEnv());
    const s = await fetch(`${base}${SESSION_PATH}`, {
      method: 'POST',
      headers: { [API_KEY_HEADER]: KEY, origin: base, 'sec-fetch-site': 'same-origin' },
    });
    expect(s.status).toBe(204);
    cookie = (s.headers.get('set-cookie') ?? '').split(';')[0];
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  const shell = (headers: Record<string, string>) =>
    fetch(`${base}/_canvas-shell.html?canvas=ui/Probe.tsx&hide-chrome=1`, {
      redirect: 'manual',
      headers,
    });

  test('a caller with no key gets the 307 without a frame capability', async () => {
    const anon = await shell({});
    expect(anon.status).toBe(307);
    expect(new URL(anon.headers.get('location') ?? '').searchParams.has('fc')).toBe(false);
  });

  test('the key, or the session cookie, gets the capability', async () => {
    for (const h of [{ [API_KEY_HEADER]: KEY }, { cookie, 'sec-fetch-site': 'none' }]) {
      const r = await shell(h);
      expect(r.status).toBe(307);
      expect(new URL(r.headers.get('location') ?? '').searchParams.has('fc')).toBe(true);
    }
  });

  const person = () => ({ cookie, origin: base, 'sec-fetch-site': 'same-origin' });
  const keyed = () => ({ [API_KEY_HEADER]: KEY, origin: base, 'sec-fetch-site': 'same-origin' });
  const post = (path: string, headers: Record<string, string>, body: unknown, method = 'POST') =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  test('spend approval: the header key is refused, the page session passes', async () => {
    const byKey = await post('/_api/generate-jobs', keyed(), { approve: 'nope' });
    expect(byKey.status).toBe(403);
    // the page: past the gate (no such approval → 404)
    expect((await post('/_api/generate-jobs', person(), { approve: 'nope' })).status).toBe(404);
  });

  test('spend limits: the header key is refused, the page session passes', async () => {
    const limits = { generateSpend: { perRun: 3 } };
    const byKey = await post('/_api/ui-prefs', keyed(), limits);
    expect(byKey.status).toBe(403);
    expect((await post('/_api/ui-prefs', person(), limits)).status).toBe(200);
  });

  test('publishing, invitations and cloud attach are the page’s, never the header key’s', async () => {
    for (const path of ['/_api/git/push', '/_api/share/invites', '/_api/cloud/attach']) {
      const r = await post(path, keyed(), {});
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: string }).error).toBe('person-only');
      const p = await post(path, person(), {});
      if (p.status === 403) {
        const t = await p.text();
        expect(t).not.toContain('person-only');
      }
    }
  });
});

describe('a key-required server with the origin split off', () => {
  let proc: Subprocess;
  let base: string;
  beforeAll(async () => {
    const { root, designRoot } = makeSandbox();
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(designRoot, rel)), { recursive: true });
      writeFileSync(join(designRoot, rel), text);
    };
    const cfg = JSON.parse(
      (await Bun.file(join(designRoot, 'config.json')).text()) as string
    ) as Record<string, unknown>;
    cfg.designSystems = [{ name: 'beta', path: 'system/beta', rootClass: 'beta' }];
    put('config.json', JSON.stringify(cfg));
    put('system/beta/colors_and_type.css', ':root { --accent: red; --display-3: 40px; }');
    put('ui/Pairs.tsx', PROBE_TSX);
    put(
      'ui/Pairs.meta.json',
      JSON.stringify({ designSystem: 'beta', dsPairing: { '--accent-2': '--accent' } })
    );
    const port = nextPort();
    base = `http://127.0.0.1:${port}`;
    proc = await bootServer(root, port, { ...isolatedEnv(), MAUDE_CANVAS_ORIGIN_SPLIT: '0' });
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  test('a keyless caller gets the bare shell; the key gets the canvas’s aliases', async () => {
    const url = `${base}/_canvas-shell.html?canvas=ui/Pairs.tsx&tokens=${encodeURIComponent('system/beta/colors_and_type.css')}`;
    const keyed = await fetch(url, { headers: { [API_KEY_HEADER]: KEY } });
    expect(keyed.status).toBe(200);
    expect(await keyed.text()).toContain('--accent-2: var(--accent)');
    const anon = await fetch(url);
    expect(anon.status).toBe(200);
    expect(await anon.text()).not.toContain('--accent-2: var(--accent)');
  });
});
