// Shared Context object passed to each module's factory.
// Owns config + paths + a tiny pub-sub bus the modules use to talk without
// importing each other. Stateless beyond that — per-conn data lives on Bun's
// ws.data, per-request state on the Bun.serve context.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type ConfigSource = '.design/config.json' | 'defaults' | 'defaults (config invalid)';

export interface CanvasGroup {
  label: string;
  path: string;
}

export interface DesignSystemEntry {
  name: string;
  path: string;
  description?: string;
  tokensCssRel?: string;
  rootClass?: string;
  themeDefault?: 'dark' | 'light';
  themes?: string[];
  newCanvasDir?: string;
  newComponentDir?: string;
}

export interface LinkedHub {
  url: string;
  linkedAt: number;
  adopt?: boolean;
  /**
   * DDR-072 — project-level TSX sync opt-in. When true, EVERY `.tsx` canvas
   * syncs to this hub without a per-canvas `.meta.json "syncable": true`. A
   * per-canvas `"syncable": false` still excludes an individual canvas (the
   * sidecar always wins). Inert unless the cross-origin sandbox is active
   * (`MAUDE_CANVAS_ORIGIN_SPLIT != 0`) — the Lock-2 coupling from DDR-060 is
   * preserved. Only for hubs you operate or fully trust.
   */
  syncTsx?: boolean;
  /**
   * DDR-192 §5 — stable workspace identity for the hub document namespace
   * (`ws/<workspace-id>/<branch>/<slug>`). Authoritative when present; the
   * cloud control plane sets it at provisioning time. Absent, the sync runtime
   * derives it from the git `origin` remote — and if there is no origin either,
   * stays on legacy flat slugs rather than inventing a per-machine id that
   * would split peers of the same project apart. See sync/doc-name.ts.
   */
  workspaceId?: string;
  /**
   * Sync v2 — the journal-driven file plane (Plane B): the downward
   * project-file pull AND the widened upward sweep (stylesheets, docs, code
   * modules — classifier membership, see sync/file-membership.ts).
   *
   * **Default ON from Increment 4**, once its security gate closed. Set to
   * `false` per project to fall back to the pre-Sync-v2 reach (binary media
   * under `assets/` only) — a config key rather than a terminal command,
   * because the target user has no terminal (DDR-177). `MAUDE_SYNC_FILES=0`
   * forces it off for one session.
   *
   * The flag gates ONLY this plane — the canvas CRDT lanes and the DDR-217
   * asset lanes run regardless.
   */
  syncFiles?: boolean;
  /**
   * Sync v2 Increment 6 — does a deletion here become a deletion everywhere?
   *
   * **Default ON.** A hub-owned mirror that ignores deletes is not a mirror:
   * you remove a file, it comes back on the next pass, and the model the
   * product describes stops being true.
   *
   * What makes that safe is not caution but the breakers: past ten files, or a
   * quarter of what this machine tracks, in one pass, nothing is removed in
   * EITHER direction and the pass says what it was about to do — a branch
   * switch and a deliberate purge look identical until somebody confirms which
   * one it was. Losers are quarantined into `_trash/`, never unlinked, on both
   * ends. Set `false` per project to hold every absence instead.
   */
  propagateDeletes?: boolean;
  /**
   * How to settle a FIRST-ANCHOR hold, for the whole set at once.
   *
   * When a project is linked for the first time both sides usually have
   * content and neither has been reconciled here, so sync holds rather than
   * writing a conflict copy per file. `keep-local` pushes this machine's
   * copies up; `keep-cloud` takes the project's and parks yours beside them.
   * Absent means keep asking — the hold is not an error and waiting costs
   * nothing but time.
   */
  resolveFirstAnchor?: 'keep-local' | 'keep-cloud';
  /**
   * Sync v2 Increment 2 (DDR-226 §4) — the file-event control channel.
   *
   * Default ON where the hub advertises `ledger`; set to `false` to fall back
   * to exactly today's 20 s poll cadence. A CONFIG KEY rather than an env var
   * on purpose: this is the documented rollback for the poke, and the target
   * user has no terminal to set an env var in (DDR-177).
   *
   * Absence means ON. A committed `false` can only ever make sync SLOWER, so
   * unlike `syncTsx` it carries no trust weight and needs no restore-proof
   * absence-means-on gymnastics.
   */
  fileEvents?: boolean;
}

export interface DevServerConfig {
  name: string;
  projectLabel: string | null;
  designRoot: string;
  canvasGroups: CanvasGroup[];
  designSystems?: DesignSystemEntry[];
  defaultDesignSystem?: string;
  rootClass: string;
  themeDefault: 'dark' | 'light';
  tokensCssRel: string;
  teamAccentDefault: string | null;
  handoffTargets: unknown[];
  newCanvasDir: string;
  newComponentDir: string;
  linkedHub?: LinkedHub;
  /**
   * feature-ai-media-generation (DDR-16x) — BYOK generation preferences.
   * NON-SECRET ONLY: provider keys live in the OS keychain / ~/.config/maude/
   * keys.json (0600), NEVER here. Hot-reloadable via the full in-place cfg swap
   * in reloadConfig (only designRoot + linkedHub are boot-pinned). See
   * config.schema.json for the field contract.
   */
  generation?: GenerationConfig;
  _source: ConfigSource;
}

/** Non-secret AI-media generation preferences (DDR-16x). Keys are NOT here. */
export interface GenerationConfig {
  defaultImageProvider?: string;
  defaultModels?: Record<string, string>;
  preferLocalWhenAvailable?: boolean;
  providers?: Record<string, { enabled?: boolean; localEndpoint?: string }>;
}

const DEFAULT_CONFIG: Omit<DevServerConfig, '_source'> = {
  name: 'Design',
  projectLabel: null,
  designRoot: '.design',
  canvasGroups: [
    { label: 'Design system', path: 'system' },
    { label: 'Canvases', path: 'ui' },
  ],
  rootClass: 'app',
  themeDefault: 'dark',
  tokensCssRel: 'system/colors_and_type.css',
  teamAccentDefault: null,
  handoffTargets: [],
  newCanvasDir: 'ui',
  newComponentDir: 'ui/components',
};

export interface Paths {
  repoRoot: string;
  designRel: string;
  designRoot: string;
  serverInfoFile: string;
  activeFile: string;
  commentsDir: string;
  canvasStateDir: string;
  historyDir: string;
  tokensUrlRel: string;
  systemDirRel: string;
}

// Tiny pub-sub bus. Lazy — modules subscribe with on('selected', fn) and emit
// the matching event. Avoids cycling imports between inspect.ts <-> ws.ts.
/** Who an event is about, when that matters — Cloud Phase 27 D3. A `session`
 *  scopes a broadcast to one member of a cell; absent means everyone, which is
 *  every event this bus carried before and every event on a desktop. */
export interface BusMeta {
  session?: string;
}

export interface Bus {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous pubsub — subscribers annotate their own payload shape.
  on(evt: string, fn: (payload: any, meta?: BusMeta) => void): () => void;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous pubsub — emitters supply their own payload shape.
  emit(evt: string, payload?: any, meta?: BusMeta): void;
}

export function createBus(): Bus {
  // biome-ignore lint/suspicious/noExplicitAny: subscribers are typed at the call site; the bus stores the erased type.
  const subs = new Map<string, Set<(p: any, meta?: BusMeta) => void>>();
  return {
    on(evt, fn) {
      const set = subs.get(evt) ?? new Set();
      set.add(fn);
      subs.set(evt, set);
      return () => set.delete(fn);
    },
    emit(evt, payload, meta) {
      const set = subs.get(evt);
      if (!set) return;
      for (const fn of set) {
        try {
          fn(payload, meta);
        } catch (err) {
          console.error(`[bus] subscriber for ${evt} threw:`, err);
        }
      }
    },
  };
}

export interface Context {
  cfg: DevServerConfig;
  projectLabel: string;
  paths: Paths;
  bus: Bus;
  /**
   * T2 (9.1-A) — origin of the segregated canvas-content server (e.g.
   * `http://localhost:51234`), set by server.ts once the second listener binds.
   * The client reads it via /_config to build absolute, cross-origin iframe
   * URLs. Undefined in tests / before the canvas listener boots.
   */
  canvasOrigin?: string;
  /**
   * T2 (9.1-A) — origin of the MAIN dev-server listener (e.g.
   * `http://localhost:4399`), set by server.ts once the primary listener binds.
   * Used by `cspForCanvasShell` to allowlist the legit embedder in the canvas
   * origin's `frame-ancestors`. Undefined in tests / before boot.
   */
  mainOrigin?: string;
  /**
   * Phase 9.2 (DDR-064) — `MAUDE_SHARED_DOC` feature flag. When true, the
   * collab room's Y.Doc becomes the SINGLE shared doc per canvas: the
   * hub-facing HocuspocusProvider attaches to it directly (no second doc, no
   * disk-mediated reconcile). Default `false`/undefined = the proven two-doc
   * path = zero regression. Set by server.ts from the env; tests set it
   * directly on the Context they construct. Threaded through Phase A; the flag
   * gates behavior starting in Phase B.
   */
  sharedDoc?: boolean;
  /**
   * The live sync runtime's owner, set by server.ts once it exists. Present so
   * the cloud attach lane can START SYNCING the moment a person links a
   * project, instead of leaving them holding a "restart the studio server"
   * note with no button behind it. Structural type (not the SyncSupervisor
   * import) so context.ts stays free of the sync module graph — tests and the
   * non-serving entry points construct a Context without one.
   */
  syncControl?: {
    /** `null` means UNLINK: clear the in-memory link and cycle back to solo. */
    restart(linkedHub?: LinkedHub | null): Promise<{
      syncing: boolean;
      canvases: number;
      reason?: string;
      detail?: string;
    }>;
    /** A cycle is in flight — Resync refuses early rather than queueing. */
    busy?(): boolean;
    /** The live runtime, for the sweep-scoped cancel + the move protocol's
     *  retire step. Null in solo mode. Structural on purpose — see above. */
    current?(): {
      cancelAssetSweep(): boolean;
      retireForMove?(fromSlug: string, toRel: string): Promise<boolean>;
      /** Accepted-revisions mode (DDR-241) — see SyncRuntime.proposeLane. */
      proposeLane?(
        slug: string,
        lane: 'comments' | 'annotations' | 'meta',
        text: string,
        opts?: { baseText?: string; writeId?: string }
      ): Promise<{ status: 'accepted' | 'rejected'; code?: string }> | null;
      /** Accepted-revisions mode (DDR-241) — see SyncRuntime.proposeFolder. */
      proposeFolder?(
        op:
          | { op: 'dir.create'; path: string }
          | { op: 'dir.delete'; path: string }
          | { op: 'dir.move'; from: string; to: string }
      ): Promise<{ status: 'accepted' | 'rejected'; code?: string; queued?: boolean }> | null;
      acceptedMode?(): boolean;
      acceptedHistory?(q: {
        limit?: number;
        before?: number | null;
        path?: string | null;
      }): Promise<unknown[] | null>;
      acceptedVersion?(repoRel: string, revision: number): Promise<string | null>;
      acceptedRestore?(
        repoRel: string,
        revision: number
      ): Promise<{ status: 'accepted' | 'rejected'; code?: string; queued?: boolean } | null>;
      acceptedUndo?(
        actionId: string,
        redo?: boolean
      ): Promise<{ status: 'accepted' | 'rejected'; code?: string; queued?: boolean } | null>;
    } | null;
  };
}

function resolveRepoRoot(): string {
  const i = process.argv.indexOf('--root');
  if (i !== -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  return process.cwd();
}

function loadConfig(repoRoot: string): DevServerConfig {
  const configPath = path.join(repoRoot, '.design', 'config.json');
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    return normalizeConfig({ ...DEFAULT_CONFIG, _source: 'defaults' });
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeConfig({ ...DEFAULT_CONFIG, ...parsed, _source: '.design/config.json' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  warn: ${configPath} is not valid JSON: ${msg}. Using defaults.`);
    return normalizeConfig({ ...DEFAULT_CONFIG, _source: 'defaults (config invalid)' });
  }
}

/**
 * Fill in per-DS `tokensCssRel` defaults so the system view can read each DS's
 * tokens without forcing every config author to spell out the path. When an
 * entry omits `tokensCssRel`, derive it from `<entry.path>/colors_and_type.css`
 * — the scaffold layout `/design:setup-ds` produces. Also strips leading /
 * trailing slashes from `entry.path` so downstream `path.posix.join` calls
 * don't produce double-slash artifacts.
 *
 * The top-level `cfg.tokensCssRel` is preserved untouched as the
 * project-wide fallback for legacy single-DS configs that don't declare
 * `designSystems[]` at all.
 *
 * DDR-048: the system view renders user tokens only; this normalization is the
 * load-bearing step that makes per-DS rendering possible.
 */
export function normalizeDesignSystems<T extends DevServerConfig>(cfg: T): T {
  if (!cfg.designSystems?.length) return cfg;
  const designSystems = cfg.designSystems.map((entry) => {
    const p = entry.path.replace(/^\/+|\/+$/g, '');
    return {
      ...entry,
      path: p,
      tokensCssRel:
        entry.tokensCssRel?.replace(/^\/+/, '') ?? path.posix.join(p, 'colors_and_type.css'),
    };
  });
  return { ...cfg, designSystems };
}

/**
 * True when a config-declared relative path stays inside the design root once
 * joined to it. Rejects absolute paths and `..` escapes. Security clamp from
 * the DDR-149 fan-out review: `canvasGroups[].path` / `tokensCssRel` feed
 * directory walks (`/_index-data`) and a served stylesheet URL — a poisoned
 * (e.g. peer-committed) config must not walk or serve outside the design root,
 * and with hot-reload the escape would apply live, no restart gate.
 */
export function isContainedRel(rel: unknown): boolean {
  if (typeof rel !== 'string' || !rel) return false;
  const p = rel.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  const norm = path.posix.normalize(p);
  return norm !== '..' && !norm.startsWith('../');
}

function clampToDesignRoot(cfg: DevServerConfig): DevServerConfig {
  const groups = cfg.canvasGroups ?? [];
  const canvasGroups = groups.filter((g) => isContainedRel(g?.path));
  for (const g of groups) {
    if (!canvasGroups.includes(g)) {
      console.warn(`  warn: canvasGroups path escapes the design root — ignored: ${g?.path}`);
    }
  }
  let tokensCssRel = cfg.tokensCssRel;
  if (!isContainedRel(tokensCssRel)) {
    console.warn(`  warn: tokensCssRel escapes the design root — using default: ${tokensCssRel}`);
    tokensCssRel = DEFAULT_CONFIG.tokensCssRel;
  }
  const designSystems = cfg.designSystems?.filter((d) => {
    const ok =
      isContainedRel(d?.path) && (d?.tokensCssRel == null || isContainedRel(d.tokensCssRel));
    if (!ok)
      console.warn(`  warn: designSystems entry escapes the design root — ignored: ${d?.name}`);
    return ok;
  });
  return { ...cfg, canvasGroups, tokensCssRel, designSystems };
}

function normalizeConfig(cfg: DevServerConfig): DevServerConfig {
  return normalizeDesignSystems(clampToDesignRoot(cfg));
}

export function createContext(): Context {
  const repoRoot = resolveRepoRoot();

  // Fail loud if launched from a directory that has no .design/ — preserves the
  // load-bearing diagnostic from server.mjs: silent fallback to defaults masks
  // "wrong project root" bugs.
  if (!existsSync(path.join(repoRoot, '.design'))) {
    console.error(`  error: no .design/ directory at ${repoRoot}`);
    console.error('  Run from your project root, set $CLAUDE_PROJECT_DIR, or pass --root <path>.');
    process.exit(1);
  }

  const cfg = loadConfig(repoRoot);
  const designRel = cfg.designRoot.replace(/^\/+|\/+$/g, '');
  const designRoot = path.join(repoRoot, designRel);
  const systemDirRel = cfg.canvasGroups.find((g) => /system/i.test(g.path))?.path ?? 'system';

  return {
    cfg,
    projectLabel: cfg.projectLabel || `${cfg.name} Design`,
    paths: {
      repoRoot,
      designRel,
      designRoot,
      serverInfoFile: path.join(designRoot, '_server.json'),
      activeFile: path.join(designRoot, '_active.json'),
      commentsDir: path.join(designRoot, '_comments'),
      canvasStateDir: path.join(designRoot, '_canvas-state'),
      historyDir: path.join(designRoot, '_history'),
      tokensUrlRel: path.posix.join(designRel, cfg.tokensCssRel.replace(/^\/+/, '')),
      systemDirRel,
    },
    bus: createBus(),
  };
}

/**
 * Hot-reload `.design/config.json` into an existing Context. `/design:setup-ds`
 * (and any hand edit) rewrites the config mid-session; without this the server
 * keeps serving the boot snapshot — `/_index-data` never lists a newly added
 * canvas group, so scaffolded DS files stay invisible even on a manual tree
 * reload. RCA: .ai/logs/rca/issue-ds-scaffold-files-not-in-filetree-stale-config.md
 *
 * CONTRACT: `ctx.cfg` and `ctx.paths` are mutated IN PLACE — module factories
 * capture the object references (`const { cfg, paths } = ctx`) and must see the
 * fresh values through them. Never copy a cfg VALUE at construction time in a
 * long-lived module (that re-introduces the stale-config bug); read from the
 * shared object at use time instead.
 *
 * Deliberately NOT hot-reloadable: `designRoot` — the fs-watcher and every
 * runtime path hang off it; changing it requires a restart (warn + keep old).
 * A config.json that is missing or invalid mid-edit keeps the current cfg
 * (a running server must not downgrade to defaults on a half-written save).
 *
 * Returns true when the config actually changed.
 */
export function reloadConfig(ctx: Context): boolean {
  const next = loadConfig(ctx.paths.repoRoot);
  // Boot from defaults + config.json created later IS a legit reload; but a
  // file that vanished or fails to parse mid-edit must not clobber a working
  // cfg. loadConfig encodes both cases in _source.
  if (next._source !== '.design/config.json') {
    if (ctx.cfg._source === '.design/config.json') {
      console.warn(
        `  warn: config.json ${next._source === 'defaults' ? 'missing' : 'invalid'} on reload — keeping the running config.`
      );
    }
    return false;
  }

  const nextDesignRel = next.designRoot.replace(/^\/+|\/+$/g, '');
  if (nextDesignRel !== ctx.paths.designRel) {
    console.warn(
      `  warn: designRoot changed (${ctx.paths.designRel} → ${nextDesignRel}) — not hot-reloadable, restart the server to apply.`
    );
    next.designRoot = ctx.cfg.designRoot;
  }

  // linkedHub is boot-pinned like designRoot: the sync runtime captures it once
  // at startup (sync/index.ts), so a live swap would let use-time readers
  // (syncTsx gating) drift out of step with the hub the socket is actually
  // attached to — and a poisoned config must never re-point sync without a
  // restart (DDR-149 fan-out review).
  //
  // This is a rule about the FILE, and it stays. The one path that may change
  // the live link is `adoptLinkedHub` below: a person pressing Connect in
  // trusted app chrome, whose hub credential this same process just stored.
  // That path cycles the runtime itself (sync/supervisor.ts) instead of hoping
  // a watcher notices.
  if (JSON.stringify(next.linkedHub) !== JSON.stringify(ctx.cfg.linkedHub)) {
    console.warn('  warn: linkedHub changed — not hot-reloadable, restart the server to apply.');
    if (ctx.cfg.linkedHub === undefined) delete next.linkedHub;
    else next.linkedHub = ctx.cfg.linkedHub;
  }

  if (JSON.stringify(ctx.cfg) === JSON.stringify(next)) return false;

  // In-place swap so every captured `ctx.cfg` reference sees the new values.
  // INVARIANT: no `await` between the delete loop and the assign — the swap is
  // atomic only because it is synchronous; an interleaved request must never
  // observe a partially-emptied cfg.
  const cfg = ctx.cfg as unknown as Record<string, unknown>;
  for (const key of Object.keys(cfg)) delete cfg[key];
  Object.assign(cfg, next);

  ctx.projectLabel = ctx.cfg.projectLabel || `${ctx.cfg.name} Design`;
  ctx.paths.tokensUrlRel = path.posix.join(
    ctx.paths.designRel,
    ctx.cfg.tokensCssRel.replace(/^\/+/, '')
  );
  ctx.paths.systemDirRel =
    ctx.cfg.canvasGroups.find((g) => /system/i.test(g.path))?.path ?? 'system';
  return true;
}

/**
 * Adopt a link the person just authorized — the ONE way `cfg.linkedHub` may
 * change on a running server.
 *
 * The value is passed BY VALUE from the attach lane (cloud/endpoints.ts), which
 * exchanged it against the configured cloud address and stored the matching hub
 * credential moments earlier. It is deliberately NOT re-read from
 * `.design/config.json`: that file is committed, shared, and writable by
 * anything else on the machine, and re-reading it here would hand the
 * file-watcher's refused capability (reloadConfig above) back through a side
 * door. What the person consented to is what gets applied.
 *
 * Callers must cycle the sync runtime afterwards — `createSyncSupervisor`
 * (sync/supervisor.ts) does both in one step, and is the only intended caller.
 */
export function adoptLinkedHub(ctx: Context, linkedHub: LinkedHub): void {
  ctx.cfg.linkedHub = linkedHub;
}
