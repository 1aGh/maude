// Tripwire: no test or harness may reach the person's real `claude` (and through it the real
// keychain). Two halves:
//
//  1. STATIC — every file under scripts/, apps/studio/test/, apps/desktop/{e2e,scripts}/ and
//     apps/hub/test/ that isolates HOME / XDG_CONFIG_HOME for a child AND boots a studio must use the
//     shared stub (scripts/lib/stub-claude.mjs → stubClaudeEnv), carry the stub pattern itself
//     (MAUDE_CLAUDE_BIN), or be listed in EXEMPT with a reason. A new harness that forgets is red.
//  2. RUNTIME — the bun suite's preload (_machine-cache.preload.ts) put a stub `claude` first on
//     PATH and emptied MAUDE_CLAUDE_BIN, so every child spawned with `...process.env` inherits it.
//
// Memory: maude-fake-home-real-claude-keychain (macOS "Keychain Not Found" dialogs, 2026-10).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join, relative, resolve, sep } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..', '..');
const SCAN = [
  'scripts',
  'apps/studio/test',
  'apps/desktop/e2e',
  'apps/desktop/scripts',
  'apps/hub/test',
];
const SELF = 'apps/studio/test/stub-claude-tripwire.test.ts';
const SKIP_DIR = new Set(['node_modules', 'target', 'dist', '.git']);

/** Files that match the isolation + studio-boot heuristic yet legitimately carry no stub. */
const EXEMPT: Record<string, string> = {
  'apps/studio/test/export-e2e-lanes.test.ts':
    'its HOME env belongs to the apps/render server (no ACP probe); studios boot via bootServer, which inherits the preload stub',
  'apps/hub/test/studio-child.test.mjs':
    'unit test of childEnv()/launch() with an injected fake spawn: no process, no claude is ever started',
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
    else if (/\.(mjs|cjs|js|ts)$/.test(n)) out.push(p);
  }
  return out;
}

// An env OBJECT entry (`HOME: home,`) or an assignment (`process.env.HOME = …`); a bare mention of
// the word in a comment or a `const HOME = '…'` canvas fixture does not count.
const ISOLATES = /^\s*(?:HOME|XDG_CONFIG_HOME)\s*:|process\.env\.(?:HOME|XDG_CONFIG_HOME)\s*=/m;
// Boots a studio (or a hub that supervises one) rather than a pure helper.
const BOOTS_STUDIO = /server\.ts|maude-server|\bbootServer\(|MAUDE_STUDIO_BIN|studio\/server/;
const STUBBED = /stubClaudeEnv|writeStubClaude|MAUDE_CLAUDE_BIN/;

function violations(files: { rel: string; src: string }[]): string[] {
  const out: string[] = [];
  for (const { rel, src } of files) {
    if (rel === SELF || rel === 'scripts/lib/stub-claude.mjs') continue;
    if (!ISOLATES.test(src) || !BOOTS_STUDIO.test(src)) continue;
    if (STUBBED.test(src)) continue;
    // A bun-suite file that boots through _helpers.bootServer (or spreads process.env) inherits the
    // preload's PATH stub — checked at runtime below, not per file.
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

describe('no harness reaches the real claude / keychain', () => {
  test('every throwaway-HOME studio harness uses the stub or is exempt with a reason', () => {
    expect(violations(files)).toEqual([]);
  });

  test('every exemption names a file that still exists and still matches', () => {
    for (const rel of Object.keys(EXEMPT)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} no longer exists: drop its exemption`).toBeDefined();
      expect(EXEMPT[rel]?.length ?? 0).toBeGreaterThan(20);
      // an exemption that no longer matches the heuristic (or got stubbed) is stale: drop it
      expect(ISOLATES.test(f?.src ?? '') && BOOTS_STUDIO.test(f?.src ?? ''), rel).toBe(true);
      expect(STUBBED.test(f?.src ?? ''), `${rel} is stubbed now: drop its exemption`).toBe(false);
    }
  });

  test('the check bites: a harness with HOME + a studio boot and no stub is flagged', () => {
    const bad = {
      rel: 'scripts/fake-harness.mjs',
      src: `spawn('bun', [join(STUDIO, 'server.ts')], { env: { ...process.env,\n  HOME: home,\n } })`,
    };
    expect(violations([bad])).toEqual(['scripts/fake-harness.mjs']);
    const good = { ...bad, src: `${bad.src}\n...stubClaudeEnv(home)` };
    expect(violations([good])).toEqual([]);
  });
});

describe('the bun suite preload stubs claude process-wide', () => {
  const real = process.env.MAUDE_TEST_REAL_CLAUDE === '1';

  test.skipIf(real)(
    'PATH starts with a stub claude that reports signed out, MAUDE_CLAUDE_BIN is empty',
    () => {
      const first = (process.env.PATH ?? '').split(delimiter)[0] ?? '';
      const stub = join(first, 'claude');
      expect(readFileSync(stub, 'utf8')).toContain('"loggedIn":false');
      expect(statSync(stub).mode & 0o111).not.toBe(0);
      expect(process.env.MAUDE_CLAUDE_BIN).toBe('');
      const r = Bun.spawnSync({ cmd: ['claude', 'auth', 'status'], env: process.env });
      expect(r.stdout.toString()).toContain('"loggedIn":false');
    }
  );

  test('bootServer hands the server the suite env (so the stub travels)', () => {
    const helpers = readFileSync(join(import.meta.dir, '_helpers.ts'), 'utf8');
    const boot = helpers.slice(helpers.indexOf('export async function bootServer'));
    expect(boot).toMatch(/env:\s*\{\s*\.\.\.process\.env/);
  });
});
