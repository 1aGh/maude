// ACP session-scoped plugin auto-bootstrap (DDR-143; unconditional injection DDR-168).
//
// A Maude Desktop user with only Claude Code installed should get `/design:*`
// working in the chat panel with ZERO manual install — no `npm i`, no `/plugin
// marketplace add`, no `/reload-plugins`. (`/flow:*` auto-load is intentionally
// disabled for now — 2026-07-03 — the chat ships design-only; the plumbing below
// stays wired so restoring flow is a one-line change in computeSessionPlugins.)
// We achieve that by handing
// the ACP-spawned `claude` a session-scoped local plugin dir through the same
// `_meta` seam the bootstrap brief uses: `_meta.claudeCode.options.plugins`.
// The adapter spreads that into the SDK `query()` options (verified live —
// Task-1 spike: an injected local plugin's command appears in the session's
// `available_commands_update` with no install), and the SDK loads its commands/
// agents/skills/hooks for that session only. NOTHING is written to `~/.claude`,
// no package manager runs, no network is touched (DDR-126/128) — it's reversible
// and per-session by construction.
//
// Two gates must hold for a plugin to be injected:
//   1. NATIVE / BUNDLE context (guard #4, DDR-119/123). The web `maude design
//      serve` (npm) path ships no plugin manifest (DDR-044) and its users have a
//      terminal — never inject there. The signal is the manifest's presence on
//      disk (DESIGN_PLUGIN_DIR/FLOW_PLUGIN_DIR non-null), which is true ONLY in
//      the desktop Resources bundle or the dev tree; plus the desktop sidecar's
//      MAUDE_DEV_SERVER_ROOT as an explicit stricter marker.
//   2. BUNDLED FILES present — the per-plugin dir resolved (Task 2). Null on the
//      npm/web layout ⇒ skip that plugin.
//
// DDR-168 — the bundled copy is now injected UNCONDITIONALLY on every native
// session, regardless of whether the plugin is ALSO installed/enabled on disk
// (`~/.claude`). Every release ships an internally-consistent, release-matched
// CLI + plugin set — that's the copy this session should run, not whatever a
// power user happens to have lying around. This reverses this file's original
// DDR-143 Decision 3 ("no-op for power users, hard") on purpose. The double-
// registration risk that gate existed to prevent is now closed structurally,
// one level up: `bridge.ts`'s `newSessionParams()` sets `options.settings
// .enabledPlugins['design@maude'] = false` whenever it's carrying a non-empty
// `plugins` array, forcing off any natively-loaded user-level copy of the same
// id via the SDK's documented `flag > user` settings precedence — so the
// bundled copy injected here is the ONLY one that ever loads.

import { DESIGN_PLUGIN_DIR, FLOW_PLUGIN_DIR, KGAI_PLUGIN_DIR } from '../paths.ts';
import { readUiPrefs } from '../ui-prefs.ts';

/**
 * SDK plugin-load config (`@anthropic-ai/claude-agent-sdk` `SdkPluginConfig`).
 * Defined locally: that SDK is a TRANSITIVE dep (reached only through the
 * adapter), so we don't import its type surface directly. Shape pinned to
 * sdk.d.ts:3766 — an adapter/SDK bump that changes it is caught by the
 * presence-test in test/acp-session-plugins.test.ts.
 */
export interface SdkPluginConfig {
  type: 'local';
  path: string;
  /** The SDK host (this bridge) owns MCP connections — don't read the plugin's .mcp.json. */
  skipMcpDiscovery?: boolean;
}

export interface SessionPluginDeps {
  /** Desktop bundle or dev tree; false on the npm web-serve path (guard #4). */
  native: boolean;
  /** Bundled `design` plugin dir, or null (npm/web layout). */
  designDir: string | null;
  /** Bundled `flow` plugin dir, or null (npm/web layout). */
  flowDir: string | null;
  /** Bundled third-party `kgai` plugin dir, or null (only staged in the .app). */
  kgaiDir?: string | null;
}

/**
 * Pure resolver — returns the `SdkPluginConfig[]` to inject (possibly empty).
 * Exported for unit tests; the real wiring is {@link resolveSessionPlugins}.
 */
export function computeSessionPlugins(deps: SessionPluginDeps): SdkPluginConfig[] {
  if (!deps.native) return [];
  const out: SdkPluginConfig[] = [];
  const add = (dir: string | null): void => {
    // dir === null → not bundled in this layout (web/npm) → skip. Otherwise
    // inject unconditionally (DDR-168) — the double-registration risk of also
    // having a disk-installed copy is closed structurally in bridge.ts, not
    // by skipping injection here.
    if (dir) out.push({ type: 'local', path: dir, skipMcpDiscovery: true });
  };
  add(deps.designDir);
  // `/flow` auto-load is intentionally OFF for now (2026-07-03) — the chat ships
  // design-only. `deps.flowDir` stays resolved (harmless) so restoring it is a
  // one-liner: re-add `add(deps.flowDir)`.
  //
  // kgai (third-party, MIT) — injected so its `Stop` hook loads and autonomous
  // decision capture actually fires in the ACP panel. Without this the packaged
  // app captures NOTHING: the session is built with settingSources:['user']
  // (DDR-144) and a terminal-less DDR-177 user never marketplace-installs it.
  // Non-null only in the desktop bundle (sync-kg.mjs stages a pinned release).
  //
  // ⚠ DRIFT TRAP — adding an id here REQUIRES a matching `'<id>': false` entry in
  // bridge.ts's hand-maintained `enabledPlugins` suppression literal, or a user
  // who ALSO has it natively enabled gets it double-loaded (see that comment).
  add(deps.kgaiDir ?? null);
  return out;
}

/**
 * Native/bundle context — true in the packaged desktop app (sidecar sets
 * MAUDE_DEV_SERVER_ROOT, DDR-106) OR the dev tree (a bundled plugin manifest
 * resolves on disk, so the feature is dogfoodable without building the `.app`).
 * False on the npm `maude design serve` path: no MAUDE_DEV_SERVER_ROOT and no
 * staged manifest (DDR-044) ⇒ both plugin dirs null.
 *
 * `MAUDE_NO_PLUGIN_BOOTSTRAP=1` is a hard opt-out: it reverts to the DDR-128
 * detect-and-guide posture (no injection, the readiness `plugins` row shows the
 * manual marketplace remediation). For a power user who wants to force the manual
 * path, a locked-down deployment, or test isolation.
 *
 * S11.13 — Settings › Advanced › "Use my own plugin copy" (`prefs.json ownPluginCopy`) is the
 * same switch without a terminal: `ownPluginCopy === true` ≡ `MAUDE_NO_PLUGIN_BOOTSTRAP=1`, read
 * when the AI chat next starts. Only a session that edits the project on this Mac may set it
 * (http.ts `/_api/ui-prefs`, test/access-spawn-prefs.test.ts).
 */
export function isNativePluginContext(prefs: { ownPluginCopy?: boolean } = readUiPrefs()): boolean {
  if (process.env.MAUDE_NO_PLUGIN_BOOTSTRAP === '1') return false;
  if (prefs.ownPluginCopy === true) return false;
  return (
    !!process.env.MAUDE_DEV_SERVER_ROOT || DESIGN_PLUGIN_DIR !== null || FLOW_PLUGIN_DIR !== null
  );
}

/**
 * Resolve the session-scoped plugins to inject for a fresh ACP session. Wires
 * the real deps (native context, bundled dirs) into {@link computeSessionPlugins}.
 * Empty array ⇒ inject nothing (the web no-op). Recomputed per bridge
 * construction; stable across an adapter re-spawn because it's carried on the
 * bridge's readonly options. Does NOT consult `~/.claude`'s registry (DDR-168 —
 * the bundled copy always wins regardless of disk state); `readiness.ts` still
 * calls `scanPlugins()` independently for its own UI row.
 */
export function resolveSessionPlugins(): SdkPluginConfig[] {
  return computeSessionPlugins({
    native: isNativePluginContext(),
    designDir: DESIGN_PLUGIN_DIR,
    flowDir: FLOW_PLUGIN_DIR,
    kgaiDir: KGAI_PLUGIN_DIR,
  });
}
