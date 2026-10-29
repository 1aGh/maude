// Tripwire: no test or harness may write the person's real machine index (~/.maude/index/v1).
// A studio booted without MAUDE_INDEX_DIR persists its project snapshot (and, since P8, its covers)
// there, and Home lists it: on 2026-10-29 Michal's index held 2,292 projects, ~2,120 of them test
// copies under /var/folders, /tmp, com.maude.app.e2e, worktrees and journey/eval scratch dirs.
//
//  1. STATIC — every file under scripts/, apps/studio/{test,bin}/, apps/desktop/{e2e,scripts}/ and
//     apps/hub/test/ that isolates HOME / XDG_CONFIG_HOME for a child AND boots a studio must name
//     MAUDE_INDEX_DIR, or be listed in EXEMPT with a reason. A new harness that forgets is red.
//  2. RUNTIME — the bun preload (_machine-cache.preload.ts) and scripts/v2-test-lane.sh both give
//     the process a throwaway MAUDE_INDEX_DIR, so every child spawned with `...process.env` inherits it.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..', '..');
const SCAN = [
  'scripts',
  'apps/studio/test',
  'apps/studio/bin',
  'apps/desktop/e2e',
  'apps/desktop/scripts',
  'apps/hub/test',
];
const SELF = 'apps/studio/test/index-dir-tripwire.test.ts';
const SKIP_DIR = new Set(['node_modules', 'target', 'dist', '.git']);

/** Files that match the isolation + studio-boot heuristic yet legitimately name no index dir. */
const EXEMPT: Record<string, string> = {
  'scripts/test/e2e-prefs-guard.test.mjs':
    'unit test of the e2e process classifier over literal command lines: it boots nothing',
  'apps/desktop/e2e/helpers/prefs-guard.ts':
    'classifies and kills the lane’s own studio processes; it boots none (wdio.conf.ts sets the index)',
  'apps/hub/test/studio-child.test.mjs':
    'unit test of childEnv()/launch() with an injected fake spawn: no studio process is ever started',
  'apps/hub/test/render-door-lane.test.mjs':
    'the hub supervises its studio as a cell (workspace mode): the index service persists nothing there',
};

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP_DIR.has(n)) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(mjs|cjs|js|ts|sh)$/.test(n)) out.push(p);
  }
  return out;
}

// An env OBJECT entry (`HOME: home,`), an assignment (`process.env.HOME = …`) or a shell env
// prefix (`HOME="$W/home" …`, `export XDG_CONFIG_HOME=`); a bare mention in a comment does not count.
const ISOLATES =
  /^\s*(?:HOME|XDG_CONFIG_HOME)\s*:|process\.env\.(?:HOME|XDG_CONFIG_HOME)\s*(?:\?\?)?=|(?:^|\s)(?:export\s+)?(?:HOME|XDG_CONFIG_HOME)=["$]/m;
// Boots a studio (or a hub/app that supervises one) rather than a pure helper.
const BOOTS_STUDIO = /server\.ts|maude-server|\bbootServer\(|MAUDE_STUDIO_BIN|studio\/server/;
const NAMES_INDEX = /MAUDE_INDEX_DIR/;

function violations(files: { rel: string; src: string }[]): string[] {
  const out: string[] = [];
  for (const { rel, src } of files) {
    if (rel === SELF) continue;
    if (!ISOLATES.test(src) || !BOOTS_STUDIO.test(src)) continue;
    if (NAMES_INDEX.test(src)) continue;
    // A bun-suite file that boots through _helpers.bootServer (or spreads process.env) inherits the
    // preload's MAUDE_INDEX_DIR — checked at runtime below, not per file.
    if (rel.startsWith('apps/studio/test/') && /\bbootServer\(|\.\.\.process\.env/.test(src))
      continue;
    if (EXEMPT[rel]) continue;
    out.push(rel);
  }
  return out;
}

const files = SCAN.flatMap((d) => walk(join(REPO, d))).map((p) => ({
  rel: relative(REPO, p).split(sep).join('/'),
  src: readFileSync(p, 'utf8'),
}));

describe('no harness writes the real machine index', () => {
  test('every throwaway-HOME studio harness names its own MAUDE_INDEX_DIR or is exempt', () => {
    expect(violations(files)).toEqual([]);
  });

  test('every exemption names a file that still exists and still matches', () => {
    for (const rel of Object.keys(EXEMPT)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} no longer exists: drop its exemption`).toBeDefined();
      expect(ISOLATES.test(f?.src ?? '') && BOOTS_STUDIO.test(f?.src ?? ''), rel).toBe(true);
      expect(NAMES_INDEX.test(f?.src ?? ''), `${rel} names it now: drop its exemption`).toBe(false);
    }
  });

  test('the bun suite and the test lane hand every child a throwaway index', () => {
    const real = join(homedir(), '.maude', 'index');
    expect(process.env.MAUDE_INDEX_DIR ?? '').not.toBe('');
    expect((process.env.MAUDE_INDEX_DIR ?? '').startsWith(real)).toBe(false);
    const lane = readFileSync(join(REPO, 'scripts', 'v2-test-lane.sh'), 'utf8');
    expect(lane).toMatch(/export MAUDE_INDEX_DIR=/);
  });
});
