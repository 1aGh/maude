// server-up-smoke.mjs — `maude design server-up` from the packaged app, with no node/bun on PATH and no
// desktop tab open, must boot a studio (T1.10, #206).
//
// It used to run `bun server.ts` against the staged studio source in Contents/Resources/apps/studio,
// which has no node_modules, and stopped with "dev-server runtime deps not installed: yjs y-protocols
// lib0" — so without a desktop tab the CLI had no studio for `sync status`, `history`, `trash` or
// `ds-upgrade --apply`. The compiled studio server sits next to the CLI in Contents/MacOS; the CLI now
// starts that one. This boots it on a throwaway project, asks /_health, and stops it again.
//
// Used by check-bundle-completeness.mjs --smoke; pinned by scripts/test/app-server-up.test.mjs.

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stubClaudeEnv } from '../../../scripts/lib/stub-claude.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ binary: string, strippedPath: string, timeoutS?: number }} o
 *   binary — the app's `maude` CLI (Contents/MacOS/maude)
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function serverUpSmoke({ binary, strippedPath, timeoutS = 30 }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maude-smoke-server-up-')));
  const proj = join(root, 'proj');
  const design = join(proj, '.design');
  mkdirSync(design, { recursive: true });
  writeFileSync(join(design, 'config.json'), '{"name":"smoke-server-up"}');
  const home = join(root, 'home');
  mkdirSync(home);
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(root, 'xdg'),
    MAUDE_INDEX_DIR: join(root, 'idx'), // never the person's ~/.maude/index
    MAUDE_LOG_DIR: join(root, 'logs'),
    MAUDE_UI_PREFS_PATH: join(root, 'xdg', 'maude', 'prefs.json'),
    MAUDE_MACHINE_FILE: join(root, 'xdg', 'maude', 'machine.json'),
    MAUDE_NO_AUTOBUILD: '1',
    // server-up sets it itself (T1.9); set here too so a regression there never pops a window
    NO_OPEN: '1',
    ...stubClaudeEnv(home, strippedPath),
  };
  const run = await new Promise((done) => {
    execFile(
      binary,
      ['design', 'server-up', '--root', proj, '--timeout', String(timeoutS)],
      { env, encoding: 'utf8', timeout: (timeoutS + 30) * 1000 },
      (err, stdout, stderr) =>
        done({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    );
  });
  try {
    if (run.code !== 0) {
      const why = run.stderr.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
      return { ok: false, detail: `exit ${run.code} — ${why.slice(0, 240)}` };
    }
    const port = Number(run.stdout.trim().split('\n').pop());
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return { ok: false, detail: `no port on stdout: ${run.stdout.slice(0, 120)}` };
    const r = await fetch(`http://127.0.0.1:${port}/_health`, {
      signal: AbortSignal.timeout(5000),
    });
    const h = await r.json().catch(() => null);
    if (!r.ok || h?.ok !== true || h?.app !== 'design')
      return { ok: false, detail: `/_health on ${port} answered ${r.status} ${JSON.stringify(h)}` };
    return { ok: true, detail: `studio up on ${port} (pid ${h.pid})` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    // the studio server-up started for the throwaway project, and nothing else
    try {
      const { pid } = JSON.parse(readFileSync(join(design, '_server.json'), 'utf8'));
      if (Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
      await sleep(500);
    } catch {
      /* never started */
    }
    rmSync(root, { recursive: true, force: true });
  }
}
