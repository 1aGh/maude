// Preloaded by every `bun test` in apps/studio (bunfig.toml). V2-2.9 diagnostics and the V2-2.17
// project index persist to machine caches under ~/.maude; a test — or any server it spawns, which
// inherits process.env — must never write the person's real ones. One throwaway dir per test
// process unless the environment already names its own.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { writeStubClaude } from '../../../scripts/lib/stub-claude.mjs';

const root = mkdtempSync(join(tmpdir(), 'maude-test-machine-'));
process.env.MAUDE_LOG_DIR ??= join(root, 'logs');
process.env.MAUDE_INDEX_DIR ??= join(root, 'index');
// …and the person's own config under ~/.config/maude (prefs.json, keys.json, hubs.json,
// cloud.json): a canvas or test that POSTs /_api/ui-prefs once rewrote the real prefs.json
// (2026-10-10). XDG_CONFIG_HOME covers every writer that follows the XDG rule; the prefs path is
// pinned too in case a test clears XDG for one server. HOME stays: browser caches live there.
process.env.XDG_CONFIG_HOME ??= join(root, 'config');
process.env.MAUDE_UI_PREFS_PATH ??= join(root, 'config', 'maude', 'prefs.json');
// cloud.json resolves under homedir() directly, not XDG (cloud/endpoints.ts, cloud/renew.ts).
process.env.MAUDE_CLOUD_CONFIG ??= join(root, 'config', 'maude', 'cloud.json');
// S5.1b — the local kernel's machine stamp (~/.config/maude/machine.json), written on any unlinked
// project's boot. XDG covers it too; pinned in case a test clears XDG for one server.
process.env.MAUDE_MACHINE_FILE ??= join(root, 'config', 'maude', 'machine.json');
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
