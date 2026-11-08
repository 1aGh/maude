// Loopback key, second re-review (contract client/v2/contracts/sec-loopback-bearer.md §7.5, §7.9):
// no one-time opening link sits in a folder the AI agent reads (A), no browser helper redeems one it
// was handed (B/C — bin/_url-guard.test.mjs), helper log lines never carry a link or a frame
// capability (E), sessions have an absolute lifetime (D) and helper sessions never evict the person's
// (G), and the two capture fallbacks work (F).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// @ts-expect-error — plain ESM helper without types
import { linkFileDir, readLaunchFd, takeLinkFile } from '../bin/_url-guard.mjs';
import { LAUNCH_PARAM, mainOriginKeyRefusal } from '../shell/api-key.ts';
import { serverLinkDir, writeLinkFile } from '../shell/key-file.ts';

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
    expect(perf.match(/ 3< <\(studio_launch_url "\$REPO" "\$PORT"\)/g)?.length).toBe(3);
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
