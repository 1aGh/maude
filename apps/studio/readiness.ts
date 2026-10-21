// First-open AI-editing readiness probe (DDR-128). Backs `GET /_api/preflight`.
//
// Read-only: it reports which pieces of the AI-editing chain are present — the
// `claude` CLI, the `maude` CLI, the maude marketplace + plugins registered in the
// paired Claude Code, and the optional `agent-browser` — with per-item remediation.
// It NEVER installs, links, or mutates anything (DDR-128 detect-and-guide posture).
//
// PATH accuracy: in the packaged `.app` the sidecar's PATH is corrected at the Rust
// boundary (apps/desktop/.../sidecar.rs, DDR-128), so `Bun.which` is accurate here;
// `resolveOnPath` keeps a login-shell fallback as defense-in-depth for an unusual
// shell config the Rust resolution missed. Under `maude design serve` the terminal
// PATH is already correct.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getClaudeAuthStatus } from './acp/login-state.ts';
import { isNativePluginContext } from './acp/plugin-bootstrap.ts';
import { resolveAdapterEntry, resolveClaudePath } from './acp/probe.ts';
import { resolveBrowser } from './bin/_ensure-browser.mjs';
import { DESIGN_PLUGIN_DIR } from './paths.ts';

export type ReadinessStatus = 'present' | 'missing' | 'unknown';

export interface ReadinessItem {
  id: 'claude' | 'maude' | 'plugins' | 'agent-browser' | 'adapter';
  /** Short human label for the row. */
  label: string;
  /** Required items gate `ready`; optional ones never block it. */
  required: boolean;
  status: ReadinessStatus;
  /** One-line current-state description. */
  detail: string;
  /** Copy-paste-able fix, present only when the item is not satisfied. */
  remediation?: string;
  /** Verbatim shell command for a dedicated code-block + Copy affordance (DDR-166 T0c) — kept separate from the prose `remediation`. */
  installCommand?: string;
  /** UI action hint (DDR-166): 'install' renders a "Set up AI editing" button that runs the official installer then auto-chains to sign-in; 'signin' renders a "Sign in to Claude" button alone. */
  action?: 'install' | 'signin';
  /**
   * DDR-166 Decision 3 (binding — a security-review-mandated control, not
   * cosmetic): the resolved absolute path of the binary a Sign-in click is
   * about to spawn, shown BEFORE the button so a pre-existing PATH-hijacked
   * `claude` isn't invisible to the one human capable of noticing it's wrong.
   */
  resolvedPath?: string;
  /** True when `resolvedPath` is the binary Maude itself just installed (content-pinned — see probe.ts `setTrustedClaudeBin`), not something already on the user's PATH. */
  resolvedViaMaude?: boolean;
}

export interface ReadinessReport {
  /** True when every REQUIRED item is `present`. */
  ready: boolean;
  items: ReadinessItem[];
}

/**
 * Resolve a binary on PATH. `Bun.which` first (accurate once the sidecar PATH is
 * Rust-corrected, and always correct under a terminal launch); a login-shell
 * fallback recovers a binary the app env can't see when the Rust resolution missed.
 * Unix-only fallback (Windows GUI apps inherit the user PATH). Returns an absolute
 * path or null. `bin` is always a hardcoded literal — never user input.
 *
 * Async + `Bun.spawn` (not `spawnSync`): the fallback shells out for up to 5 s, so a
 * synchronous spawn would block the single-threaded dev-server event loop for the
 * whole probe — a real freeze on a fresh machine where the binary is missing
 * (DDR-128 hardening, ethical-hacker F1). Awaiting yields the loop; the 5 s kill
 * bounds a misconfigured rc.
 */
export async function resolveOnPath(bin: string): Promise<string | null> {
  const direct = Bun.which(bin);
  if (direct) return direct;
  if (process.platform === 'win32') return null;
  try {
    const shell = process.env.SHELL || '/bin/sh';
    const proc = Bun.spawn([shell, '-ilc', `command -v ${bin} 2>/dev/null`], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const killer = setTimeout(() => {
      try {
        proc.kill(9);
      } catch {
        /* already gone */
      }
    }, 5000);
    let out: string;
    try {
      out = await new Response(proc.stdout).text();
    } finally {
      clearTimeout(killer);
    }
    // Instant-prompt frameworks (powerlevel10k) can print to stdout on interactive
    // start, so take the last line that is an absolute path to a real file.
    const hit = out
      .split('\n')
      .map((l) => l.trim())
      .reverse()
      .find((l) => l.startsWith('/') && existsSync(l));
    return hit ?? null;
  } catch {
    return null;
  }
}

/** Claude Code's config dir — relocatable via `CLAUDE_CONFIG_DIR` (its own contract). */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

function readJson<T = unknown>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export interface PluginScan {
  /** 'unknown' when the registry couldn't be read (Claude Code's internal contract). */
  status: 'present' | 'unknown';
  marketplace: boolean;
  design: boolean;
  flow: boolean;
}

/**
 * Read-only scan of Claude Code's plugin registry for the maude marketplace
 * (`repo: 1aGh/maude`) and the `design@maude` / `flow@maude` plugins. `readFileSync`
 * follows symlinks (a dev's `~/.claude` is symlinked into Dotfiles). Never writes,
 * never throws — an unrecognized layout yields `status: 'unknown'`.
 *
 * A plugin counts as present if EITHER the marketplace registry
 * (`installed_plugins.json`) lists it OR the user enabled it in `settings.json`
 * `enabledPlugins` (`"<plugin>@<marketplace>": true`). The adapter spawns the
 * user's `claude` with `settingSources: ["user","project","local"]`, so a
 * settings-enabled plugin loads NATIVELY in the session — the ACP plugin
 * auto-bootstrap (DDR-143) must treat it as already-present and skip injection,
 * or the command set double-registers. Exported so `acp/plugin-bootstrap.ts`
 * reuses this single registry-scan instead of duplicating it.
 */
export function scanPlugins(): PluginScan {
  const dir = claudeConfigDir();
  const markets = readJson<Record<string, { source?: { repo?: string } }>>(
    join(dir, 'plugins', 'known_marketplaces.json')
  );
  const installed = readJson<{ plugins?: Record<string, unknown> }>(
    join(dir, 'plugins', 'installed_plugins.json')
  );
  // `settingSources:user` — a plugin the user enabled in ~/.claude/settings.json
  // loads natively even if it's not in installed_plugins.json (DDR-143 no-op gate).
  const settings = readJson<{ enabledPlugins?: Record<string, unknown> }>(
    join(dir, 'settings.json')
  );
  if (!markets && !installed && !settings) {
    return { status: 'unknown', marketplace: false, design: false, flow: false };
  }
  const marketplace =
    !!markets &&
    Object.values(markets).some(
      (m) => String(m?.source?.repo ?? '').toLowerCase() === '1agh/maude'
    );
  const plugins = installed?.plugins ?? {};
  const enabled = settings?.enabledPlugins ?? {};
  const has = (key: string): boolean => {
    const v = plugins[key];
    const installedHit = Array.isArray(v) ? v.length > 0 : !!v;
    return installedHit || enabled[key] === true;
  };
  return { status: 'present', marketplace, design: has('design@maude'), flow: has('flow@maude') };
}

/**
 * Side-effect-free readiness report. The three binary probes run concurrently so a
 * fresh machine (where the login-shell fallback fires) resolves in ~one shell round
 * trip, not three sequential ones. The backing route gates cross-origin callers
 * (DDR-128 hardening) so this can't be turned into a spawn-storm from a drive-by page.
 */
export async function probeReadiness(): Promise<ReadinessReport> {
  let [claude, maude, agentBrowser] = await Promise.all([
    (async () => resolveClaudePath() ?? (await resolveOnPath('claude')))(),
    resolveOnPath('maude'),
    resolveOnPath('agent-browser'),
  ]);

  // Deterministic E2E stub for the two claude-readiness states that are
  // otherwise near-impossible to reproduce on a real, already-set-up dev
  // machine (mirrors MAUDE_E2E_FAKE_GITHUB_LOGIN in oauth.rs — same problem,
  // same shape of fix: a real state that needs a pristine/logged-out machine
  // to occur naturally gets a narrow, explicitly-named override instead of a
  // hand-rolled sandbox that fights the OS's own PATH resolution). Never
  // affects real users — unset in every normal launch.
  const e2eForce = process.env.MAUDE_E2E_FORCE_CLAUDE_STATUS;
  // A verified, explicitly-provisioned MAUDE_CLAUDE_BIN override (T0c's
  // install flow, once its freshness+hash check passes) must never be
  // clobbered back to "missing"/"signed-out" by this coarser stub — mirrors
  // the same precedence fix in probe.ts's resolveClaudePath(). Without this,
  // the acp-cold-start scenario could never observe its OWN install actually
  // taking effect after starting from a forced-missing state.
  const hasVerifiedOverride =
    !!process.env.MAUDE_CLAUDE_BIN && claude === process.env.MAUDE_CLAUDE_BIN;
  if (e2eForce === 'missing' && !hasVerifiedOverride) claude = null;
  else if (e2eForce === 'signed-out' && !hasVerifiedOverride) claude = claude || '/usr/bin/claude'; // present, but auth probe below is also stubbed

  const items: ReadinessItem[] = [];

  // DDR-166 T0d — honest 3-state instead of presence-only: not installed (an
  // "install" action, T0c — runs the same verbatim official one-liner a user
  // would type themselves, live-verified 2026-07-13 against
  // code.claude.com/docs/en/quickstart.md; the copy-paste command below stays
  // as the fallback/opt-out path) / installed-but-signed-out (a "Sign in"
  // action, T0d) / signed-in-on-subscription.
  const authStatus =
    e2eForce === 'signed-out' ? { loggedIn: false } : claude ? await getClaudeAuthStatus() : null;
  const signedIn = !!authStatus?.loggedIn;
  // Issue #107 — a resolvable CLI whose auth status we could not READ is NOT
  // the same as a signed-out one, and must not be reported as one. Claiming
  // "not signed in" to a user who is signed in is a false accusation they
  // can't argue with, and it routes them to a Sign-in button that can only
  // dead-end (the poll re-runs the same failing probe until it times out).
  // The probe's own tolerance for wrapper stdout noise now lives in probe.ts;
  // this is the honest fallback for whatever noise that still can't read.
  const authUnreadable = !!claude && e2eForce !== 'signed-out' && authStatus === null;
  // Anything that is not an explicit `firstParty` counts as off-subscription,
  // ABSENT included (attacker R2-3). The old `authStatus?.apiProvider &&`
  // truthiness guard meant a metered user could suppress DDR-123's billing
  // warning by OMITTING the field rather than forging `firstParty` — the exact
  // outcome `narrowStatusTag`'s sentinel was written to prevent, reached through
  // a different input shape. Over-warning is the safe direction here.
  const offSubscription = signedIn && authStatus?.apiProvider !== 'firstParty';
  const providerLabel = authStatus?.apiProvider ?? 'provider not reported';
  // DDR-166 Decision 5 — the settings-UI opt-out (prefs.rs `claude_auto_setup`,
  // DEFAULT ON) reaches the dev-server as an env var set fresh at each sidecar
  // spawn. Disabled → fall back to guide-only: no automated action offered,
  // same posture as before T0c/T0d existed (still shows the copy-paste
  // command below, just no button).
  const autoSetupEnabled = process.env.MAUDE_CLAUDE_AUTOSETUP_ENABLED !== '0';
  items.push({
    id: 'claude',
    label: 'Claude Code',
    required: true,
    status: claude && signedIn ? 'present' : authUnreadable ? 'unknown' : 'missing',
    detail: !claude
      ? 'Not found on PATH.'
      : signedIn
        ? offSubscription
          ? `Signed in, but not on a Claude subscription (${providerLabel}) — AI editing may bill metered API usage.`
          : `Signed in${authStatus?.subscriptionType ? ` · ${authStatus.subscriptionType}` : ''} — AI editing runs on your own Pro/Max subscription.`
        : authUnreadable
          ? "Installed, but Maude couldn't read its sign-in state."
          : 'Installed, but not signed in.',
    remediation: !claude
      ? 'Install Claude Code, then sign in. AI editing runs on your own Pro/Max subscription — never API billing.'
      : signedIn
        ? undefined
        : authUnreadable
          ? // Deliberately does NOT interpolate the resolved path (attacker
            // R2-2). This row carries a Copy affordance, and `copyFix` strips
            // the backticks — so a path containing shell metacharacters would
            // land on the clipboard inside a sentence the user is being told to
            // paste. Worse, it would turn the possibly-hijacked binary that
            // DDR-166 Decision 3 shows them precisely so they can DOUBT it into
            // an instruction to run it. The path renders on its own line below.
            'Maude ran `claude auth status --json` and could not read a status back. The usual cause is a version-manager shim or wrapper (mise, asdf, volta) fronting the real binary — check the path below, fix or quiet the wrapper, then Re-check.'
          : 'Sign in to connect it to your Pro/Max subscription.',
    installCommand: !claude ? 'curl -fsSL https://claude.ai/install.sh | bash' : undefined,
    // No Sign-in button when the status is unreadable: `pollForSignin` in
    // ReadinessList.jsx polls THIS probe, so a button whose success signal we
    // can't read can only ever end in "Sign-in timed out" (issue #107). The
    // remediation text above is the actionable path in that state.
    action: !autoSetupEnabled
      ? undefined
      : !claude
        ? 'install'
        : !signedIn && !authUnreadable
          ? 'signin'
          : undefined,
    resolvedPath: claude ?? undefined,
    resolvedViaMaude: !!claude && claude === process.env.MAUDE_CLAUDE_BIN,
  });

  // DDR-166 T0b / DDR-168 — `maude` is bundled into the packaged app (compiled
  // via apps/desktop/scripts/build-cli-binary.mjs, shipped as `externalBin`
  // `binaries/maude`; sidecar.rs stages it into its own narrow, single-binary
  // PATH directory, PREPENDS that directory ahead of the rest of PATH, and sets
  // MAUDE_BUNDLED_CLI_PATH to that exact path). Prepending makes this
  // deterministic, not a best-effort fallback: inside the sidecar's own spawned
  // children the bundled copy always wins PATH resolution, so `maude === bundledCliPath`
  // is the normal case on the desktop path, not merely one possible outcome. This
  // row disappears entirely for the end user rather than surfacing an
  // `npm i -g` instruction for something already shipped — it's an internal
  // plumbing detail, not a recognizable capability like the agent-browser/
  // adapter rows below. In dev contexts where the bundling step hasn't run
  // (a bare `bun run server.ts`, `maude design serve`), MAUDE_BUNDLED_CLI_PATH
  // is unset and this falls through to the pre-T0b behavior unchanged.
  const bundledCliPath = process.env.MAUDE_BUNDLED_CLI_PATH || null;
  const maudeIsBundled = !!bundledCliPath && maude === bundledCliPath;
  if (!maudeIsBundled) {
    items.push({
      id: 'maude',
      label: 'maude CLI',
      required: true,
      status: maude ? 'present' : 'missing',
      detail: maude ? 'On PATH — `/design:edit` can reach its helpers.' : 'Not found on PATH.',
      remediation: maude
        ? undefined
        : 'Install it: `npm i -g @1agh/maude`. `/design:edit` shells out to `maude design …`, so it must be on PATH.',
    });
  }

  const scan = scanPlugins();
  // DDR-143 — on the native/desktop path the ACP chat session AUTO-LOADS the
  // bundled `design` plugin (acp/plugin-bootstrap.ts → session-scoped
  // `_meta.claudeCode.options.plugins`), so a design plugin that isn't
  // marketplace-installed is still available in the chat. Count that as
  // satisfied: the check collapses from a red install-wall to green. `/flow` is
  // intentionally NOT part of the chat for now (2026-07-03), so the gate tracks
  // `design` alone — demanding a plugin the chat doesn't use would be a false red.
  // The web `maude design serve` path ships no bundle (native=false, dir null) →
  // the manual marketplace remediation still shows there.
  //
  // DDR-168 — `designAutoloaded` no longer requires `!scan.design`: the bundled
  // copy is injected unconditionally now (plugin-bootstrap.ts), regardless of
  // whether a marketplace copy is ALSO installed at the user level (the
  // double-registration risk that used to gate this is closed structurally in
  // bridge.ts's `options.settings.enabledPlugins` override instead). So this row
  // reads "auto-loaded" even on a machine that separately has design@maude
  // installed — that's the whole point: the bundled, release-matched copy is
  // what actually runs in the chat, so the UI should say so rather than imply
  // "ready because you already had it."
  const native = isNativePluginContext();
  const designAutoloaded = native && DESIGN_PLUGIN_DIR !== null;
  const designReady = scan.design || designAutoloaded;
  const pluginStatus: ReadinessStatus = designReady
    ? 'present'
    : scan.status === 'unknown'
      ? 'unknown'
      : 'missing';
  items.push({
    id: 'plugins',
    label: 'Maude design plugin in Claude Code',
    required: true,
    status: pluginStatus,
    detail: designReady
      ? designAutoloaded
        ? 'Bundled with this app — loads automatically in the chat session.'
        : 'design@maude is installed.'
      : scan.status === 'unknown'
        ? "Couldn't read Claude Code's plugin registry — check it manually."
        : `Missing: design@maude${scan.marketplace ? '' : ' (and the maude marketplace)'}.`,
    remediation: designReady
      ? undefined
      : 'In Claude Code: `/plugin marketplace add 1aGh/maude`, then `/plugin install design@maude`.',
  });

  // agent-browser + a headless Chromium capture artboards so `/design:*` critics
  // can SEE the work — effectively required for the full design workflow. On the
  // native/desktop path agent-browser is BUNDLED (externalBin, DDR — bundled
  // screenshots) and the browser engine is resolved (or provisioned as
  // chrome-headless-shell on first use) by ensure-browser, so it's a first-class,
  // satisfied capability — not a red "optional install" wall. On web/CLI it stays
  // optional (the user brings agent-browser or playwright).
  let browserReady = false;
  if (native) {
    try {
      browserReady = !!(await resolveBrowser({ download: false })).path;
    } catch {
      /* best-effort — the browser provisions at screenshot time regardless */
    }
  }
  items.push({
    id: 'agent-browser',
    label: native ? 'Screenshot engine (design critics)' : 'agent-browser (optional)',
    required: native,
    status: native || agentBrowser ? 'present' : 'missing',
    detail: native
      ? browserReady
        ? 'Bundled — artboard screenshots for `/design:*` critics are ready.'
        : 'Bundled — the browser engine downloads on your first screenshot (~94 MB, one-time).'
      : agentBrowser
        ? 'Installed — screenshot evidence during edits.'
        : 'Optional — richer screenshot evidence during edits.',
    remediation:
      native || agentBrowser
        ? undefined
        : 'Optional. Install `agent-browser` for screenshot evidence during `/design:edit`.',
  });

  // The chat bridge itself: the adapter must be resolvable on disk. This is what
  // actually gates the chat panel (probeAcpAvailability → resolveAdapterEntry),
  // distinct from the user-environment checks above. Shown so a build that ships
  // without the staged adapter closure surfaces here instead of leaving every
  // other row green while chat reports "bridge is not installed" (the v0.31–0.32
  // desktop bug; see apps/desktop/scripts/stage-resources.mjs).
  const adapter = resolveAdapterEntry();
  items.push({
    id: 'adapter',
    label: 'Claude agent bridge',
    required: true,
    status: adapter ? 'present' : 'missing',
    detail: adapter ? 'Bundled — the chat panel can spawn it.' : 'Not bundled in this build.',
    remediation: adapter
      ? undefined
      : 'The Claude agent bridge is missing from this build — reinstall or update Maude. If you built it yourself, ensure the desktop staging step bundled `@agentclientprotocol/claude-agent-acp`.',
  });

  const ready = items.filter((i) => i.required).every((i) => i.status === 'present');
  return { ready, items };
}
