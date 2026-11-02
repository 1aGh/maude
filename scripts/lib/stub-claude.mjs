// stub-claude.mjs — keep a throwaway-HOME harness off the person's real `claude` and keychain.
//
// WHY: a studio boots an ACP readiness probe (`claude auth status`). With a throwaway HOME and the
// real ~/.local/bin/claude on PATH, the real CLI looks for a keychain that HOME lacks and macOS
// pops "Keychain Not Found … 'iagh'" on the person's screen; with the real HOME it reads the real
// keychain. Tests and harnesses must do neither. The fix is one stub `claude` first on PATH that
// answers "signed out" at once, plus MAUDE_CLAUDE_BIN emptied so nothing pins the real binary.
//
// Usage — spread the result into the child's env AFTER `...process.env`:
//
//   import { stubClaudeEnv } from '../scripts/lib/stub-claude.mjs';
//   spawn('bun', [...], { env: { ...process.env, HOME: home, ...stubClaudeEnv(home) } });
//
// A tripwire (apps/studio/test/stub-claude-tripwire.test.ts) fails when a harness that isolates HOME
// or XDG_CONFIG_HOME and boots a studio neither uses this nor carries an exemption with a reason.
// Memory: maude-fake-home-real-claude-keychain. Opt out for a deliberate real-CLI run with
// MAUDE_TEST_REAL_CLAUDE=1 (bun suite preload only).
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const STUB_CLAUDE_SCRIPT = `#!/bin/sh\necho '{"loggedIn":false}'\n`;

/** Write `<dir>/claude` (mode 0755) and return `dir`. */
export function writeStubClaude(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'claude'), STUB_CLAUDE_SCRIPT, { mode: 0o755 });
  return dir;
}

/**
 * @param {string} home  a directory the caller owns (typically the throwaway HOME); the stub lands
 *                       in `<home>/bin/claude`
 * @param {string} [basePath]  PATH to keep behind the stub (default: this process's)
 * @returns {{ PATH: string, MAUDE_CLAUDE_BIN: string }}
 */
export function stubClaudeEnv(home, basePath = process.env.PATH ?? '') {
  const bin = writeStubClaude(join(home, 'bin'));
  return { PATH: basePath ? `${bin}${delimiter}${basePath}` : bin, MAUDE_CLAUDE_BIN: '' };
}
