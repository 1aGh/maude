// Detection layer for the ACP chat bridge: where is the spawnable
// `claude-agent-acp` adapter, is the user's `claude` CLI installed, and which JS
// runtime should run the adapter. All disk paths resolve through DEV_SERVER_ROOT
// (DDR-045) — never `dirname(import.meta.url)`, which is the virtual `/$bunfs`
// path inside a compiled binary. Per DDR-123 the panel is native-app only; the
// native shell ships the apps/studio source tree (with node_modules), so the
// adapter resolves on disk there.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';

import { DEV_SERVER_ROOT, IS_COMPILED_BINARY } from '../paths.ts';
import { scrubAgentEnv } from './env.ts';

/** Adapter npm package — the renamed continuation of `@zed-industries/claude-code-acp`. */
const ADAPTER_PKG = '@agentclientprotocol/claude-agent-acp';
const ADAPTER_BIN_NAME = 'claude-agent-acp';

export interface AcpAvailability {
  /** True when both the adapter entry and a `claude` CLI are resolvable. */
  available: boolean;
  /** Human-readable reason when `available` is false (drives the not-connected UI). */
  reason?: string;
  /** Absolute path to the adapter entry JS, or null. */
  adapterEntry: string | null;
  /** Absolute path to the `claude` CLI, or null. */
  claudePath: string | null;
}

/**
 * Resolve the adapter's spawnable entry script (its `bin`), trying:
 *   1. `MAUDE_ACP_ADAPTER_ENTRY` override (tests + escape hatch).
 *   2. The package's own `package.json` `bin` field, joined to its dir.
 *   3. The pnpm `.bin/<name>` symlink, dereferenced to the real file.
 * Returns an absolute path or null.
 */
export function resolveAdapterEntry(): string | null {
  const override = process.env.MAUDE_ACP_ADAPTER_ENTRY;
  if (override) return existsSync(override) ? override : null;

  // (2) Locate the installed package via its package.json, read the bin map.
  try {
    const pkgJsonPath = Bun.resolveSync(`${ADAPTER_PKG}/package.json`, DEV_SERVER_ROOT);
    const pkgDir = dirname(pkgJsonPath);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[ADAPTER_BIN_NAME];
    if (binRel) {
      const entry = join(pkgDir, binRel);
      if (existsSync(entry)) return entry;
    }
  } catch {
    /* fall through to the symlink strategy */
  }

  // (3) The pnpm-linked bin symlink in the dev-server's own node_modules.
  try {
    const sym = join(DEV_SERVER_ROOT, 'node_modules', '.bin', ADAPTER_BIN_NAME);
    if (existsSync(sym)) return realpathSync(sym);
  } catch {
    /* not present */
  }

  return null;
}

/**
 * Content pin for a Maude-auto-provisioned `MAUDE_CLAUDE_BIN` override
 * (DDR-166 T0c, `installClaudeCli()` in `login-state.ts` is the only writer).
 *
 * Second-round security-review finding against the first cut of this file:
 * checking only `existsSync(override)` on every call meant that once a
 * freshly-installed binary passed its one-time freshness check, the PATH
 * override was trusted **forever** for the rest of this long-lived process —
 * a same-UID attacker who swapped the file's *content* at any later point in
 * the session (the install-flow one-time check does not repeat) got the
 * exact "durable, silent MITM over every future chat spawn" blast radius the
 * original cached-artifact design was rejected for, just reached through a
 * different door. Path existence is not authenticity.
 *
 * The fix: pin the SHA-256 captured at verified-install time, and re-hash
 * UNCONDITIONALLY on every resolution — no mtime-based caching shortcut.
 *
 * A third-round review finding against the first cut of this fix: an
 * earlier draft cached the hash result keyed on mtime ("skip the re-hash if
 * mtime is unchanged since the last verified read") as a performance
 * optimization. That cache is trivially forgeable by the EXACT SAME attacker
 * the fix exists to stop: swapping the file's content costs them nothing
 * beyond a `touch -d <original-mtime>` immediately after, at zero additional
 * privilege — same-UID write access to the file is already required for the
 * swap itself, and mtime is neither secret nor tamper-evident (`utimensat`
 * sets it with nanosecond precision, not a race against clock granularity).
 * The cache silently reopened the exact "durable, silent MITM over every
 * future chat spawn" blast radius the whole fix exists to close.
 *
 * The "don't re-hash on every 1.5s readiness-poll tick" concern that
 * motivated the cache doesn't actually hold: readiness polling
 * (`useReadiness` in `ReadinessList.jsx`) only runs while the panel is
 * DISCONNECTED — i.e., only during the bounded, actively-supervised
 * install/sign-in flow itself, not for the lifetime of a long session. Once
 * connected, nothing polls `/_api/preflight` on an interval. A live-measured
 * SHA-256 pass over the actual ~241 MB installed `claude` binary took
 * ~116 ms — cheap enough to simply always pay, especially since the other
 * caller that matters (a fresh chat-session spawn, once per session) has no
 * latency budget concern at all.
 */
let trustedBin: { path: string; sha256: string } | null = null;

/** Called only by `installClaudeCli()` after its own freshness check passes. */
export function setTrustedClaudeBin(path: string, sha256: string): void {
  trustedBin = { path, sha256 };
}

function hashFile(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

/** True iff `path` is either not a Maude-provisioned override (nothing to pin) or its content still matches the pinned hash — re-hashed every call, deliberately no caching shortcut (see doc comment above). */
function contentStillTrusted(path: string): boolean {
  if (!trustedBin || trustedBin.path !== path) return true; // not our concern — e.g. a user-set override
  return hashFile(path) === trustedBin.sha256;
}

/**
 * Absolute path to the user's installed `claude` CLI, or null. Honors a
 * `MAUDE_CLAUDE_BIN` override; otherwise looks it up on PATH.
 */
export function resolveClaudePath(): string | null {
  // An explicit, content-pinned `MAUDE_CLAUDE_BIN` override is checked FIRST
  // and always wins — including over the E2E force-missing stub below. This
  // matters for the desktop-e2e `acp-cold-start` scenario (T0f): it starts
  // with MAUDE_E2E_FORCE_CLAUDE_STATUS=missing to simulate a machine with no
  // `claude` on PATH, then drives the real T0c install flow, which sets THIS
  // override once its own freshness+hash verification passes
  // (login-state.ts's setTrustedClaudeBin). A coarse "simulate absent" test
  // stub must not out-rank a just-verified, explicitly-provisioned install —
  // that would make the guided install flow untestable end-to-end.
  const override = process.env.MAUDE_CLAUDE_BIN;
  if (override) {
    if (!existsSync(override)) return null;
    if (!contentStillTrusted(override)) return null;
    return override;
  }
  // DDR-166 — deterministic E2E stub (mirrors MAUDE_E2E_FAKE_GITHUB_LOGIN in
  // oauth.rs), simulating a machine where `claude` is absent from PATH.
  // Never set in a normal launch.
  if (process.env.MAUDE_E2E_FORCE_CLAUDE_STATUS === 'missing') return null;
  return Bun.which('claude');
}

/**
 * #148 — the path the ADAPTER can spawn as `CLAUDE_CODE_EXECUTABLE`.
 *
 * The adapter runs under Node (#141), and the SDK spawns this path with
 * `child_process.spawn` and no shell. Since CVE-2024-27980 Node refuses to
 * spawn a `.cmd`/`.bat` that way (EINVAL), and an npm-installed Claude Code on
 * Windows resolves to exactly that: `%APPDATA%\npm\claude.cmd`. `Bun.spawn`
 * (readiness, auth status, sign-in) launches the shim fine, which is why the
 * header said Ready while every session failed with "Internal error".
 *
 * So on win32 a shim is followed to its real target: the target the npm
 * cmd-shim itself names (`"%dp0%\node_modules\...\cli.js"`), else the
 * package entry beside the shim, else a native `claude.exe` next to it. The SDK
 * runs a `.js` executable through its own JS runtime. Returns null when no
 * spawnable target exists — callers report that, never spawn the shim.
 */
export function resolveAgentClaudeExecutable(
  claudePath: string,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
  readText: (p: string) => string = (p) => readFileSync(p, 'utf8')
): string | null {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(claudePath)) return claudePath;
  const shimDir = win32.dirname(claudePath);
  const candidates: string[] = [];
  try {
    for (const m of readText(claudePath).matchAll(
      /%~?dp0%?\\([^"%\r\n]+?\.(?:js|mjs|cjs|exe))/gi
    )) {
      candidates.push(win32.join(shimDir, m[1]));
    }
  } catch {
    /* unreadable shim — fall through to the conventional layout */
  }
  candidates.push(
    win32.join(shimDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    win32.join(shimDir, 'claude.exe')
  );
  return candidates.find((c) => exists(c)) ?? null;
}

/**
 * The JS runtime used to launch the adapter, plus whether it must be spawned
 * with `BUN_BE_BUN=1`. Ladder: explicit `MAUDE_ACP_RUNTIME` override → a real
 * `node` (the adapter + `@anthropic-ai/claude-agent-sdk` are authored for Node)
 * → a real `bun` → our OWN `process.execPath`.
 *
 * The last rung is the RCA-G1 fix. On a machine with NO node/bun (the target
 * user — installs the `.app`, never opens a terminal), `process.execPath` inside
 * the `bun --compile` dev-server sidecar is the sidecar BINARY, not a JS
 * interpreter: a compiled Bun executable only runs a passed script when
 * `BUN_BE_BUN=1` is set — otherwise it re-runs its own embedded server and the
 * ACP handshake never happens, so the panel hangs at "Working…" forever (the
 * exact reported bug; the user's own `brew install node` masked it by making the
 * `node` rung resolve). So when we fall back to our own COMPILED self we flag
 * `bunBeBun=true`; `bridge.ts` sets it on the child env. In dev, `execPath` is a
 * real `bun` and `IS_COMPILED_BINARY` is false, so `bunBeBun` stays false (no-op).
 *
 * The bundled compiled sidecar IS Bun 1.3.x, so this needs ZERO extra bytes and
 * makes AI editing work with no user-installed runtime. NOTE the adapter + SDK
 * are Node-authored — running them under Bun via this rung MUST be verified on a
 * real compiled, node-less build (the dev path prefers `node`, so Bun is not
 * exercised there); if a Bun/Node incompatibility surfaces, bundle a real `node`
 * as an externalBin and point `MAUDE_ACP_RUNTIME` at it (the override rung above).
 */
export function resolveAgentRuntime(): { bin: string; bunBeBun: boolean } {
  const override = process.env.MAUDE_ACP_RUNTIME;
  if (override) return { bin: override, bunBeBun: false };
  const node = Bun.which('node');
  if (node) return { bin: node, bunBeBun: false };
  const bun = Bun.which('bun');
  if (bun) return { bin: bun, bunBeBun: false };
  return { bin: process.execPath, bunBeBun: IS_COMPILED_BINARY };
}

/**
 * Cheap, side-effect-free readiness probe (no subprocess spawned) backing
 * `GET /_api/acp/status` and the WS `ready` frame. The actual ACP session spins
 * up lazily on the first prompt.
 */
export function probeAcpAvailability(): AcpAvailability {
  const adapterEntry = resolveAdapterEntry();
  const claudePath = resolveClaudePath();
  if (!adapterEntry) {
    return {
      available: false,
      reason: 'The Claude agent bridge is not installed in this build.',
      adapterEntry: null,
      claudePath,
    };
  }
  if (!claudePath) {
    return {
      available: false,
      reason: "Claude Code isn't connected — run `claude` in a terminal and `/login`.",
      adapterEntry,
      claudePath: null,
    };
  }
  if (!resolveAgentClaudeExecutable(claudePath)) {
    return {
      available: false,
      reason:
        'Claude Code was found only as an npm `claude.cmd` shim the chat cannot start. Reinstall it with the native installer (`irm https://claude.ai/install.ps1 | iex`).',
      adapterEntry,
      claudePath,
    };
  }
  return { available: true, adapterEntry, claudePath };
}

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  /** 'firstParty' = claude.ai subscription. Anything else may mean API billing. */
  apiProvider?: string;
  subscriptionType?: string;
}

// A `claude` on PATH is not always the real binary. A version-manager shim
// (mise, asdf, volta) or a corporate `bin` wrapper routinely fronts it, and
// several of those print a banner to STDOUT before `exec`ing the real thing —
// `stderr: 'ignore'` doesn't help, because the noise isn't on stderr.
//
// Issue #107: `~/.local/bin/claude` was a mise shim whose `mise use -g claude`
// confirmation line landed ahead of the JSON. `JSON.parse(wholeStdout)` threw,
// the blanket catch returned null, and the readiness gate told a signed-in user
// they were signed OUT — then sent them to a Sign-in button that could only ever
// end in "Sign-in timed out", because the 2 s poll re-ran the same deterministic
// parse failure for 120 s.
//
// So: extract the JSON OBJECT from the blob rather than parsing the blob. This
// widens nothing about what is TRUSTED — the binary was already resolved and
// spawned by us, and the caller still narrows to three fields.
//
// The scan runs BACKWARDS from the end, and every giving-up path returns null
// rather than a best guess. Both properties are security-review findings against
// the first cut of this function (defender M1, attacker F1/F2), and they are the
// same lesson twice: a parser that fails SOFT re-creates #107 through a new door.
//   • Forwards + a candidate budget meant noise was scanned first and the real
//     payload could fall outside the window — 99 bare `{}` in a 242-byte prefix
//     pushed a genuine `loggedIn:false` out of scan range and let a forged
//     `loggedIn:true` win, turning a fail-CLOSED `JSON.parse` throw into
//     fail-OPEN. Backwards makes the budget bite on the noise side, where it
//     belongs, and matches the actual invariant: a wrapper's banner is written
//     BEFORE it execs, so the real payload is the LAST thing on stdout.
//   • Truncation now keeps the TAIL, for the same reason. Slicing the head threw
//     away the answer and kept the noise.
//   • Returning "the last object that parsed at all" meant an NDJSON-logging
//     wrapper's `{"level":"info",...}` became `loggedIn: !!undefined` → a
//     confident false "not signed in", with the dead-end Sign-in button armed.
//     An object with no `loggedIn` is not a status document; null is.

/** Enough for any plausible banner + payload; a shim writes a line, not a stream. */
const AUTH_STATUS_SCAN_LIMIT = 1 << 20;
/** Bounds the candidate scan so a pathological blob of `{` can't become a CPU sink. */
const AUTH_STATUS_MAX_CANDIDATES = 100;
/** Wall clock for the whole read. The probe MUST resolve — see `readBounded`. */
const AUTH_STATUS_TIMEOUT_MS = 5000;

/** Index of the `}` closing the `{` at `from`, or -1. String- and escape-aware, so a brace inside a JSON string never miscounts. */
function matchingBrace(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The last `{…}` in `out` that parses to an object carrying `loggedIn`, found by
 * scanning `{` positions backwards from the end. Returns null when no such object
 * is in range — including when the candidate budget runs out, which is a scan that
 * did not finish, not a status that says "signed out". The caller must render null
 * as "couldn't read", never as a claim about the user.
 */
function extractAuthStatusObject(out: string): Record<string, unknown> | null {
  // Keep the TAIL on truncation: the payload trails the noise, so the end is the
  // half worth having.
  const text = out.length > AUTH_STATUS_SCAN_LIMIT ? out.slice(-AUTH_STATUS_SCAN_LIMIT) : out;
  let tried = 0;
  let start = text.lastIndexOf('{');
  while (start !== -1 && ++tried <= AUTH_STATUS_MAX_CANDIDATES) {
    const end = matchingBrace(text, start);
    if (end !== -1) {
      try {
        const parsed: unknown = JSON.parse(text.slice(start, end + 1));
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          'loggedIn' in (parsed as Record<string, unknown>)
        ) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* noise that merely looked like an object — keep walking backwards */
      }
    }
    // `lastIndexOf(needle, -1)` clamps to 0 and would re-test index 0 for the
    // whole remaining budget (round-2 defender L7) — stop instead.
    if (start === 0) break;
    start = text.lastIndexOf('{', start - 1);
  }
  return null;
}

/**
 * Read `stream` to EOF, bounded by `timeoutMs` and by a `maxBytes` sliding TAIL
 * window. Always returns whatever bytes it managed to collect — never null.
 *
 * Security-review finding (defender M2 / attacker F3): the previous
 * `await new Response(proc.stdout).text()` resolves on pipe EOF, and `proc.kill()`
 * signals only the DIRECT child. #107's proven root cause was a self-recursive
 * wrapper, i.e. exactly the shape that leaves descendants holding fd 1 after the
 * kill — so the read never completed, `probeReadiness()` never resolved, and
 * `GET /_api/preflight` hung. The honest-unknown path this whole change exists to
 * render was unreachable in its own headline scenario.
 *
 * Round-2 finding (defender L6): the first cut of this function returned null on
 * BOTH bounds, throwing away a payload it was already holding. A signed-in user
 * whose wrapper backgrounds anything at all — a daemon, an update check, a
 * corporate agent — printed a perfectly good status, then lost AI editing to a
 * deadline that fired on the still-open pipe. Honest, but the answer was in the
 * buffer. Returning it cannot fabricate a status: `extractAuthStatusObject` still
 * demands a parsed `loggedIn`-bearing object, so a partial or garbled tail is
 * still null.
 *
 * The cap is a sliding window for the same reason the scan runs backwards — the
 * payload trails the noise, so when we must drop bytes we drop the OLDEST. The
 * drop is byte-exact, not chunk-granular (attacker R3-2).
 *
 * ACCEPTED TRADE, stated plainly because the round-2 docstring overclaimed
 * (attacker R3-1): **the deadline path is no longer fail-closed.** This function
 * cannot distinguish "this is all of stdout" from "this is the first 5 s of
 * stdout", so a deadline landing mid-stream answers from whatever complete object
 * precedes the cut — a stale status where round-2 code returned null. That is
 * accepted, not overlooked: the alternative cost a signed-in user AI editing for
 * the far more common backgrounding-wrapper shape, and forcing the stale answer
 * requires controlling the writer's timing, which is the owner position — from
 * there the binary can simply return whatever status it likes.
 */
async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  timeoutMs: number
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = Symbol('expired');
      const next = await Promise.race([
        reader.read(),
        new Promise<typeof expired>((resolve) => {
          timer = setTimeout(() => resolve(expired), left);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (next === expired) break;
      if (next.done) break;
      if (next.value?.byteLength) {
        chunks.push(next.value);
        total += next.value.byteLength;
        // Bound memory DURING the read, not by materialising the whole blob and
        // slicing after — a fast writer has no practical ceiling inside the
        // timeout window otherwise.
        // Byte-exact, one branch (attacker R3-2). Shifting whole chunks
        // overshot by up to `sizeof(oldest chunk) - 1` — measured 262 144 B
        // over-dropped for a 150-byte overflow against a real Bun pipe, so the
        // effective window was as little as 75 % of the advertised cap, while
        // the sibling single-chunk branch four lines away was byte-exact. Same
        // window, two granularities, and the doc claimed the byte one.
        while (total > maxBytes) {
          const first = chunks[0];
          if (!first) break;
          const over = total - maxBytes;
          if (first.byteLength <= over) {
            chunks.shift();
            total -= first.byteLength;
          } else {
            chunks[0] = first.subarray(over);
            total -= over;
          }
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  // A dropped leading chunk can split a UTF-8 sequence; the decoder emits U+FFFD
  // there, which the `{`-scan simply walks past.
  return new TextDecoder().decode(joined);
}

/**
 * Narrow a status tag for DISPLAY. Attacker F5: `apiProvider` is interpolated
 * verbatim into the readiness row, so an unbounded, unsanitized value is
 * arbitrary text inside a trusted system-status line. Anything that isn't a
 * short identifier becomes the literal `unrecognized` — deliberately NOT
 * `undefined`, which would read as "no provider" and silently suppress the
 * metered-billing warning (`offSubscription` in readiness.ts tests `!== 'firstParty'`).
 */
function narrowStatusTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : 'unrecognized';
}

/**
 * Shells `claude auth status --json` and narrows the result to only the fields
 * ever trusted/exposed here. `email`/`orgId`/`orgName` are deliberately dropped
 * on read — never forwarded to a caller, never logged (security review finding:
 * raw-stdout-to-log is a real habit elsewhere in this codebase; the fix is to
 * never let the raw payload exist past this function).
 *
 * Returns null for BOTH "no CLI" and "couldn't read a status out of it" — see
 * `readiness.ts`, which must not render the latter as a positive "not signed
 * in" claim (issue #107).
 */
export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus | null> {
  const bin = resolveClaudePath();
  if (!bin) return null;
  try {
    // Whatever bytes arrived inside the deadline — possibly empty, possibly a
    // truncated tail. `extractAuthStatusObject` is the only thing that decides
    // whether that is a status document.
    const p = extractAuthStatusObject(await readAuthStatusStdout(bin));
    if (!p) return null;
    return {
      // Strict `=== true`, not `!!` — a wrapper's `"loggedIn":"no"` or `:1` must
      // not truthy-coerce into a sign-in (attacker F5's neighbour).
      loggedIn: p.loggedIn === true,
      apiProvider: narrowStatusTag(p.apiProvider),
      subscriptionType: narrowStatusTag(p.subscriptionType),
    };
  } catch {
    return null;
  }
}

/**
 * Spawn + bounded read, kept in its own function so the `Bun.spawn` call stays
 * inline with its literal options — that is what gives `proc.stdout` its precise
 * `ReadableStream` type instead of the widened `number | ReadableStream | undefined`.
 *
 * Deliberately does NOT await `proc.exited`: a self-recursive wrapper's
 * descendants can outlive the kill, and this function's contract is that it
 * always resolves. The bounded read already has whatever bytes exist.
 */
async function readAuthStatusStdout(bin: string): Promise<string> {
  const proc = Bun.spawn([bin, 'auth', 'status', '--json'], {
    env: scrubAgentEnv(),
    windowsHide: true, // #141
    // A wrapper that prompts would otherwise block forever on a tty-less read.
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  try {
    return await readBounded(proc.stdout, AUTH_STATUS_SCAN_LIMIT, AUTH_STATUS_TIMEOUT_MS);
  } finally {
    // Best-effort reap on every path, including the deadline one. This kills the
    // DIRECT child only — an orphaned descendant tree is a known residual, but it
    // can no longer wedge the probe (see `readBounded`).
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
  }
}

/**
 * The fuller availability check backing `GET /_api/acp/status` — the ONE
 * signal the ChatPanel UI's connected/not-connected gate actually watches
 * (`probeStatus()` in ChatPanel.jsx). Adds a real sign-in check on top of
 * {@link probeAcpAvailability}'s cheap adapter+path probe.
 *
 * Security-review-grade bug found while building the T0f `acp-cold-start`
 * desktop-e2e scenario: `probeAcpAvailability()` alone reports `available:
 * true` the moment `claude` is INSTALLED, before the user has signed in —
 * exactly the "logged-out-but-installed reads as available" failure mode
 * T0d's own validation criteria calls out by name. Deliberately a SEPARATE
 * function rather than changing `probeAcpAvailability()` itself: that one
 * also backs the WS `onOpen` ready frame (cheap, no subprocess spawn on every
 * socket open) and has an existing test contract (`acp-bridge.test.ts`)
 * treating "a resolvable binary" as sufficient — this is the one call site
 * that needs the fuller, auth-checked answer.
 */
export async function probeAcpAvailabilityAuthed(): Promise<AcpAvailability> {
  const base = probeAcpAvailability();
  if (!base.available) return base;
  const authStatus = await getClaudeAuthStatus();
  if (!authStatus?.loggedIn) {
    return {
      ...base,
      available: false,
      // `base.available` is true here, so the CLI DID resolve — a null status
      // therefore means "we couldn't read it", not "signed out". Say so
      // (issue #107): telling a signed-in user they aren't is a claim they
      // have no way to act on, and it hides the real cause.
      reason:
        authStatus === null
          ? "Claude Code is installed, but Maude couldn't read its sign-in state — check Help ▸ Check AI editing readiness."
          : 'Claude Code is installed but not signed in — sign in to connect.',
    };
  }
  return base;
}
