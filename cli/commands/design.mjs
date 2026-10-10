import { execSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from '../lib/argv.mjs';
import { outputViolation, violationMessage } from '../lib/confine-out.mjs';
import {
  runAdopt,
  runBulkDeletes,
  runDetach,
  runLink,
  runStatus,
  runUnlink,
} from '../lib/design-link.mjs';
import { writeGitignoreBlock } from '../lib/gitignore-block.mjs';
import { isCompiledBinary } from '../lib/pkg-root.mjs';
import { subVerbArgs } from '../lib/sub-verbs.mjs';

const SUBCOMMANDS = new Set([
  'serve',
  'init',
  'export',
  'link',
  'unlink',
  'detach',
  'status',
  'adopt',
  'bulk-deletes',
  'help',
  // V2-2.4b (contract V2-1.11 §5.3). In-process node verbs that talk to the studio: `open` shows a
  // canvas / artboard / element in the user's window (cli/lib/design-open.mjs). `hook` is the design
  // plugin's hook dispatcher (§5.4, cli/lib/design-hook.mjs): deny-only, fail-open, always exit 0.
  'open',
  'hook',
]);

// Dev-tooling verbs that dispatch to the dev-server's bundled bash helpers
// (Phase C / DDR-062). Plugin markdown invokes these via `maude design <verb>`
// rather than `bash "$CLAUDE_PLUGIN_ROOT/dev-server/bin/<verb>.sh"` — the
// marketplace never copies the dev-server beside a plugin, and CLAUDE_PLUGIN_ROOT
// is unreliable in a real run. `maude` resolves the helper from its OWN package
// root and sets CLAUDE_PLUGIN_ROOT authoritatively for the child. The whitelist
// (not arbitrary `<verb>.sh` exec) keeps this off the path-traversal surface.
const BIN_VERBS = new Set([
  'screenshot',
  'server-up',
  'prep',
  'slug',
  'bootstrap-check',
  'runtime-health',
  'smoke',
  'canvas-edit',
  'handoff',
  'asset-sweep',
  'visual-sanity',
  'draw-build',
  'draw-proof',
  'svg-optimize',
  'to-lottie',
  'read-annotations',
  'annotate',
  'canvas-rects',
  'chat-open',
  'ensure-browser',
  'fetch-asset',
  // DDR-167 (Phase 3 / T10). `import-asset` is the LOCAL-file sibling of the
  // URL-only `fetch-asset`: hardened SVG ingestion (allowlist DOM-sanitize +
  // a real-browser execution canary). PDF import is wired but not yet
  // available — see the DDR's addendum on why the planned rasterization
  // mechanism doesn't work under browser automation.
  'import-asset',
  // DDR-172 (Phase 3 / T11). `import-tokens` is the token-file sibling of
  // `import-asset`: parses W3C design-tokens / Style-Dictionary JSON or raw
  // CSS custom properties, maps recognized tokens onto the DS CSS-variable
  // contract, and patches (theme-block-scoped) or scaffolds the target
  // design system. CLI-only — no HTTP route, no in-app panel.
  'import-tokens',
  // DDR-216 (feature-figma-import, Phase 2 / T6). `import-figma` is the REST
  // door: pulls a real Figma/FigJam document over the API and translates it
  // with DETERMINISTIC code — no vision model, no agent anywhere in the
  // ingestion path. That is the structural difference from
  // `/design:import --reconstruct` (DDR-174), whose whole orchestrator/agent
  // split exists because an LLM reads its input; do not copy that architecture
  // into this one, it would close nothing here.
  'import-figma',
  // DDR-173 (Phase 3 / T12). `import-brand` extracts typed palette/font
  // cues + a hardened logo asset from an already-DDR-167-sanitized SVG for
  // `/design:setup-ds --from-brand` — never re-reads or re-sanitizes the
  // original brand file (Decision 2: no parallel, ungated read path).
  'import-brand',
  // feature-photo-editor (Stage G). `photo-adjust` is the thin non-browser
  // parametric verb (curl → /_api/photo-edit). `photo-bg-remove` is the
  // client-side @imgly ML harness (throwaway proof canvas + agent-browser
  // attribute poll — see photo-bg-remove.sh's header for why).
  'photo-adjust',
  'photo-bg-remove',
  // feature-footage-analysis-director. `ingest-footage` copies a folder of raw
  // clips into assets/ (content-addressed, magic-byte sniffed). `probe-footage`
  // decodes ONE clip in headless Chromium → keyframe PNGs for the footage-analyst's
  // vision pass. Neither boots the dev server (probe is server-independent — it
  // reads the clip as a file:// resource).
  'ingest-footage',
  'probe-footage',
  // feature-scene-aware-keyframes. `smart-frames` is the scene-AWARE sibling of
  // `probe-footage`: it selects keyframes at scene cuts + semantic action beats +
  // endpoints (three tiers, auto-detected — gemma scout / ffmpeg scene-detect /
  // blind Chromium floor) instead of a blind frame rate, and emits a SUPERSET of
  // probe-footage's manifest (drop-in for the footage-analyst). No dev server.
  // Owned by skill `footage-keyframes`; --engine auto self-detects deps so it
  // works standalone as a terminal video analyzer.
  'smart-frames',
  // feature-ai-media-generation (Phase 0, DDR-16x). `generate` is the thin
  // non-browser BYOK verb (curl → /_api/generate-jobs → poll → print the
  // produced /assets/<sha8>.<ext>). The provider call happens server-side (the
  // sidecar resolves the key from the keychain / ~/.config/maude/keys.json).
  'generate',
  // feature-ai-media-generation (Phase 2, DDR-164). `transcribe` is the local,
  // no-key subtitle verb: spawn whisper.cpp on an audio/video file → SRT/VTT via
  // the shared captions.ts reflow. No dev server; whisper.cpp is a SOFT dep with
  // ElevenLabs Scribe / Groq Whisper as the cloud fallback.
  'transcribe',
  // feature-ai-media-generation (Task 2.5, DDR-164). `audio-search` is the
  // reuse-before-you-pay verb: search the project's own generated audio + the
  // user's ElevenLabs history before spending credits on a new music/SFX/VO
  // track. Runs server-side (key resolved by the sidecar); needs a dev server.
  'audio-search',
  // DDR-185. `curl-local` is a loopback-only curl: resolves the request's
  // target host and refuses to invoke real curl at all unless every resolved
  // address is strictly loopback (127.0.0.0/8 or ::1). Exists so an ACP chat
  // session can auto-approve "check my local dev server" without widening the
  // session's Bash allow-list to unscoped curl (`Bash(curl:*)` would reach any
  // host — see DDR-185's rejected alternatives). No dev server dependency —
  // pure Node, no `<designRoot>` involvement.
  'curl-local',
  // V2-2.17. `index` reads the project index (canvases, artboards, kinds; search with accent /
  // word-order / one-typo folding) from the running studio, or builds the static index
  // in-process when none runs. Read-only — writes nothing.
  'index',
  // V2-2.15. `ds-check` is the design-system schema checker (contract V2-1.13 §5.8): system
  // levels 0 / 10 / 11, canvas S-rules (12), `--json`, `--cheatsheet`, `--hook`. Read-only unless
  // `--emit` (tokens.json) or `--fix=mechanical` (canvas autofixes; 13 = a refused write).
  'ds-check',
  // V2-2.15. `ds-upgrade` — the system-file steps of "bring a design system up to the schema"
  // (V2-1.13 §5.10): analyse / plan / validate (V1–V4, V8 → 13) / stage / apply. Never implicit.
  'ds-upgrade',
  // V2-2.4b (contract V2-1.11 §5.2/§5.3, V2-1.18 §5.3). `check` validates the files Claude writes,
  // by kind (canvas TSX, boards, meta, hand-offs…). Read-only; the PostToolUse hook runs it.
  'check',
  // V2-2.4b (§5.3). `place` finds a free spot next to an artboard/element; `layout-check` lints
  // overlapping artboards and clipped elements. Both read the canvas-rects manifest; read-only.
  'place',
  'layout-check',
  // feature-canvas-render-performance (Task 1 + 11). `perf` drives a scripted
  // pan/zoom against a live canvas and reports frame-time percentiles plus the
  // React render count during the gesture, delta'd against the previous run of
  // the same (canvas, engine) pair. It is a benchmark a human reads, never a CI
  // gate — headless frame timings swing with GPU load, so an absolute threshold
  // would go red for reasons unrelated to the code.
  'perf',
  // DDR-185 security addendum. `agent-browser-safe` replaces the bare
  // `Bash(agent-browser:*)` allow-list entry a security review found was a
  // zero-confirmation session-hijack primitive (agent-browser's own bundled
  // skill recommends a PERSISTENT authenticated Chrome profile). Closed
  // subcommand allow-list + forced domain scope + forced ephemeral profile —
  // see `_agent-browser-safe.mjs` for the full rationale. No dev server
  // dependency — pure Node.
  'agent-browser-safe',
]);

// Bin verbs that boot the dev-server (directly, or by shelling into server-up.sh).
// For these we resolve the compiled platform binary and hand its path to the
// helper via MAUDE_DEV_SERVER_BIN — see runBinDispatch + DDR-084.
const BOOT_VERBS = new Set(['server-up', 'visual-sanity', 'smoke']);

export async function run({ args, pkgRoot }) {
  const { positional } = parseArgs(args);
  const sub = positional[0];

  if (!sub || sub === 'help') {
    process.stdout.write(usage());
    return;
  }

  // Dev-tooling verbs dispatch to the bundled bash helpers (DDR-062). Checked
  // before SUBCOMMANDS so the whitelist owns the bin surface.
  if (BIN_VERBS.has(sub)) return runBinDispatch(sub, { args, pkgRoot });

  if (!SUBCOMMANDS.has(sub)) {
    process.stderr.write(`maude design: unknown subcommand "${sub}"\n${usage()}`);
    process.exit(2);
  }

  if (sub === 'serve') return runServe({ args, pkgRoot });
  if (sub === 'init') return runInit({ args, pkgRoot });
  if (sub === 'export') return runExport({ args });
  if (sub === 'link') return runLink({ args });
  if (sub === 'unlink') return runUnlink({ args });
  if (sub === 'detach') return runDetach({ args });
  if (sub === 'status') return runStatus({ args });
  if (sub === 'adopt') return runAdopt({ args });
  if (sub === 'bulk-deletes') return runBulkDeletes({ args });
  if (sub === 'open') {
    const { runOpen } = await import('../lib/design-open.mjs');
    process.exit(await runOpen({ words: args.slice(args.indexOf('open') + 1) }));
  }
  if (sub === 'hook') {
    const { runHookCli } = await import('../lib/design-hook.mjs');
    // the local `maude design check` fallback re-runs THIS maude (compiled binary or node + bin)
    const self = isCompiledBinary()
      ? [process.execPath]
      : [process.execPath, join(pkgRoot, 'cli', 'bin', 'maude.mjs')];
    process.exit(await runHookCli({ words: args.slice(args.indexOf('hook') + 1), self }));
  }
}

// Run a whitelisted dev-server bash helper, resolving it from maude's OWN
// package root (NOT $CLAUDE_PLUGIN_ROOT) and setting CLAUDE_PLUGIN_ROOT
// authoritatively for the child so the script's sibling-resolution still works
// (DDR-045 / DDR-062). `stdio: 'inherit'` so the helper's stdout/stderr/exit-code
// pass straight through — preserves `$(maude design slug …)` capture,
// `eval "$(maude design prep --shell-export …)"`, and non-zero gating idioms.
// maude writes nothing of its own on this path (no banner on stdout).
/** True if a `bun` executable is reachable on the given PATH string (POSIX). */
function bunOnPath(pathStr) {
  for (const dir of (pathStr || '').split(':')) {
    if (dir && existsSync(join(dir, 'bun'))) return true;
  }
  return false;
}

/** A bun-capable compiled binary to borrow as `bun` (RCA G3), or null.
 *  Prefer the dev-server binary the sidecar hands us, else our own compiled
 *  self (the `maude` CLI is `bun --compile`d too), else a resolvable server bin. */
function resolveBunnable(pkgRoot) {
  const dev = process.env.MAUDE_DEV_SERVER_BIN;
  if (dev && existsSync(dev)) return dev;
  if (isCompiledBinary()) return process.execPath;
  const server = resolveServerBinary({ pkgRoot });
  if (server && existsSync(server)) return server;
  return null;
}

/**
 * Ensure the design helpers' `command -v bun` / `exec bun run` resolve, even on a
 * machine with NO standalone `bun` (RCA G3 — the desktop `.app` and the npm
 * package ship compiled Bun BINARIES, never a `bun` CLI). The compiled binaries
 * ARE Bun: run with `BUN_BE_BUN=1` a `bun --compile` executable behaves as the
 * `bun` CLI. So if no real `bun` is on PATH, stage a tiny `bun` shim
 * (→ `BUN_BE_BUN=1 <compiled-binary> "$@"`) in a per-user cache dir (0700) and
 * PREPEND it to the child's PATH. No-op when a real `bun` is already present (dev)
 * or no compiled binary exists to borrow (pure-source dev without bun — where a
 * real `bun` is expected anyway). Returns the (possibly PATH-augmented) env.
 */
/** POSIX single-quote escape: wrap in '…' and encode embedded quotes as '\''.
 *  Neutralizes $, backticks, ${}, and every other sh metachar — unlike
 *  JSON.stringify, which leaves them live inside sh double-quotes. */
function shSingleQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * Provide a `bun` to a design helper that has none (RCA G3), then have the caller
 * REMOVE it after the spawn. Returns `{ env, shimDir }` — `shimDir` is a fresh
 * dir the caller must `rmSync` once the helper exits (null when no shim was made).
 *
 * Security (ethical-hacker review, DDR-177 addendum): the shim goes in a fresh,
 * unpredictable, owner-only `mkdtemp` dir created PER SPAWN and torn down right
 * after — NEVER a stable, guessable `~/.cache/maude/bun-shim/bun`. A stable path
 * on a child's PATH with an unqualified `bun` lookup is the exact PATH-shadow
 * primitive `sidecar.rs` deliberately refuses (Attacker-F4/DDR-168): an untrusted
 * SAME-UID actor (in scope per DDR-054 — a poisoned dependency in an opened
 * project, a prompt-injected agent's Bash tool) could pre-plant/symlink/race a
 * stable shim and hijack the interpreter of every future helper. A per-spawn
 * mkdtemp dir has no pre-existing entry to symlink-follow and no guessable name to
 * race, and is gone before the next spawn. Fails CLOSED with no HOME (never plants
 * an executable in world-writable /tmp).
 */
function ensureBunOnPath(childEnv, pkgRoot) {
  if (bunOnPath(childEnv.PATH)) return { env: childEnv, shimDir: null };
  const bunnable = resolveBunnable(pkgRoot);
  if (!bunnable) return { env: childEnv, shimDir: null }; // helper's own guard reports the miss
  const home = homedir();
  if (!home) return { env: childEnv, shimDir: null }; // fail closed — no /tmp fallback for an executable
  try {
    const cacheParent = join(home, '.cache', 'maude');
    mkdirSync(cacheParent, { recursive: true, mode: 0o700 });
    // Fresh + unpredictable + 0700, one per spawn. mkdtemp guarantees a brand-new
    // dir (fails if it exists), so there's nothing to symlink-follow on the write.
    const shimDir = mkdtempSync(join(cacheParent, 'bun-shim-'));
    const shim = join(shimDir, 'bun');
    // Single-quote the binary path (NOT JSON.stringify — that leaves $/backticks
    // live inside sh double-quotes, so a binary path with shell metacharacters
    // would run command substitution when the shim executes).
    writeFileSync(
      shim,
      `#!/bin/sh\n# maude bun shim (RCA G3) — the bundled compiled binary IS Bun;\n# BUN_BE_BUN=1 makes it act as the \`bun\` CLI so design helpers run with no\n# user-installed bun. Ephemeral: written per-spawn, removed after (design.mjs).\nBUN_BE_BUN=1 exec ${shSingleQuote(bunnable)} "$@"\n`,
      { mode: 0o755 }
    );
    chmodSync(shim, 0o755);
    return { env: { ...childEnv, PATH: `${shimDir}:${childEnv.PATH || ''}` }, shimDir };
  } catch {
    return { env: childEnv, shimDir: null }; // best-effort; the helper reports the miss
  }
}

function runBinDispatch(verb, { args, pkgRoot }) {
  if (!BIN_VERBS.has(verb)) {
    process.stderr.write(`maude design: "${verb}" is not a dev-tooling verb.\n${usage()}`);
    process.exit(2);
  }
  // CLAUDE_PLUGIN_ROOT stays the design *plugin* dir (plugins/design) — that's
  // its true meaning, and it remains 2 levels under pkgRoot so the helpers'
  // `$PLUGIN_ROOT/../../cli` side-channel + `$PLUGIN_ROOT/../..` pkg-root math
  // still resolve. The bin scripts themselves now live under apps/studio/bin
  // (DDR-095) and resolve the dev-server tree via $SCRIPT_DIR/.. regardless.
  const pluginRoot = join(pkgRoot, 'plugins', 'design');
  const script = join(pkgRoot, 'apps', 'studio', 'bin', `${verb}.sh`);
  if (!existsSync(script)) {
    process.stderr.write(
      `maude design ${verb}: helper not found at ${script}. Reinstall maude (the studio bin ships in the npm package).\n`
    );
    process.exit(1);
  }
  // A read-only step that is a flag gets a sub-verb (`ds-upgrade analyse <ds>`) so the AI chat can
  // auto-allow exactly it; a step flag after one is refused (lead c, cli/lib/sub-verbs.mjs).
  const sv = subVerbArgs(verb, args.slice(args.indexOf(verb) + 1)); // everything after the verb
  if (sv.error) {
    process.stderr.write(`${sv.error}\n`);
    process.exit(2);
  }
  const rest = sv.args;
  // V2-2.8 S4 (contract V2-1.11 §5.3): an output flag lands inside the project or the temp
  // dir, never anywhere else. Auto-tier verbs run without a prompt in the AI chat.
  const outside = outputViolation(rest);
  if (outside) {
    process.stderr.write(violationMessage(verb, outside));
    process.exit(2);
  }
  const childEnv = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot };
  // For verbs that boot the dev-server, resolve the compiled platform binary the
  // SAME way `maude design serve` does and hand the path down. The binary embeds
  // yjs + every runtime dep; `bun server.ts` from source does NOT (the deps live
  // in a nested package.json the npm tarball excludes), so on a production install
  // server.ts crashes at boot on `yjs`. server-up.sh prefers MAUDE_DEV_SERVER_BIN
  // when set; absent ⇒ dev tree ⇒ it falls back to `bun server.ts`. Helpers that
  // shell into server-up.sh (visual-sanity, smoke) inherit it. DDR-084.
  if (BOOT_VERBS.has(verb) && !process.env.MAUDE_DEV_SERVER_BIN) {
    const bin = resolveServerBinary({ pkgRoot });
    if (bin) childEnv.MAUDE_DEV_SERVER_BIN = bin;
  }
  // RCA G3 — make `bun` resolvable to the helper from the bundled compiled binary
  // when no standalone `bun` is installed (desktop / npm). No-op in dev. The shim
  // dir is ephemeral (per-spawn mkdtemp) — remove it as soon as the helper exits,
  // so nothing bun-named lingers on a guessable path (ethical-hacker review).
  const { env: finalEnv, shimDir } = ensureBunOnPath(childEnv, pkgRoot);
  const child = spawnSync('bash', [script, ...rest], {
    stdio: 'inherit',
    env: finalEnv,
  });
  if (shimDir) {
    try {
      rmSync(shimDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  if (child.error) {
    process.stderr.write(`maude design ${verb}: ${child.error.message}\n`);
    process.exit(1);
  }
  process.exit(child.status ?? 1); // pass-through exit code
}

function usage() {
  return `maude design <verb> [options]

Lifecycle:
  serve · init · export · link · adopt · detach · unlink · status · bulk-deletes

Studio (talk to the running Maude window — contract V2-1.11 §5.3):
  open <canvas>[#artboard][@element] [--mode edit|preview|present] [--select all|none|annotations]
        Show it in the user's Maude window. Exit 3 when no window shows this project.
  hook prompt|pre-edit|post-edit|stop
        The design plugin's Claude Code hooks (hook JSON on stdin). Deny-only, fail-open: exit 0.

Dev-tooling (dispatch to the dev-server bash helpers — DDR-062):
  screenshot · server-up · prep · slug · bootstrap-check · runtime-health
  smoke · canvas-edit · handoff · asset-sweep · visual-sanity · fetch-asset
  draw-build · draw-proof · svg-optimize · to-lottie · read-annotations · annotate
  canvas-rects · ingest-footage · probe-footage · smart-frames
  generate · transcribe · audio-search
        Invoke the bundled helper of the same name. maude resolves it from its
        own package root and sets CLAUDE_PLUGIN_ROOT for the child; stdout,
        stderr, and exit code pass straight through (so command-substitution
        capture and non-zero gating work unchanged). Args after the verb are
        forwarded verbatim, e.g.:
          maude design slug "Some Canvas Name"
          PORT=$(maude design server-up --root "$REPO")
          eval "$(maude design prep --shell-export --shape edit --root "$REPO")"
          maude design smoke --changed-only
          REF=$(maude design fetch-asset "$URL" --root "$REPO")   # download-first image
          maude design canvas-rects "ui/Foo.tsx"                  # geometry manifest (whiteboard toolkit)

  serve [--port N] [--root PATH]
        Start the design plugin's dev server in the current repo. Equivalent
        to 'maude studio' (top-level alias) or invoking 'claude-design-server'.
        Forwards all remaining args.

  init  [--name <slug>] [--ds <name>] [--force] [--dry-run]
        [--no-discovery | --discovery-payload <path>]
        Non-interactive scaffold helper. Writes Core files from the
        design-system-inspiration library into .design/ in the current repo.
        Refuses to run without --no-discovery or --discovery-payload (interactive
        bootstrap requires Claude Code: use /design:setup-ds <name> there).

        --no-discovery scaffolds Core only (~10 files) with default tokens.
        --discovery-payload <path> reads a JSON file with answers + tokens and
        scaffolds Core + the derived specimens deterministically (this is the
        path skill 'design-system' uses when shelling out from Claude Code).

  export <format> [--scope selection|artboard|canvas-as-separate|canvas-whole|selection-bounds|project-raw]
         [--port N] [--out <path>] [--option key=value ...]
        Drive the same POST /_api/export endpoint the UI uses. Auto-detects
        port from .design/_server.json; requires a running dev server. The
        response body is written to --out (a file path, or a folder to put
        the server-supplied filename in; default: current dir). Formats:
        png pdf svg html pptx canva zip mp4 webm gif.
        Default --scope: canvas-as-separate; artboard for mp4/webm/gif;
        project-raw for zip (the only scope zip serves).
        --option numbers arrive as numbers (scale=2, dpi=300, fps=30) and
        true/false as booleans; anything else is a string. PDF print options:
        marks=crop,registration (crop registration colorBars pageInfo) and
        includeBleed=true|false.

  link <url> --token <hex> [--adopt] [--force]
        Pair this clone with a Maude hub. Writes .design/config.json's
        linkedHub field (committed) plus the per-machine token to
        ~/.config/maude/hubs.json (NEVER committed). --adopt signals to the
        sync agent (Phase 9 Task 4) to push local state up unconditionally on
        first connect — use it when bootstrapping a hub from a populated repo.
        --force skips the /health reachability probe (e.g. behind a firewall
        + trusted URL).

  adopt <url> --token <hex>
        Alias of 'link --adopt'. Shipped as a discoverable subcommand so
        first-time bootstrap reads like 'git remote add' + 'git push -f'.

  detach [--yes] [--keep-token]
        Take .design/ back into this repo: unlink the hub and remove the
        hub-owned ignore, so git sees the folder again. Nothing is
        downloaded — the local mirror is already complete — and nothing
        is committed for you. The reverse of 'adopt' (DDR-228).

  unlink [--keep-token]
        Drop linkedHub from .design/config.json + remove the per-machine
        token (unless --keep-token). Repo returns to solo mode. Local
        .design/*.html etc. are untouched.

  status [--json]
        Print whether this repo is linked, the configured hub URL, when
        it was linked, and a live /health probe of the hub.
`;
}

async function runServe({ args, pkgRoot }) {
  const forwarded = args.slice(args.indexOf('serve') + 1);
  const fs = await import('node:fs');

  // Resolution order:
  //   1. Side-channel cache from postinstall (cli/.platform-binary-path).
  //   2. Lazy resolve of @1agh/maude-<slug>/maude (postinstall was skipped
  //      — Bun global, --ignore-scripts, Docker layer without scripts, etc.).
  //   3. (only in local dev tree) Bun + server.ts from source.
  //   4. Hard-fail with actionable hint.
  // Maintainers hacking on the dev-server source can force #3 with
  // MAUDE_FORCE_SOURCE=1.
  const forceSource = process.env.MAUDE_FORCE_SOURCE === '1';
  const sideChannel = resolve(pkgRoot, 'cli', '.platform-binary-path');
  let binPath = null;

  if (!forceSource) {
    try {
      if (fs.existsSync(sideChannel)) {
        const candidate = fs.readFileSync(sideChannel, 'utf8').trim();
        if (candidate && fs.existsSync(candidate)) binPath = candidate;
      }
    } catch {
      /* fall through to lazy resolve */
    }

    if (!binPath) {
      const resolved = lazyResolveBinary({ pkgRoot, fs });
      if (resolved.binPath) {
        binPath = resolved.binPath;
        // Cache for next invocation (best-effort — read-only fs is fine).
        try {
          fs.writeFileSync(sideChannel, binPath, 'utf8');
        } catch {
          /* read-only fs / no permission — non-fatal */
        }
      }
    }
  }

  if (binPath) {
    const child = spawn(binPath, forwarded, { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => process.exit(code ?? 0));
    child.on('error', (err) => {
      process.stderr.write(`maude design serve (binary ${binPath}): ${err.message}\n`);
      process.exit(1);
    });
    return;
  }

  // No binary found. Two possibilities:
  //   - Production install missing platform package — hard-fail with guidance.
  //   - Local dev tree (claude-design checkout) — fall through to source.
  const inDevTree = isLocalDevTree(pkgRoot, fs);

  if (!inDevTree && !forceSource) {
    const slug = detectPlatformSlug();
    const siblingHint = slug ? resolve(pkgRoot, '..', `maude-${slug}`) : '(unknown platform)';
    process.stderr.write(
      `maude design serve: platform binary not found.\n\n  Expected:  @1agh/maude-${slug || '<platform>'}/maude\n  Looked in: ${siblingHint}\n\nLikely causes:\n  • Installer skipped postinstall (Bun global, npm --ignore-scripts,\n    pnpm strict-scripts, Docker layer rebuilds).\n  • Optional dependency for your platform did not install.\n  • Global 'maude' is a leftover 'npm link' to a source checkout.\n\nFix (clean reinstall):\n  cd ~                          # NOT inside a maude source repo\n  npm uninstall -g @1agh/maude  # remove any stale link\n  npm i -g @1agh/maude          # real tarball install + postinstall\n\nOr re-run postinstall on the existing install:\n  npm rebuild -g @1agh/maude\n\nPlatform: ${process.platform}-${process.arch}\n`
    );
    process.exit(1);
  }

  // Local dev tree (or forced source). Verify deps before invoking source —
  // catches the npm/pnpm/oxc-parser native-binding bug (npm#4828) up front.
  const missing = checkDevDeps({ pkgRoot });
  if (missing.length) {
    process.stderr.write(
      `maude design serve: missing dev-server dependencies in local checkout.\n\n  Missing: ${missing.join(', ')}\n  Repo:    ${pkgRoot}\n\nThis repo uses pnpm (see packageManager in package.json). Install deps:\n  cd ${pkgRoot} && pnpm install\n\nIf you already ran 'npm install' here, the npm optional-deps bug\n(npm#4828) may have left native bindings broken. Reset first:\n  rm -rf node_modules package-lock.json && pnpm install\n`
    );
    process.exit(1);
  }

  const tsEntry = resolve(pkgRoot, 'apps', 'studio', 'server.ts');

  const hasBun = await new Promise((res) => {
    const probe = spawn('bun', ['--version'], { stdio: 'ignore' });
    probe.on('error', () => res(false));
    probe.on('exit', (code) => res(code === 0));
  });

  if (!hasBun) {
    // The pre-DDR-009 zero-dep Node server used to be the silent fallback here.
    // It was deleted (post-1.0 hardening, T0b): it served a years-stale feature
    // surface, so "works without bun" really meant "silently degrades to a
    // different product". Bun is authoritative (DDR-009) — refuse loud instead.
    process.stderr.write(
      `maude design serve: running from source requires bun (DDR-009 — the dev\nserver is Bun-authoritative; the old Node fallback served a stale feature\nsurface and was removed).\n\n  Install bun:  curl -fsSL https://bun.sh/install | bash\n  Or use the shipped platform binary instead of the source tree:\n    npm i -g @1agh/maude && maude design serve\n\nRepo: ${pkgRoot}\n`
    );
    process.exit(1);
  }

  const child = spawn('bun', ['run', tsEntry, ...forwarded], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    process.stderr.write(`maude design serve: ${err.message}\n`);
    process.exit(1);
  });
}

// Mirrors cli/install.cjs:detectSlug — kept in sync intentionally. Both forms
// run during the lifecycle of a single install (postinstall + first serve).
function detectPlatformSlug() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') {
    if (a === 'arm64') return 'darwin-arm64';
    try {
      const t = execSync('sysctl -n sysctl.proc_translated', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (t === '1') return 'darwin-arm64';
    } catch {
      /* not under Rosetta */
    }
    return 'darwin-x64';
  }
  if (p === 'linux') {
    let isMusl = false;
    try {
      const report = process.report?.getReport?.();
      isMusl = !report?.header?.glibcVersionRuntime;
    } catch {
      /* default to glibc */
    }
    if (a === 'arm64') return isMusl ? 'linux-arm64-musl' : 'linux-arm64';
    return isMusl ? 'linux-x64-musl' : 'linux-x64';
  }
  if (p === 'win32') return 'win32-x64';
  return null;
}

// Read-only resolution of the compiled platform binary the dev-server should
// boot as in a production install (it embeds yjs + every runtime dep). Mirrors
// runServe's order — side-channel cache (postinstall) → lazy resolve of the
// @1agh/maude-<slug> sibling/nested package — but performs NO caching and NEVER
// hard-fails: returns the path, or null when none is found. A null result means
// "fall back to `bun server.ts` from source" (correct in the local dev tree).
// Honors MAUDE_FORCE_SOURCE=1 so maintainers hacking on the dev-server source
// still boot their working copy. Used by runBinDispatch to hand the path to
// server-up.sh; runServe keeps its own inline copy (it also caches + hard-fails).
// Structural allowlist for a path we're about to spawn (DDR-084 hardening). The
// compiled binary is ALWAYS named `maude` / `maude.exe` inside a `maude-<slug>/`
// dir (the @1agh/maude-<slug> package, or the dev-tree `packages/maude-<slug>/`).
// The side-channel file's content is the one attacker-influenceable input in a
// shared-prefix / poisoned-clone layout — a path outside this shape is ignored
// (caller falls back to source), so the file can only DENY the binary, never
// redirect the spawn to an arbitrary executable. Paths `lazyResolveBinary`
// constructs always conform, so this never rejects a legit resolve.
export function isPlausiblePlatformBinary(p) {
  if (!p) return false;
  const b = basename(p);
  if (b !== 'maude' && b !== 'maude.exe') return false;
  return /^maude-[a-z0-9-]+$/.test(basename(dirname(p)));
}

export function resolveServerBinary({ pkgRoot }) {
  if (process.env.MAUDE_FORCE_SOURCE === '1') return null;
  // In the local source checkout, return null so server-up.sh boots
  // `bun server.ts` from source — the maintainer is editing the dev-server and
  // needs their working copy live, not a stale compiled binary that happens to
  // be installed via pnpm. A production install has no `packages/` dir, so this
  // never short-circuits there. (Preserves server-up's historic dev-tree
  // behavior — it always ran source before DDR-084.)
  if (isLocalDevTree(pkgRoot, { existsSync })) return null;
  const sideChannel = resolve(pkgRoot, 'cli', '.platform-binary-path');
  try {
    if (existsSync(sideChannel)) {
      const candidate = readFileSync(sideChannel, 'utf8').trim();
      // Existence AND the structural allowlist — a poisoned side-channel pointing
      // at an arbitrary executable is ignored (falls through to lazy resolve).
      if (candidate && existsSync(candidate) && isPlausiblePlatformBinary(candidate)) {
        return candidate;
      }
    }
  } catch {
    /* fall through to lazy resolve */
  }
  return lazyResolveBinary({ pkgRoot, fs: { existsSync, chmodSync } }).binPath;
}

function lazyResolveBinary({ pkgRoot, fs }) {
  const slug = detectPlatformSlug();
  if (!slug) return { binPath: null, slug: null };
  const filename = process.platform === 'win32' ? 'maude.exe' : 'maude';

  // Flat layout — production npm/bun global install. pkgRoot is
  // <node_modules>/@1agh/maude, sibling is <node_modules>/@1agh/maude-<slug>.
  const sibling = resolve(pkgRoot, '..', `maude-${slug}`, filename);
  if (fs.existsSync(sibling)) {
    try {
      fs.chmodSync(sibling, 0o755);
    } catch {
      /* read-only — ignore */
    }
    return { binPath: sibling, slug };
  }

  // Nested layout — pnpm with isolation, or dev tree's own node_modules.
  try {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve(`@1agh/maude-${slug}/package.json`, {
      paths: [pkgRoot, resolve(pkgRoot, 'cli')],
    });
    const fromManifest = resolve(dirname(manifest), filename);
    if (fs.existsSync(fromManifest)) {
      try {
        fs.chmodSync(fromManifest, 0o755);
      } catch {
        /* ignore */
      }
      return { binPath: fromManifest, slug };
    }
  } catch {
    /* platform package not installed */
  }

  return { binPath: null, slug };
}

// Mirrors cli/install.cjs:isLocalDev — the `packages/` directory is only present
// in the source checkout, never in a published npm tarball (excluded from
// package.json:files).
function isLocalDevTree(pkgRoot, fs) {
  return fs.existsSync(resolve(pkgRoot, 'packages', 'maude-darwin-arm64', 'package.json'));
}

function checkDevDeps({ pkgRoot }) {
  const require = createRequire(import.meta.url);
  // The dev-server source path imports these as bare specifiers. If they
  // resolve, bun/node will load them; if they don't, the spawn will fail
  // with a less actionable error.
  const required = ['magic-string', 'oxc-parser'];
  const missing = [];
  const paths = [resolve(pkgRoot, 'apps', 'studio'), resolve(pkgRoot)];
  for (const dep of required) {
    try {
      require.resolve(dep, { paths });
    } catch {
      missing.push(dep);
    }
  }
  return missing;
}

async function runExport({ args }) {
  // `maude design export <format> [--scope ...] [--port N] [--out <path>] [--option key=value]`
  const subArgs = args.slice(args.indexOf('export') + 1);
  const { positional, flags } = parseArgs(subArgs, {
    booleans: ['help'],
  });
  if (flags.help) {
    process.stdout.write(usage());
    return;
  }

  const format = positional[0];
  // Includes the temporal formats (DDR-148): mp4/webm/gif render through the
  // capture spine, same POST /_api/export the UI ⌘E dialog uses. Video export
  // is always artboard-scoped (the comp's registered meta drives fps/duration).
  const VALID_FORMATS = new Set([
    'png',
    'pdf',
    'svg',
    'html',
    'pptx',
    'canva',
    'zip',
    'mp4',
    'webm',
    'gif',
  ]);
  const VIDEO_FORMATS = new Set(['mp4', 'webm', 'gif']);
  if (!format || !VALID_FORMATS.has(format)) {
    process.stderr.write(
      `maude design export: missing or unknown <format>. Try one of: ${Array.from(VALID_FORMATS).join(', ')}\n`
    );
    process.exit(2);
  }

  // Each format defaults to a scope it can actually serve: video → artboard (the only scope video
  // supports — scope.ts resolves the artboard under the active canvas), zip → project-raw (the
  // only scope exporters/zip.ts serves; the default used to be canvas-as-separate, which the
  // server refuses for zip, so a bare `export zip` always failed). Everything else keeps
  // canvas-as-separate. An explicit --scope is sent as given — a bad pair is the server's refusal.
  const scope =
    flags.scope ??
    (VIDEO_FORMATS.has(format)
      ? 'artboard'
      : format === 'zip'
        ? 'project-raw'
        : 'canvas-as-separate');
  const VALID_SCOPES = new Set([
    'selection',
    'artboard',
    'canvas-as-separate',
    'canvas-whole',
    'selection-bounds',
    'project-raw',
  ]);
  if (!VALID_SCOPES.has(scope)) {
    process.stderr.write(`maude design export: unknown --scope "${scope}"\n`);
    process.exit(2);
  }

  // Resolve port: --port > .design/_server.json
  let port = flags.port ? Number(flags.port) : null;
  if (!port) {
    try {
      const raw = await readFile(resolve(process.cwd(), '.design', '_server.json'), 'utf8');
      port = JSON.parse(raw).port;
    } catch {
      /* no server.json — handled below */
    }
  }
  if (!port) {
    process.stderr.write(
      'maude design export: no --port given and .design/_server.json not found. Start the dev server first (`maude design serve`).\n'
    );
    process.exit(1);
  }

  // Collect `--option key=value` repeated flags into an object.
  const parsed = parseExportOptions(collectRepeatedFlag(subArgs, '--option'));
  if (parsed.error) {
    process.stderr.write(`maude design export: ${parsed.error}\n`);
    process.exit(2);
  }
  const options = parsed.options;

  const url = `http://localhost:${port}/_api/export`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format, scope, options }),
  });
  if (!r.ok) {
    const text = await r.text();
    process.stderr.write(`maude design export: server returned ${r.status}: ${text}\n`);
    process.exit(1);
  }

  const disp = r.headers.get('content-disposition') ?? '';
  // basename(): the name comes off a response header — never let it carry a path out of the target dir.
  const serverFilename = basename(/filename="([^"]+)"/.exec(disp)?.[1] ?? `export.${format}`);
  let outPath = flags.out
    ? resolve(process.cwd(), flags.out)
    : resolve(process.cwd(), serverFilename);
  // `--out ~/Downloads` (the form the export dialog prints) names a folder: the file goes inside it
  // under the server's filename, instead of failing with EISDIR.
  if (flags.out && (await stat(outPath).catch(() => null))?.isDirectory()) {
    outPath = join(outPath, serverFilename);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  await writeFile(outPath, bytes);
  process.stdout.write(`maude design export: wrote ${outPath} (${bytes.byteLength} bytes)\n`);
}

// The marks exporters/pdf.ts `MarksOptions` reads (`colorBars` / `pageInfo` are accepted by the
// exporter but not drawn yet — naming them here is still right, the exporter owns that gap).
const PDF_MARKS = ['crop', 'registration', 'colorBars', 'pageInfo'];

/** `true`/`false` → booleans; a string that IS a plain number (round-trips) → number; else as typed. */
function coerceOptionValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  // `String(n) === value` keeps "007", "1e3", "0x10", "2.50", "" and "000000" (a hex colour) as the
  // strings they were typed as; isFinite drops "NaN" / "Infinity".
  return Number.isFinite(n) && String(n) === value ? n : value;
}

/**
 * Turn repeated `--option key=value` items into the request's `options` bag.
 * Returns `{ options }`, or `{ error }` (a message without the command prefix).
 *
 * Print options do NOT go on the wire flat. exporters/pdf.ts reads them from one nested object,
 * `options.pdfPrint = { includeBleed, marks: { crop, registration, colorBars, pageInfo } }`
 * (`parsePdfPrintOptions`) and ignores a top-level `marks` / `includeBleed` — so a flat
 * `--option marks=crop` used to be dropped without a word. `dpi` / `pageFit` / `text` stay top-level.
 */
export function parseExportOptions(items) {
  const options = {};
  const pdfPrint = {};
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq < 0) return { error: `invalid --option "${item}" (expected key=value)` };
    const key = item.slice(0, eq);
    const value = item.slice(eq + 1);
    if (key === 'marks') {
      const names = value.split(',').map((n) => n.trim());
      const marks = {};
      for (const name of names) {
        if (!PDF_MARKS.includes(name)) {
          return {
            error: name
              ? `unknown mark "${name}" in --option marks=${value} (valid marks: ${PDF_MARKS.join(', ')})`
              : `empty mark name in --option marks=${value} (valid marks: ${PDF_MARKS.join(', ')})`,
          };
        }
        marks[name] = true;
      }
      pdfPrint.marks = { ...pdfPrint.marks, ...marks };
    } else if (key === 'includeBleed') {
      if (value !== 'true' && value !== 'false') {
        return { error: `invalid --option includeBleed=${value} (expected true or false)` };
      }
      pdfPrint.includeBleed = value === 'true';
    } else {
      options[key] = coerceOptionValue(value);
    }
  }
  if (Object.keys(pdfPrint).length > 0) options.pdfPrint = pdfPrint;
  return { options };
}

function collectRepeatedFlag(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1] !== undefined) {
      out.push(argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith(`${name}=`)) {
      out.push(argv[i].slice(name.length + 1));
    }
  }
  return out;
}

async function runInit({ args, pkgRoot }) {
  const subArgs = args.slice(args.indexOf('init') + 1);
  const { flags } = parseArgs(subArgs, {
    booleans: ['force', 'dry-run', 'help', 'no-discovery'],
  });

  if (flags.help) {
    process.stdout.write(usage());
    return;
  }

  const cwd = process.cwd();
  const designDir = resolve(cwd, '.design');
  const inspirationRoot = resolve(
    pkgRoot,
    'plugins',
    'design',
    'templates',
    'design-system-inspiration'
  );

  if (!(await pathExists(inspirationRoot))) {
    throw new Error(`inspiration library not found at ${inspirationRoot}. Reinstall maude.`);
  }

  if (!flags['no-discovery'] && !flags['discovery-payload']) {
    process.stderr.write(
      `maude design init: interactive bootstrap requires Claude Code.

  Inside Claude Code:
    /design:setup-ds <name>           — full discovery + scaffold (recommended)
    /design:init             — just prepare the env (no DS yet)

  From the CLI (non-interactive only):
    maude design init --no-discovery [--name <slug>]
        scaffold Core only with default tokens

    maude design init --discovery-payload <path>
        read JSON answers + tokens, scaffold Core + derived specimens
`
    );
    process.exit(2);
  }

  const dsName = (flags.ds || 'project').trim();
  if (!isValidSlug(dsName)) {
    throw new Error(`invalid --ds "${dsName}" (must match ^[a-z][a-z0-9-]*$)`);
  }
  const projectName = (flags.name || basename(cwd)).trim();
  if (!isValidName(projectName)) {
    throw new Error(`invalid --name "${projectName}" (must match [a-z0-9._-]+)`);
  }

  // Refuse to scaffold over an existing DS unless --force.
  const dsDir = resolve(designDir, 'system', dsName);
  if ((await pathExists(dsDir)) && !flags.force) {
    process.stderr.write(
      `maude design init: ${dsDir} already exists. Pass --force to overwrite, or use a different --ds.\n`
    );
    process.exit(2);
  }

  // Resolve the discovery payload.
  // The schema-v1 keys (27 functional roles, the icon map) default to the registry's own
  // derivations, so a payload written before V2-2.15 still renders valid CSS (DDR-043: no new
  // visual value — every default is built from the payload's other tokens).
  const payload = {
    ...schemaPayloadDefaults(pkgRoot),
    ...(flags['discovery-payload']
      ? await readPayload(flags['discovery-payload'])
      : defaultPayload({ projectName, dsName })),
  };

  process.stdout.write('maude design init\n');
  process.stdout.write(`  project name: ${projectName}\n`);
  process.stdout.write(`  ds name:      ${dsName}\n`);
  process.stdout.write(`  scaffold target: ${designDir}\n`);
  process.stdout.write(
    `  mode: ${flags['discovery-payload'] ? `--discovery-payload ${flags['discovery-payload']}` : '--no-discovery (Recommended defaults, Core only)'}\n`
  );
  if (flags['dry-run']) process.stdout.write('  mode: dry-run\n');
  if (flags.force) process.stdout.write('  mode: force (overwrites)\n');

  // Build explicit copy plan: [srcPath, destPath, transform?]
  const plan = buildCorePlan({ inspirationRoot, designDir, dsName });
  // withFileTypes + file filter: core/preview/ contains a `.archive` dir that
  // readFile would choke on with EISDIR.
  const previewEntries = await readdir(join(inspirationRoot, 'core', 'preview'), {
    withFileTypes: true,
  });
  for (const entry of previewEntries) {
    if (!entry.isFile()) continue;
    const f = entry.name;
    plan.push({
      src: resolve(inspirationRoot, 'core', 'preview', f),
      dest: resolve(designDir, 'system', dsName, 'preview', f),
      transform: f.endsWith('.tpl') ? 'placeholder' : null,
      stripTpl: f.endsWith('.tpl'),
    });
  }

  const stats = { created: [], replaced: [], skipped: [] };
  for (const item of plan) {
    let destPath = item.dest;
    if (item.stripTpl && destPath.endsWith('.tpl')) {
      destPath = destPath.slice(0, -4);
    }
    const exists = await pathExists(destPath);
    if (exists && !flags.force) {
      stats.skipped.push(rel(designDir, destPath));
      continue;
    }
    const contents = await readFile(item.src, 'utf8');
    const out =
      item.transform === 'placeholder' ? substitutePlaceholders(contents, payload) : contents;
    if (!flags['dry-run']) {
      await mkdir(resolve(destPath, '..'), { recursive: true });
      await writeFile(destPath, out);
    }
    if (exists) stats.replaced.push(rel(designDir, destPath));
    else stats.created.push(rel(designDir, destPath));
  }

  // Phase 9 Task 9 (DDR-056) — write the design-runtime .gitignore block so a
  // fresh project ignores per-machine runtime state (and stays correct if it
  // later links to a hub). Idempotent + skipped under --dry-run.
  if (!flags['dry-run']) {
    const { action } = writeGitignoreBlock(cwd, { designRel: '.design' });
    if (action !== 'unchanged') {
      process.stdout.write(`  .gitignore: ${action} maude design-runtime block\n`);
    }
  }

  printSummary(stats);
  printNextSteps({ dsName, payloadProvided: !!flags['discovery-payload'] });
}

function buildCorePlan({ inspirationRoot, designDir, dsName }) {
  const src = (p) => resolve(inspirationRoot, 'core', p);
  const dsRoot = resolve(designDir, 'system', dsName);
  return [
    {
      src: src('README.orchestration.md.tpl'),
      dest: resolve(designDir, 'README.md'),
      transform: 'placeholder',
    },
    { src: src('INDEX.md.tpl'), dest: resolve(designDir, 'INDEX.md'), transform: 'placeholder' },
    {
      src: src('config.json.tpl'),
      dest: resolve(designDir, 'config.json'),
      transform: 'placeholder',
    },
    {
      src: src('README.philosophy.md.tpl'),
      dest: resolve(dsRoot, 'README.md'),
      transform: 'placeholder',
    },
    { src: src('SKILL.md.tpl'), dest: resolve(dsRoot, 'SKILL.md'), transform: 'placeholder' },
    {
      src: src('colors_and_type.css.tpl'),
      dest: resolve(dsRoot, 'colors_and_type.css'),
      transform: 'placeholder',
    },
    {
      src: src('components.json.tpl'),
      dest: resolve(dsRoot, 'components.json'),
      transform: 'placeholder',
    },
  ];
}

function rel(root, p) {
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

function substitutePlaceholders(contents, payload) {
  let out = contents;
  for (const [key, value] of Object.entries(payload)) {
    const token = new RegExp(`\\{\\{${escapeReg(key)}\\}\\}`, 'g');
    out = out.replace(token, value);
  }
  return out;
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Payload defaults for the schema-v1 template keys, read from the shipped registry. */
function schemaPayloadDefaults(pkgRoot) {
  let reg;
  try {
    reg = JSON.parse(
      readFileSync(resolve(pkgRoot, 'apps/studio/schema/ds-schema-v1.json'), 'utf8')
    );
  } catch {
    return {};
  }
  const out = {};
  for (const r of reg.roles) {
    if (r.origin !== 'v1') continue;
    out[r.name.slice(2).replace(/-/g, '_')] = r.fallbackUnsupported ?? r.fallback;
  }
  // every vocabulary icon declared as a gap until the system draws it (decision v2-2.15-icon-null-declared-gap)
  out.icon_map_json = JSON.stringify(
    Object.fromEntries(reg.icons.vocabulary.map((n) => [n, null]))
  );
  return out;
}

function defaultPayload({ projectName, dsName }) {
  // `--no-discovery` mode emits a deliberately NEUTRAL skeleton:
  // achromatic grayscale, system fonts only, equal spacing/radii steps,
  // single accent set to neutral graphite. The intent is for the project
  // to immediately overwrite these with discovery-driven values via
  // `/design:setup-ds`. These are NOT a "recommended starter palette" —
  // they're an explicit placeholder that should look unfinished, so the
  // designer is nudged toward actual decisions (DDR-026, 2026-05-25).
  return {
    project_name: projectName,
    project_label: titleCase(projectName),
    ds_dirname: dsName,
    ds_skill_name: `${dsName}-design`,
    ds_description: `Default design system for ${projectName}.`,
    root_class: 'app',
    theme_default: 'light',
    theme_extra: '',
    handoff_targets: '[]',
    active_families: JSON.stringify(['accent']),
    active_families_csv: 'accent',
    active_families_block: '- **accent** — the single accent family used for primary actions.',
    purpose_one_liner: `${titleCase(projectName)} — design system.`,
    audience_summary: 'general',
    platforms_summary: 'desktop',
    platforms_first: 'desktop',
    platform_hard_rules: '',
    content_tone: 'direct-terse',
    mood_references_block: '_(not specified — extend during the next /design:setup-ds run)_',
    type_scale_summary: '8-step ladder, populated by discovery.',
    type_scale_summary_compact: '8-step (modular ratio)',
    voice_tone_block: 'Voice not declared yet — capture during /design:setup-ds.',
    voice_tone_summary: 'not-declared',
    iconography_summary: 'Icon family not declared yet — capture during /design:setup-ds.',
    hard_rules_from_system_readme: '_(see system/<ds>/README.md Hard rules section)_',
    hard_rules_block:
      '- WCAG 2.1 AA contrast\n- No off-token values in canvases\n- Real product strings only — no placeholder copy',
    iso_timestamp: new Date().toISOString(),
    // ─── Neutral-skeleton tokens (light theme grayscale, no chroma) ───
    bg_0: 'oklch(100% 0 0)',
    bg_1: 'oklch(97% 0 0)',
    bg_2: 'oklch(94% 0 0)',
    bg_3: 'oklch(90% 0 0)',
    bg_4: 'oklch(85% 0 0)',
    border_subtle: 'oklch(92% 0 0)',
    border_default: 'oklch(85% 0 0)',
    border_strong: 'oklch(70% 0 0)',
    border_strategy: 'fixed-token',
    fg_0: 'oklch(15% 0 0)',
    fg_1: 'oklch(35% 0 0)',
    fg_2: 'oklch(55% 0 0)',
    fg_3: 'oklch(75% 0 0)',
    aesthetic_ambition: 'restrained',
    accent_strategy: 'single',
    accent_strategy_summary: 'single accent — discovery has not been run',
    accent_block:
      '  --accent:        oklch(35% 0 0);\n  --accent-hover:  oklch(30% 0 0);\n  --accent-active: oklch(25% 0 0);\n  --accent-fg:     oklch(98% 0 0);',
    accent_rules_block:
      'Single accent family (`--accent`, `--accent-hover`, `--accent-active`, `--accent-fg`). Project has not run discovery yet — the accent is set to neutral graphite as a placeholder. Run `/design:setup-ds` to pick a real palette.',
    accent_rules_summary: 'Single family until discovery runs.',
    color_space: 'oklch',
    color_space_summary: 'OKLCH (default)',
    color_space_block:
      '**Color space:** OKLCH (default). Override via `config.colorSpace` if your project requires HSL, hex, or LAB.',
    status_success: 'oklch(55% 0 0)',
    status_warn: 'oklch(55% 0 0)',
    status_error: 'oklch(55% 0 0)',
    status_info: 'oklch(55% 0 0)',
    presence_online: 'var(--status-success)',
    presence_away: 'var(--status-warn)',
    presence_offline: 'var(--fg-3)',
    shadow_sm: 'none',
    shadow_md: 'none',
    shadow_lg: 'none',
    radius_xs: '0',
    radius_sm: '0',
    radius_md: '0',
    radius_lg: '0',
    radius_xl: '0',
    radius_pill: '999px',
    space_0: '0',
    space_1: '4px',
    space_2: '8px',
    space_3: '12px',
    space_4: '16px',
    space_5: '24px',
    space_6: '32px',
    space_7: '48px',
    space_8: '64px',
    font_display: 'system-ui, sans-serif',
    font_body: 'system-ui, sans-serif',
    font_mono: 'ui-monospace, monospace',
    type_xs: '12px',
    lh_xs: '16px',
    type_sm: '13px',
    lh_sm: '18px',
    type_base: '14px',
    lh_base: '20px',
    type_md: '16px',
    lh_md: '22px',
    type_lg: '18px',
    lh_lg: '26px',
    type_xl: '22px',
    lh_xl: '30px',
    type_2xl: '28px',
    lh_2xl: '36px',
    type_3xl: '36px',
    lh_3xl: '44px',
    dur_flip: '120ms',
    dur_panel: '200ms',
    dur_route: '240ms',
    dur_soft: '320ms',
    ease_out_curve: 'ease-out',
    ease_in_out_curve: 'ease-in-out',
    layout_max_w: '1200px',
    layout_gutter: 'var(--space-4)',
    touch_target_rule:
      '44×44 minimum on touch surfaces (iOS HIG); 48×48 if the primary platform is Android (Material). N/A on desktop-only systems.',
    // Empty-state template fields
    empty_subject: 'items',
    empty_supporting: "When you create your first one, it'll show up here.",
    empty_cta: 'Create',
  };
}

async function readPayload(p) {
  const abs = resolve(process.cwd(), p);
  try {
    const raw = await readFile(abs, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`could not read --discovery-payload ${abs}: ${err.message}`);
  }
}

function titleCase(s) {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function isValidName(s) {
  return /^[a-z0-9._-]+$/i.test(s);
}
function isValidSlug(s) {
  return /^[a-z][a-z0-9-]*$/.test(s);
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function printSummary({ created, replaced, skipped }) {
  process.stdout.write(`\n  ${created.length} created`);
  if (replaced.length) process.stdout.write(`, ${replaced.length} replaced`);
  if (skipped.length) process.stdout.write(`, ${skipped.length} skipped`);
  process.stdout.write('\n');
  if (process.env.MAUDE_DEBUG || process.env.MDCC_DEBUG) {
    for (const c of created) process.stdout.write(`    + ${c}\n`);
    for (const r of replaced) process.stdout.write(`    ~ ${r}\n`);
    for (const s of skipped) process.stdout.write(`    = ${s}\n`);
  }
}

function printNextSteps({ dsName, payloadProvided }) {
  process.stdout.write('\nNext steps:\n');
  if (!payloadProvided) {
    process.stdout.write(
      '  This is the Core-only scaffold (~10 files) using Recommended defaults.\n'
    );
    process.stdout.write('  For audience-specific specimens, use Claude Code:\n');
    process.stdout.write(`    cd ${process.cwd()} && claude\n`);
    process.stdout.write(
      `    /design:setup-ds ${dsName} "<one-line product brief>"   — full 8-question discovery\n`
    );
  } else {
    process.stdout.write('  Scaffold complete from --discovery-payload.\n');
  }
  process.stdout.write(
    `  Then: /design:edit "<feedback>" to iterate on a specimen, or /design:new "<Name>" "<brief>" --ds=${dsName} for a canvas.\n`
  );
  process.stdout.write('  Browse: maude design serve\n');
}
