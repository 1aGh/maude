import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { readServerInfo, waitForSidecar } from '../helpers/sidecar';
import {
  closeTab,
  focusTab,
  HOME,
  labels,
  openTab,
  pinCurrentWindow,
  STRIP,
} from '../helpers/windows';

/**
 * #206 T6.4 — a terminal design run reuses the desktop app (contract `206-cli-reuses-desktop.md` §9, DDR-250).
 * wdio.cli-reuse.conf.ts starts the debug app with MAUDE_E2E_CLI_CONSENT=1 and names the e2e registry
 * (MAUDE_E2E_APP_REGISTRY); every CLI call below gets it as MAUDE_APP_REGISTRY_FILE.
 *
 *  1. same root: the CLI gets the app's attested port, server-up starts nothing and opens no browser;
 *  2. a git worktree of a project the app knows: a new tab "<main> · <branch>", kind worktree in the registry,
 *     never in Home's projects/Recent, and its server reaped after the tab closes;
 *  3. no app: the CLI keeps today's path (exit 10 — its own headless server);
 *  4. a folder the app never opened: one consent sheet — Open opens it and the CLI gets its port; Not now
 *     answers denied and is kept for the run (no second sheet);
 *  5. (T6.3g) the desktop opens a folder a terminal server holds: that server steps down, and the tab can undo
 *     within 10 s (no `store-locked`).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const LOCATE = join(REPO, 'cli', 'lib', 'desktop-locate.mjs');
const SERVER_UP = join(REPO, 'apps', 'studio', 'bin', 'server-up.sh');
const SERVER_TS = join(REPO, 'apps', 'studio', 'server.ts');
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const REG = process.env.MAUDE_E2E_APP_REGISTRY as string;

type Run = { code: number | null; out: string; err: string };

function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MAUDE_APP_REGISTRY_FILE: REG,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    ...extra,
  };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** The CLI mode the bash helpers call, run to its end (async: a consent wait must not block the session). */
function locate(args: string[], extra: Record<string, string> = {}): Promise<Run> {
  return new Promise((res) => {
    const c = spawn(process.execPath, [LOCATE, ...args], { env: cliEnv(extra) });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    const kill = setTimeout(() => c.kill('SIGTERM'), 120_000);
    c.on('exit', (code) => {
      clearTimeout(kill);
      res({ code, out, err });
    });
  });
}

/** PATH with node and the system tools only — no bun, so a fall-through to "start a server" fails at once. */
function noBunPath(): string {
  const bin = join(mkdtempSync(join(tmpdir(), 'maude-e2e-cli-bin-')), 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  return `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`;
}

type Entry = {
  root: string;
  label: string;
  state: string;
  port?: number;
  pid?: number;
  kind: string;
  mainRoot?: string;
  branch: string | null;
  busy: boolean;
};

function registry(): Entry[] {
  try {
    return (JSON.parse(readFileSync(REG, 'utf8')).servers ?? []) as Entry[];
  } catch {
    return [];
  }
}
const entryOf = (root: string) => registry().find((e) => e.root === realpathSync(root));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeProject(name: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `maude-e2e-cli-${name}-`)));
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  mkdirSync(join(dir, '.design', 'system'), { recursive: true });
  writeFileSync(
    join(dir, '.design', 'config.json'),
    JSON.stringify({ name, designRoot: '.design', formatVersion: 2, designSystems: [] }, null, 2)
  );
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync(
    'git',
    [
      '-c',
      'user.email=e2e@maude.invalid',
      '-c',
      'user.name=e2e',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** The strip's accessible text for one tab (its name), read without focusing it. */
async function stripName(label: string): Promise<string> {
  const back = await browser.getWindowHandle().catch(() => null);
  await browser.switchToWindow(STRIP);
  const name = await browser.execute((l: string) => {
    const el = document.querySelector(`#tabs [role="tab"][data-label="${l}"]`);
    return (el?.getAttribute('aria-label') || el?.textContent || '').trim();
  }, label);
  if (back && back !== STRIP) await browser.switchToWindow(back).catch(() => {});
  return name;
}

/** Answer the parked consent ticket once one waits; the folder it was for. */
async function answerConsent(open: boolean): Promise<string> {
  let root: string | null = null;
  await browser.waitUntil(
    async () => {
      root = await invokeTauri<string | null>('e2e_cli_consent', { open }).catch(() => null);
      return !!root;
    },
    { timeout: 30_000, interval: 250, timeoutMsg: 'no consent ticket was parked' }
  );
  return root as unknown as string;
}

describe('cli-reuse (native-desktop)', () => {
  let primaryLabel = '';
  let port = 0;

  before(async () => {
    startReport('cli-reuse (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    primaryLabel = await pinCurrentWindow();
    port = readServerInfo(PRIMARY).port;
    await browser.waitUntil(() => entryOf(PRIMARY)?.port === port, {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: 'the app never listed its own server in servers.json',
    });
  });

  it('same root: the CLI gets the app’s attested port, starts no server and opens no browser', async () => {
    const pid = readServerInfo(PRIMARY).pid;
    const r = await locate(['port', '--root', PRIMARY, '--ensure', 'capture', '--lease']);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(String(port));

    const up = spawnSync('bash', [SERVER_UP, '--root', PRIMARY], {
      env: cliEnv({ PATH: noBunPath(), MAUDE_FORCE_SOURCE: '1', MAUDE_DEV_SERVER_BIN: '' }),
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(up.status).toBe(0);
    expect(up.stdout.trim()).toBe(String(port));
    expect(readServerInfo(PRIMARY).pid).toBe(pid);
    expect(alive(pid)).toBe(true);
    // the lease is live: the registry says busy
    await browser.waitUntil(() => entryOf(PRIMARY)?.busy === true, {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: 'a live lease did not mark the entry busy',
    });
    await capture('same root — one server');
  });

  it('a worktree of a known project: a labelled tab, never in Recent, reaped on close', async () => {
    const main = makeProject('cli-main');
    git(main, 'init', '-q', '-b', 'main');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'init');
    // The person opened the main project once: it is known.
    await focusTab(primaryLabel);
    const opened = await openTab(main);
    const wt = join(dirname(main), `${main.split('/').pop()}-wt`);
    git(main, 'worktree', 'add', '-q', '-b', 'feat-x', wt);
    await focusTab(primaryLabel);

    const before = await labels();
    const r = await locate(['port', '--root', wt, '--ensure', 'capture']);
    expect(r.code).toBe(0);
    const wtPort = Number(r.out.trim());
    expect(wtPort).toBeGreaterThan(0);
    const after = await labels();
    const added = after.filter((l) => !before.includes(l));
    expect(added.length).toBe(1);
    const wtLabel = added[0];

    await browser.waitUntil(async () => (await stripName(wtLabel)).includes('cli-main · feat-x'), {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: `the worktree tab is not named "cli-main · feat-x" (${await stripName(wtLabel)})`,
    });
    const e = entryOf(wt);
    expect(e?.kind).toBe('worktree');
    expect(e?.mainRoot).toBe(realpathSync(main));
    expect(e?.branch).toBe('feat-x');
    const wtPid = e?.pid ?? 0;
    expect(wtPid).toBeGreaterThan(0);

    await focusTab(HOME);
    const shell = await invokeTauri<{
      projects: { pid: string; root: string }[];
      recent: string[];
      worktrees: { pid: string; root: string; mainPid: string; branch: string }[];
    }>('shell_state');
    const roots = shell.projects.map((p) => realpathSync(p.root));
    expect(roots).toContain(realpathSync(main));
    expect(roots).not.toContain(realpathSync(wt));
    // T6.3g: Home lists it under its main project as a Worktrees row instead.
    const mainPid = shell.projects.find((p) => realpathSync(p.root) === realpathSync(main))?.pid;
    const row = shell.worktrees.find((w) => realpathSync(w.root) === realpathSync(wt));
    expect(row?.mainPid).toBe(mainPid);
    expect(row?.branch).toBe('feat-x');
    await capture('worktree tab');

    await closeTab(wtLabel, primaryLabel);
    await browser.waitUntil(() => !alive(wtPid), {
      timeout: 60_000,
      interval: 500,
      timeoutMsg: 'the worktree tab’s server outlived its tab past the close grace',
    });
    expect(entryOf(wt)).toBeUndefined();
    await closeTab(opened.label, primaryLabel);
  });

  it('no app: the CLI keeps today’s path (its own headless server)', async () => {
    const none = join(mkdtempSync(join(tmpdir(), 'maude-e2e-cli-noapp-')), 'servers.json');
    const r = await locate(['port', '--root', PRIMARY, '--ensure', 'capture'], {
      MAUDE_APP_REGISTRY_FILE: none,
    });
    expect(r.code).toBe(10);
    expect(r.out).toBe('');
  });

  // #206 T6.3g (contract §6 "Handover", §9) — the desktop opens a root a terminal server already holds: the
  // terminal server (role `cli`) sees the app's attested sidecar in servers.json and steps down; the tab's own
  // server takes the store lock, and within 10 s of that exit the tab can undo (no `store-locked`).
  it('the desktop takes over a folder a CLI server holds; the tab can undo within 10 s', async () => {
    await focusTab(primaryLabel);
    const held = makeProject('cli-held');
    const cli = spawn('bun', [SERVER_TS, '--root', held], {
      env: cliEnv({ MAUDE_SERVER_ROLE: 'cli' }),
      stdio: 'ignore',
    });
    let cliExited = 0;
    cli.on('exit', () => {
      cliExited = Date.now();
    });
    try {
      await browser.waitUntil(
        () => {
          try {
            return readServerInfo(held).pid === cli.pid;
          } catch {
            return false;
          }
        },
        {
          timeout: 60_000,
          interval: 250,
          timeoutMsg: 'the terminal server never wrote _server.json',
        }
      );

      const opened = await openTab(held);
      expect(opened.opened).toBe('new');
      await browser.waitUntil(() => cliExited > 0, {
        timeout: 150_000,
        interval: 250,
        timeoutMsg: 'the terminal server did not step down for the app’s tab',
      });
      // Its yield never deletes the app's _server.json (compare-and-delete): the file names the app's server.
      await browser.waitUntil(() => entryOf(held)?.port !== undefined, {
        timeout: 30_000,
        interval: 250,
        timeoutMsg: 'the app never listed the tab’s server in servers.json',
      });

      await focusTab(opened.label);
      let code = 'store-locked';
      await browser.waitUntil(
        async () => {
          code = await browser.execute(async () => {
            try {
              const r = await fetch('/_api/project/undo', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ actionId: 'e2e-nothing-to-undo' }),
              });
              const b = (await r.json().catch(() => ({}))) as { code?: string; reason?: string };
              return String(b.code ?? b.reason ?? r.status);
            } catch {
              return 'store-locked'; // the page is still between documents
            }
          });
          return code !== 'store-locked';
        },
        {
          // what is left of the 10 s since the terminal server exited
          timeout: Math.max(250, 10_000 - (Date.now() - cliExited)),
          interval: 250,
          timeoutMsg: 'the tab still answers store-locked 10 s after the terminal server exited',
        }
      );
      expect(Date.now() - cliExited).toBeLessThanOrEqual(10_500);
      expect(code).not.toBe('store-locked');
      expect(readServerInfo(held).pid).not.toBe(cli.pid);
      await capture('handover — the tab took the folder');
      await closeTab(opened.label, primaryLabel);
    } finally {
      if (!cliExited) cli.kill('SIGTERM');
    }
  });

  it('a new folder asks once: Open opens it; Not now is denied and kept for the run', async () => {
    await focusTab(primaryLabel);
    const fresh = makeProject('cli-fresh');
    const before = await labels();
    const pending = locate(['port', '--root', fresh, '--ensure', 'capture']);
    expect(await answerConsent(true)).toBe(fresh);
    const r = await pending;
    expect(r.code).toBe(0);
    expect(Number(r.out.trim())).toBeGreaterThan(0);
    const added = (await labels()).filter((l) => !before.includes(l));
    expect(added.length).toBe(1);
    await capture('consent — Open');

    await focusTab(primaryLabel);
    const other = makeProject('cli-declined');
    const asked = locate(['port', '--root', other, '--ensure', 'capture']);
    expect(await answerConsent(false)).toBe(other);
    const d = await asked;
    expect(d.code).toBe(10);
    // Not now is kept for this app run: the next request is denied at once, with no new sheet.
    const again = await locate(['port', '--root', other, '--ensure', 'capture']);
    expect(again.code).toBe(10);
    expect(await invokeTauri<string | null>('e2e_cli_consent', { open: true })).toBeNull();
    expect(existsSync(join(other, '.design', '_server.json'))).toBe(false);

    await closeTab(added[0], primaryLabel);
  });
});
