// Preloaded by every `bun test` in apps/studio (bunfig.toml). V2-2.9 diagnostics and the V2-2.17
// project index persist to machine caches under ~/.maude; a test — or any server it spawns, which
// inherits process.env — must never write the person's real ones. One throwaway dir per test
// process unless the environment already names its own.
import { beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, sep } from 'node:path';
import { writeStubClaude } from '../../../scripts/lib/stub-claude.mjs';

const root = mkdtempSync(join(tmpdir(), 'maude-test-machine-'));
// "Unless the environment already names its own" — a throwaway one. An inherited value that IS the
// person's (a CI runner exports XDG_CONFIG_HOME=$HOME/.config; a login shell may export any of these)
// is replaced like an unset one, or the `??=` would keep the real dir it exists to keep tests out of.
const REAL_DIRS = [join(homedir(), '.config'), join(homedir(), '.maude')];
const isReal = (v: string) => REAL_DIRS.some((d) => v === d || v.startsWith(d + sep));
function pin(name: string, value: string): void {
  const cur = process.env[name];
  if (!cur || isReal(cur)) process.env[name] = value;
}
pin('MAUDE_LOG_DIR', join(root, 'logs'));
pin('MAUDE_INDEX_DIR', join(root, 'index'));
// …and the person's own config under ~/.config/maude (prefs.json, keys.json, hubs.json,
// cloud.json): a canvas or test that POSTs /_api/ui-prefs once rewrote the real prefs.json
// (2026-10-10). XDG_CONFIG_HOME covers every writer that follows the XDG rule; the prefs path is
// pinned too in case a test clears XDG for one server. HOME stays: browser caches live there.
pin('XDG_CONFIG_HOME', join(root, 'config'));
pin('MAUDE_UI_PREFS_PATH', join(root, 'config', 'maude', 'prefs.json'));
// cloud.json resolves under homedir() directly, not XDG (cloud/endpoints.ts, cloud/renew.ts).
pin('MAUDE_CLOUD_CONFIG', join(root, 'config', 'maude', 'cloud.json'));
// S5.1b — the local kernel's machine stamp (~/.config/maude/machine.json), written on any unlinked
// project's boot. XDG covers it too; pinned in case a test clears XDG for one server.
pin('MAUDE_MACHINE_FILE', join(root, 'config', 'maude', 'machine.json'));
// P8 — a booted studio queues its missing covers 10 s after boot (http.ts `bootCovers`): a test
// server must not start a Chromium of its own next to the test's. test/p8-thumbs-boot-covers.test.ts
// pins the pass itself; a test that wants it from a real server sets MAUDE_NO_BOOT_COVERS=0.
process.env.MAUDE_NO_BOOT_COVERS ??= '1';

// Never the person's real `claude`, and through it the real keychain. A studio boots an ACP
// readiness probe (`claude auth status`); under a test's throwaway HOME the real CLI finds no
// keychain and macOS pops "Keychain Not Found" on the person's screen, and under the real HOME it
// reads the real one. A stub `claude` first on PATH answers "signed out" at once and
// MAUDE_CLAUDE_BIN is emptied so nothing pins the real binary; every child spawned with
// `...process.env` inherits both. Opt out for a deliberate real-CLI run: MAUDE_TEST_REAL_CLAUDE=1.
// (A harness that builds its env from scratch uses scripts/lib/stub-claude.mjs — the tripwire in
// stub-claude-tripwire.test.ts finds one that forgets.)
if (process.env.MAUDE_TEST_REAL_CLAUDE !== '1') {
  const stubBin = writeStubClaude(join(root, 'bin'));
  process.env.PATH = `${stubBin}${delimiter}${process.env.PATH ?? ''}`;
  process.env.MAUDE_CLAUDE_BIN = '';
}

// The suite runs as `bun test --isolate` (package.json `test`, CI, the mini lane): every file gets a fresh
// global and this preload again. Without it each file inherits the earlier files' globals (happy-dom's
// window, a stubbed fetch, `__TAURI__`), deleted env pins and module state, and a full run reads as ~500
// failures in files that pass alone (p8-suite-green 2026-10-30: 497 fails plain, the same tree isolated far
// fewer). `Bun.main` names the file a test runs in, and this preload captured it for the file it ran for:
// when they differ the preload did not run for this file, so the run is not isolated — say so once and stop
// rather than fabricate failures. One file, or `--isolate`, never trips it.
const preloadedFor = Bun.main;
beforeEach(() => {
  if (Bun.main === preloadedFor) return;
  console.error(
    '\napps/studio tests run as `bun test --isolate` (the package.json `test` script): this run shares one ' +
      'global across files, so later files would fail for reasons not their own. Re-run with --isolate.\n'
  );
  process.exit(2);
});
