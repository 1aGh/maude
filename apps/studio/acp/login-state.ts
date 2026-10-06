// Claude auth sign-in from inside Maude (DDR-166, T0d). Drives the user's OWN
// `claude` CLI through its own documented `auth login`/`auth status` subcommands
// — Maude never renders a login form, never sees a token, never touches
// ~/.claude. Deliberately in the SAME Bun process as bridge.ts/env.ts (DDR-166
// Decision 0), so this reuses the literal `scrubAgentEnv`/`resolveClaudePath`
// the chat spawn already uses — not a re-derived twin that could drift from it.

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { scrubAgentEnv } from './env.ts';
import { resolveClaudePath, setTrustedClaudeBin } from './probe.ts';

// getClaudeAuthStatus lives in probe.ts now (probeAcpAvailabilityAuthed needs
// it too, and probe.ts is the lower-level module — login-state.ts building on
// probe.ts, not the other way around, avoids a circular import). Re-exported
// here so existing `from './login-state.ts'` imports keep working.
export { type ClaudeAuthStatus, getClaudeAuthStatus } from './probe.ts';

// Single-flight guard (security review finding: concurrent sign-in attempts
// must be rejected, not queued or raced — and the child must not outlive the
// UI's own lifecycle).
let signinChild: ReturnType<typeof Bun.spawn> | null = null;

export function isSigninInFlight(): boolean {
  return signinChild !== null;
}

/**
 * Spawn `claude auth login` (the user's own CLI's own browser-based OAuth —
 * never Maude's). Fire-and-forget from the caller's perspective; completion is
 * detected by polling {@link getClaudeAuthStatus}, not by this function's
 * return. stdout/stderr are discarded, not drained-and-logged — `claude auth
 * login`'s own progress text isn't something Maude needs to see or persist.
 */
/** DDR-166 Decision 5 — the settings-UI opt-out (prefs.rs `claude_auto_setup`). */
function autoSetupDisabled(): boolean {
  return process.env.MAUDE_CLAUDE_AUTOSETUP_ENABLED === '0';
}

export function startSignin(): { ok: boolean; reason?: string } {
  if (autoSetupDisabled())
    return { ok: false, reason: 'Automatic setup is turned off in Settings.' };
  if (signinChild) return { ok: false, reason: 'A sign-in is already in progress.' };
  const bin = resolveClaudePath();
  if (!bin) return { ok: false, reason: 'Claude Code is not installed.' };
  const child = Bun.spawn([bin, 'auth', 'login', '--claudeai'], {
    env: scrubAgentEnv(),
    windowsHide: true, // #141
    stdout: 'ignore',
    stderr: 'ignore',
  });
  signinChild = child;
  child.exited.finally(() => {
    if (signinChild === child) signinChild = null;
  });
  return { ok: true };
}

/** Kill the in-flight sign-in child, if any — cancel button + app-quit path. */
export function cancelSignin(): void {
  if (signinChild) {
    try {
      signinChild.kill();
    } catch {
      /* already exited */
    }
    signinChild = null;
  }
}

// DDR-166 T0c, Addendum 2 — install `claude` via the exact official one-liner,
// once, ephemerally: no persistent Maude-managed cache of a downloaded
// artifact (that design was rejected on security review — a durable,
// unverified cache is exactly the "plant a bad file while idle, get a silent
// standing MITM over every future chat session" exploit chain). Anthropic's
// own installer decides where the binary lands and how it's trusted, same as
// when a user runs this command themselves.
const NATIVE_INSTALL_CMD = 'curl -fsSL https://claude.ai/install.sh | bash';
// Empirically confirmed 2026-07-13: the native installer places the binary
// here but does NOT add it to PATH itself — it only prints a suggestion for
// the user to edit their shell config by hand.
//
// `MAUDE_E2E_CLAUDE_INSTALL_PATH` override — desktop-e2e (T0f, `acp-cold-start`
// scenario) needs to drive this EXACT install flow deterministically, but must
// never write into a real developer's actual `~/.local/bin/claude` (would
// clobber a genuine install). The e2e config points this at a disposable temp
// path instead; unset in every normal launch, so real users always get the
// real well-known path.
const WELL_KNOWN_INSTALL_PATH =
  process.env.MAUDE_E2E_CLAUDE_INSTALL_PATH || join(homedir(), '.local', 'bin', 'claude');

// Desktop-e2e stub (mirrors MAUDE_E2E_FAKE_GITHUB_LOGIN in oauth.rs) — running
// the REAL `curl | bash` installer in a test harness is both slow/network-
// dependent and not what's under test (the guided-UI wiring is). When set,
// `startInstall()` skips the real installer and instead writes this tiny,
// offline, deterministic stand-in to `WELL_KNOWN_INSTALL_PATH` (itself
// e2e-overridden — see above) — through the EXACT SAME freshness + content-pin
// verification path a real install goes through below, so that security-
// critical code stays exercised, not bypassed. Never set in a normal launch.
const E2E_FAKE_INSTALL = process.env.MAUDE_E2E_FAKE_CLAUDE_INSTALL === '1';
const FAKE_CLAUDE_SCRIPT = `#!/bin/sh
# Maude desktop-e2e fake claude binary (DDR-166) — only ever written when
# MAUDE_E2E_FAKE_CLAUDE_INSTALL=1. Implements just enough of \`auth status\`/
# \`auth login\` for the acp-cold-start scenario to drive a real sign-in poll.
STATE_FILE="$(dirname "$0")/.e2e-signed-in"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "$STATE_FILE" ]; then
    echo '{"loggedIn":true,"apiProvider":"firstParty","subscriptionType":"max"}'
  else
    echo '{"loggedIn":false}'
  fi
  exit 0
elif [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  sleep 1
  touch "$STATE_FILE"
  exit 0
fi
exit 1
`;

type InstallState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; ok: boolean; reason?: string };

let installState: InstallState = { phase: 'idle' };

export function isInstallInFlight(): boolean {
  return installState.phase === 'running';
}

/** Poll target — the panel calls this while an install is in flight (mirrors `getClaudeAuthStatus`'s role for sign-in). */
export function getInstallState(): InstallState {
  return installState;
}

/**
 * Spawn the official installer and return immediately (fire-and-forget) — a
 * request handler that instead `await`s the full install can exceed Bun's
 * default 10s idle timeout on a slow network, killing the connection with no
 * response. Completion is detected by polling {@link getInstallState}, the
 * same shape {@link startSignin}/{@link getClaudeAuthStatus} already use.
 *
 * ONLY on verified-fresh success does this make the result visible to
 * {@link resolveClaudePath} for the rest of this process's life. "Verified
 * fresh" = the binary at the well-known path has an mtime AFTER this call
 * started. This is the fix for a security-review finding against an earlier
 * draft: an unconditional "does a file exist at `~/.local/bin/claude`" check
 * is a standing, unverified trust point — a same-user attacker could plant a
 * substitute there at any idle time, and it would get silently adopted on
 * some later, unrelated install click, with the exact same blast radius the
 * original cached-artifact design was rejected for (every future chat spawn
 * AND every `auth status` check trusts whatever's there). Requiring the
 * mtime to postdate this call's own start means only a file *this specific
 * install action* just wrote gets trusted — a pre-existing or planted file
 * does not, and is reported as an honest "couldn't verify" failure.
 *
 * The resulting trust is session-scoped ONLY: `MAUDE_CLAUDE_BIN` is set via
 * `process.env`, in-memory, never written to disk. A future cold start where
 * the user didn't just click install gets no special treatment — same as a
 * manual curl|bash user, who has to add `~/.local/bin` to PATH themselves.
 */
// Tracked at module level (not just the async IIFE's own closure) so
// cancelInstall()/app-shutdown can reach it — a security-review finding
// against the first cut of this function: the DDR itself names "an explicit
// answer for how a Tauri app-quit event reaches and kills the login-
// subprocess's grandchild" as an open question, and the install child had no
// answer at all (unreachable once spawned).
let installChild: ReturnType<typeof Bun.spawn> | null = null;

export function startInstall(): { ok: boolean; reason?: string } {
  if (autoSetupDisabled())
    return { ok: false, reason: 'Automatic setup is turned off in Settings.' };
  if (installState.phase === 'running')
    return { ok: false, reason: 'An install is already in progress.' };
  installState = { phase: 'running' };
  const startedAt = Date.now();
  (async () => {
    try {
      let code: number;
      if (E2E_FAKE_INSTALL) {
        // Keep the "Installing…" polling UI genuinely exercised instead of
        // resolving on the same tick.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        mkdirSync(dirname(WELL_KNOWN_INSTALL_PATH), { recursive: true });
        writeFileSync(WELL_KNOWN_INSTALL_PATH, FAKE_CLAUDE_SCRIPT, { mode: 0o755 });
        chmodSync(WELL_KNOWN_INSTALL_PATH, 0o755);
        code = 0;
      } else {
        const proc = Bun.spawn(['bash', '-c', NATIVE_INSTALL_CMD], {
          env: scrubAgentEnv(),
          stdin: 'ignore',
          // Install progress text carries no PII (unlike auth status), but
          // there's no product need to surface it either — discard, don't
          // drain-and-log.
          stdout: 'ignore',
          stderr: 'ignore',
        });
        installChild = proc;
        code = await proc.exited;
        installChild = null;
      }
      if (code !== 0) {
        installState = {
          phase: 'done',
          ok: false,
          reason: `The installer exited with an error (code ${code}).`,
        };
        return;
      }
      if (!existsSync(WELL_KNOWN_INSTALL_PATH)) {
        installState = {
          phase: 'done',
          ok: false,
          reason:
            'The installer reported success, but no binary was found at the expected location.',
        };
        return;
      }
      const st = statSync(WELL_KNOWN_INSTALL_PATH);
      if (st.mtimeMs < startedAt) {
        installState = {
          phase: 'done',
          ok: false,
          reason:
            'A claude binary already exists but could not be verified as freshly installed. Add ~/.local/bin to your PATH, then try Re-check.',
        };
        return;
      }
      // DDR-166 — content-pin, not just path-pin (a bare MAUDE_CLAUDE_BIN
      // existence check trusts the path forever after this one-time
      // freshness check). setTrustedClaudeBin makes resolveClaudePath()
      // re-verify this exact content UNCONDITIONALLY on every future
      // resolution (probe.ts's own doc comment covers why there's
      // deliberately no mtime-caching shortcut — an earlier draft had one,
      // and it was itself trivially bypassable by the same attacker).
      const sha256 = createHash('sha256')
        .update(readFileSync(WELL_KNOWN_INSTALL_PATH))
        .digest('hex');
      setTrustedClaudeBin(WELL_KNOWN_INSTALL_PATH, sha256);
      process.env.MAUDE_CLAUDE_BIN = WELL_KNOWN_INSTALL_PATH;
      installState = { phase: 'done', ok: true };
    } catch {
      installChild = null;
      installState = { phase: 'done', ok: false, reason: 'Could not run the installer.' };
    }
  })();
  return { ok: true };
}

/** Kill the in-flight install child, if any — cancel path + app-quit/shutdown path. */
export function cancelInstall(): void {
  if (installChild) {
    try {
      installChild.kill();
    } catch {
      /* already exited */
    }
    installChild = null;
    installState = { phase: 'idle' };
  }
}
