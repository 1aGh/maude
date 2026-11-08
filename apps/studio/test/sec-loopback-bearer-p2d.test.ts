// Loopback key, second re-review (contract client/v2/contracts/sec-loopback-bearer.md §7.5, §7.9):
// no one-time opening link sits in a folder the AI agent reads (A), no browser helper redeems one it
// was handed (B/C — bin/_url-guard.test.mjs), helper log lines never carry a link or a frame
// capability (E), sessions have an absolute lifetime (D) and helper sessions never evict the person's
// (G), and the two capture fallbacks work (F).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Subprocess } from 'bun';
// @ts-expect-error — plain ESM CLI module without types
import { mintLaunchToken as cliMint } from '../../../cli/lib/desktop-locate.mjs';
// @ts-expect-error — plain ESM helper without types
import { linkFileDir, readLaunchFd, takeLinkFile } from '../bin/_url-guard.mjs';
import {
  API_KEY_HEADER,
  LAUNCH_PARAM,
  mainOriginKeyRefusal,
  mintLaunchToken,
  SESSION_MAX_AGE_MS,
  SESSION_PATH,
  type SessionStore,
} from '../shell/api-key.ts';
import { serverLinkDir, writeLinkFile } from '../shell/key-file.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const KEY = 'a7'.repeat(32);
const NOW = 1_800_000_000;
const BASE = 'http://127.0.0.1:4400';
const gate = (
  path: string,
  headers: Record<string, string>,
  s: SessionStore,
  now: number,
  method = 'GET'
) =>
  mainOriginKeyRefusal(
    new Request(`${BASE}${path}`, { method, headers: { host: '127.0.0.1:4400', ...headers } }),
    { key: KEY, required: true, workspace: false, usedNonces: new Map(), sessions: s, now }
  );
const keySession = (s: SessionStore, now: number) => {
  const r = gate(SESSION_PATH, { [API_KEY_HEADER]: KEY }, s, now, 'POST');
  expect(r?.status).toBe(204);
  return (r?.headers.get('set-cookie') ?? '').split(';')[0];
};
const launchSession = (s: SessionStore, now: number, token: string) => {
  const r = gate(`/?${LAUNCH_PARAM}=${token}`, {}, s, now);
  expect(r?.status).toBe(303);
  return (r?.headers.get('set-cookie') ?? '').split(';')[0];
};

describe('D — a session has an absolute lifetime of 24 h on top of its idle expiry', () => {
  test('used every hour, it still ends 24 h after it was opened', () => {
    const s: SessionStore = new Map();
    const c = keySession(s, NOW);
    expect(SESSION_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    let t = NOW;
    for (; t < NOW + 24 * 3600 - 3600; t += 3600)
      expect(gate('/_config', { cookie: c }, s, t)).toBeNull();
    expect(gate('/_config', { cookie: c }, s, NOW + 24 * 3600 - 1)).toBeNull();
    expect(gate('/_config', { cookie: c }, s, NOW + 24 * 3600 + 1)?.status).toBe(401);
    // a fresh trade opens a new one
    const d = keySession(s, NOW + 24 * 3600 + 2);
    expect(gate('/_config', { cookie: d }, s, NOW + 24 * 3600 + 3)).toBeNull();
  });
});

describe('G — helper sessions never evict the person', () => {
  test('300 helper captures later, the idle person session is still there', () => {
    const s: SessionStore = new Map();
    const person = keySession(s, NOW);
    for (let i = 0; i < 300; i++)
      launchSession(s, NOW + 60 + i, mintLaunchToken(KEY, NOW + 60 + i, 'helper'));
    expect(s.size).toBeLessThanOrEqual(1 + 32);
    expect(gate('/_config', { cookie: person }, s, NOW + 400)).toBeNull();
  });
  test('a helper session ends after 30 min unused; the person keeps 12 h', () => {
    const s: SessionStore = new Map();
    const person = keySession(s, NOW);
    const helper = launchSession(s, NOW, mintLaunchToken(KEY, NOW, 'helper'));
    expect(gate('/_config', { cookie: helper }, s, NOW + 29 * 60)).toBeNull();
    expect(gate('/_config', { cookie: helper }, s, NOW + 60 * 60)?.status).toBe(401);
    expect(gate('/_config', { cookie: person }, s, NOW + 60 * 60)).toBeNull();
  });
  test('the CLI mints the same helper tokens the server reads; a person token is not a helper one', () => {
    const s: SessionStore = new Map();
    const t = cliMint(KEY, NOW, 'helper');
    expect(t.startsWith('h')).toBe(true);
    launchSession(s, NOW, t);
    expect([...s.values()].map((r) => r.helper)).toEqual([true]);
    // the "h" mark cannot be added to a person token (its MAC covers the domain)
    const forged = `h${mintLaunchToken(KEY, NOW)}`;
    expect(gate(`/?${LAUNCH_PARAM}=${forged}`, {}, s, NOW)?.status).toBe(401);
    launchSession(s, NOW, cliMint(KEY, NOW));
    expect([...s.values()].map((r) => r.helper).sort()).toEqual([false, true]);
  });
  test('every helper mints a helper link; server-up --open keeps the person one', () => {
    expect(read('bin/perf.sh').match(/studio_launch_url "\$REPO" "\$PORT" --helper/g)?.length).toBe(
      3
    );
    const shot = read('bin/screenshot.sh');
    expect(shot).not.toMatch(/studio_launch_url "[^"]+" "[^"]+"\)/);
    expect(read('http.ts')).toContain("mintLaunchToken(bootApiKey(), undefined, 'helper')");
    expect(read('bin/server-up.sh')).toContain('link="$(studio_launch_url "$REPO" "$1")"');
  });
});

const STUDIO = join(import.meta.dir, '..');
const BIN = join(STUDIO, 'bin');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

describe('A — the perf probes get their opening link on a pipe, never a file', () => {
  test('perf.sh writes no link file and hands every studio probe fd 3', () => {
    const perf = read('bin/perf.sh');
    expect(perf).not.toContain('mktemp');
    expect(perf).not.toContain('--launch-file');
    expect(perf).not.toMatch(/maude-launch\.X/);
    expect(perf.match(/ARGS.*--launch-fd 3/g)?.length).toBe(3);
    expect(perf.match(/ 3< <\(studio_launch_url "\$REPO" "\$PORT" --helper\)/g)?.length).toBe(3);
  });
  test.each([
    '_perf-probe-open.mjs',
    '_perf-probe-studio.mjs',
    '_perf-probe-safari.mjs',
  ])('%s reads no link file and removes none', (probe) => {
    const src = read(`bin/${probe}`);
    expect(src).not.toContain('--launch-file');
    expect(src).not.toContain('unlinkSync');
    expect(src).toContain("'--launch-fd'");
  });
  test('readLaunchFd reads the inherited pipe; anything but fd 3–9 reads nothing', () => {
    const guard = join(BIN, '_url-guard.mjs');
    const r = spawnSync(
      'bash',
      [
        '-c',
        `node --input-type=module -e "import { readLaunchFd } from '${guard}'; console.log(readLaunchFd('3') + '|' + readLaunchFd('0'))" 3< <(printf 'http://localhost:1/?maude-launch=t\\n')`,
      ],
      { encoding: 'utf8' }
    );
    expect(r.stdout.trim()).toBe('http://localhost:1/?maude-launch=t|');
    expect(readLaunchFd('/etc/passwd')).toBe('');
  });
});

describe('A — the bug-report link sits in the server private folder', () => {
  test('writeLinkFile → takeLinkFile: the TS and helper folders agree; 0600 in 0700; taken once', () => {
    const state = mkdtempSync(join(tmpdir(), 'p2d-state-'));
    const env = { XDG_STATE_HOME: state, HOME: state };
    try {
      expect(serverLinkDir(env)).toBe(linkFileDir(env));
      const f = writeLinkFile('http://localhost:4399/?maude-launch=t', env);
      expect(f).not.toBeNull();
      expect(dirname(f as string)).toBe(serverLinkDir(env));
      expect(lstatSync(f as string).mode & 0o777).toBe(0o600);
      expect(lstatSync(serverLinkDir(env)).mode & 0o777).toBe(0o700);
      expect(takeLinkFile(f, env)).toEqual({ url: 'http://localhost:4399/?maude-launch=t' });
      expect(existsSync(f as string)).toBe(false);
      expect(takeLinkFile(f, env).error).toBeTruthy();
      expect(readdirSync(serverLinkDir(env))).toEqual([]);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
  test('the link folder is inside the folder the AI chat Read is denied', () => {
    const env = { XDG_STATE_HOME: '/s', HOME: '/h' };
    expect(serverLinkDir(env).startsWith('/s/maude/servers/')).toBe(true);
  });
});

describe('H — the way back names a verb that exists', () => {
  test('the 401 page, the boot line and server-up point at `maude design server-up --open`', async () => {
    for (const f of ['shell/api-key.ts', 'server.ts', 'bin/server-up.sh'])
      expect(read(f)).not.toContain('maude design browse');
    const r = mainOriginKeyRefusal(
      new Request(`http://127.0.0.1:4400/?${LAUNCH_PARAM}=1.${'a'.repeat(32)}.${'b'.repeat(64)}`, {
        headers: { host: '127.0.0.1:4400' },
      }),
      { key: 'a7'.repeat(32), required: true, workspace: false, sessions: new Map() }
    );
    expect(r?.status).toBe(401);
    expect(await r?.text()).toContain('maude design server-up --open');
    expect(read('server.ts')).toContain('`maude design server-up --open` opens the studio again');
  });
});

describe('E — helper log lines never carry an opening link or a frame capability', () => {
  const helpers = readdirSync(BIN).filter((f) => f.endsWith('.sh'));
  test('every stderr line that names a URL goes through maude_redact (static)', () => {
    const bad: string[] = [];
    for (const f of helpers) {
      read(`bin/${f}`)
        .split('\n')
        .forEach((line, i) => {
          if (!/^\s*(echo|printf)\b/.test(line) || !line.includes('>&2')) return;
          if (!/\$\{?(URL|url|LINK|link|[A-Z_]*_URL)\b/.test(line)) return;
          if (!/maude_redact|shown_url/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
  test("agent-browser's own `open` output never reaches stderr (static)", () => {
    const bad: string[] = [];
    for (const f of helpers) {
      read(`bin/${f}`)
        .split('\n')
        .forEach((line, i) => {
          if (
            /"\$AB"( --session "[^"]*")? open "\$URL"/.test(line) &&
            !/>\/dev\/null 2>&1/.test(line)
          )
            bad.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
    expect(read('bin/screenshot.sh')).toContain('shown_url() { maude_redact "$1"; }');
    expect(read('bin/_perf-probe.mjs')).toContain("ab(['open', opts.url], true)");
  });
  test('maude_redact hides both values and keeps the rest', () => {
    const r = spawnSync(
      'bash',
      [
        '-c',
        `. '${join(BIN, '_url-guard.sh')}'; maude_redact 'http://localhost:1/_canvas-shell.html?canvas=a.tsx&fc=abc.def&x=1 and /?maude-launch=1.2.3'`,
      ],
      { encoding: 'utf8' }
    );
    expect(r.stdout).toBe(
      'http://localhost:1/_canvas-shell.html?canvas=a.tsx&fc=…&x=1 and /?maude-launch=…'
    );
  });
});

// re-check F — with the canvas-origin split off there is no capture origin to mint a frame capability
// for, and canvas code runs on the main origin with the page's own session anyway. A terminal server
// started that way therefore stays key-less (phase 1), says so at boot, and its captures render.
describe('F — a terminal server with the origin split off is key-less', () => {
  let proc: Subprocess;
  let base: string;
  let state: string;
  let out = '';
  beforeAll(async () => {
    const { root, designRoot } = makeSandbox();
    Bun.write(
      join(designRoot, 'ui', 'Probe.tsx'),
      'import { DesignCanvas } from "@maude/canvas-lib";\nexport default function P() { return <DesignCanvas />; }\n'
    );
    state = mkdtempSync(join(tmpdir(), 'p2d-f-state-'));
    const port = nextPort();
    base = `http://127.0.0.1:${port}`;
    proc = await bootServer(root, port, {
      MAUDE_SERVER_ROLE: 'cli',
      MAUDE_CANVAS_ORIGIN_SPLIT: '0',
      XDG_STATE_HOME: state,
      MAUDE_APP_REGISTRY_FILE: join(state, 'no-app', 'servers.json'),
    });
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
    out = '';
    rmSync(state, { recursive: true, force: true });
  });

  test('no key file, the canvas module answers a key-less capture, and the boot line says why', async () => {
    expect((await fetch(`${base}/_config`)).status).toBe(200);
    expect((await fetch(`${base}/_canvas-shell.html?canvas=ui/Probe.tsx`)).status).toBe(200);
    expect(existsSync(join(state, 'maude', 'servers'))).toBe(false);
    if (proc.stdout && typeof proc.stdout !== 'number') {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      const t = setTimeout(() => reader.cancel(), 1500);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
        if (out.includes('MAUDE_CANVAS_ORIGIN_SPLIT')) break;
      }
      clearTimeout(t);
    }
    expect(out).toContain('MAUDE_CANVAS_ORIGIN_SPLIT=0');
  });
});

describe('F — after a port bounce a canvas capture asks the new server again', () => {
  test('relive_url re-runs studio_capture_url instead of rewriting the port', () => {
    const shot = read('bin/screenshot.sh');
    const relive = shot.slice(
      shot.indexOf('relive_url() {'),
      shot.indexOf('capture_resilient() {')
    );
    expect(relive).toContain('URL="$(studio_capture_url "$RELIVE_REPO" "$new" "$CAPTURE_REL")"');
    expect(shot).toContain('URL="$(studio_capture_url "$REPO" "$PORT" "$CAPTURE_REL")"');
  });
});
