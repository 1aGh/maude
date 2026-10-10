// Workspace mode + the containment invariant's first enforcement point.
//
// DDR-193 stated the invariant, and Cloud Phase 25 A0 amended what a cell does
// under it. The current wording (DDR-209 A′1) is:
//
//   > No tenant-authored TSX is ever EVALUATED by vendor-operated compute.
//   > A cell syncs, keeps git history, stores assets, and BUILDS a member's own
//   > canvas in a bounded sandbox. The member's browser is what evaluates.
//   > Nothing here renders, and no browser enters the image.
//
// and states how it is kept: "enforced, not asserted — a boot-assert in the cell
// image plus a CI grep gate." This module is the boot-assert. The grep gate is
// `scripts/check-containment.sh`.
//
// THE TEST IS EVALUATION, NOT THE SERVING OF BYTES. That distinction is the
// whole of DDR-209 A′1, and it is load-bearing in both directions. It still
// catches the thumbnail endpoint someone adds in 2027 (which would evaluate). It
// stops mis-catching a static HTML harness with a strict CSP (which does not) —
// and mis-catching it is what forced Phase 25 to hand-roll a second, poorer
// studio rather than serve the real one.
//
// WHY A BOOT-ASSERT AND NOT A CODE REVIEW RULE. Every canvas is code the tenant
// wrote. The moment vendor compute evaluates it, an anonymous signup has
// arbitrary code execution inside our perimeter, next to other tenants' designs
// and the control plane's credentials. A convention protects that for exactly as
// long as everyone remembers it; a process that refuses to start does not
// forget.
//
// It fails CLOSED and LOUD: the cell refuses to boot, naming the exact surfaces
// that broke it. A cell that will not start is a page; a cell that quietly
// renders tenant code is an incident.

/** True when this process is a vendor-operated workspace cell. */
export function isWorkspaceMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MAUDE_WORKSPACE_MODE === '1';
}

/**
 * Where an export gets rendered — the one question every export surface asks.
 *
 *   `local`   this process spawns the capture browser (desktop / plain server;
 *             pre-render-worker behavior, unchanged).
 *   `remote`  a workspace cell with a render service configured: browser-needing
 *             formats are dispatched to `MAUDE_RENDER_URL` as jobs; the browser
 *             never enters THIS image (the containment invariant holds).
 *   `none`    a workspace cell with no render service: browser-needing formats
 *             refuse with a remedy, browser-free formats (zip) still run here.
 *
 * Resolved once per boot-shaped question (env does not change while a cell
 * runs — env applies at container start, see apps/cells/wrangler.toml).
 */
export type RenderLane = 'local' | 'remote' | 'none';

export function resolveRenderLane(env: NodeJS.ProcessEnv = process.env): RenderLane {
  if (!isWorkspaceMode(env)) return 'local';
  return env.MAUDE_RENDER_URL ? 'remote' : 'none';
}

/**
 * Route paths a workspace cell must not expose, with the reason each one
 * violates containment. The reason travels with the entry so the error message
 * teaches rather than just refusing.
 *
 * These are prefixes: a variant of a forbidden surface is still forbidden.
 * The ONE escape is an entry's `except` list — EXACT paths that leave the
 * prefix's shadow because they hold none of what the prefix is forbidden for.
 * feature-cloud-export-render-workers used it first: `/_api/export-jobs` +
 * `/_api/export-history` enqueue, list and stream — the EVALUATION the
 * `/_api/export` prefix names happens in the maude-render service (or is
 * refused, lane `none`), never here. An unlisted future `/_api/export-*`
 * route stays forbidden by default, which is the property that makes an
 * exact-path allowlist safer than narrowing the prefix.
 *
 * TWO KINDS OF ENTRY LIVE HERE, and both belong:
 *
 *   1. surfaces that EVALUATE tenant content on our compute (export, shell-shot);
 *      — NOT `/_api/photo-edit`, which was withheld here for a while under
 *      that rationale and never fit it: the route validates and stores a JSON
 *      sidecar (`assets/<sha8>.photo.json`), and the DECODING it was blamed
 *      for happens in the member's own browser (PhotoPreviewBridge) — the
 *      exact same division of labour that makes `/_canvas-shell` servable.
 *      The withhold's real effect was that photo edits could not be saved in
 *      the cloud at all, reported as "photo editing doesn't work";
 *   2. surfaces that hold, spend or reveal a SECRET on our compute — a provider
 *      key, the operator's GitHub token, the user's own `claude` session, the
 *      process log. DDR-123's "claude never on our infra" is only a fact while
 *      these are unreachable, and Cloud Phase 27 D1 is where they stop being in
 *      the image at all. Until then, unreachable is the floor, not the ceiling.
 */
export const FORBIDDEN_ROUTE_PREFIXES: ReadonlyArray<{
  prefix: string;
  why: string;
  except?: readonly string[];
}> = Object.freeze([
  {
    prefix: '/_api/export',
    why: 'export renders the canvas through a headless browser — it EVALUATES tenant TSX',
    // The job lane: enqueue / list+stream / history. No evaluation happens
    // in-cell — browser formats dispatch to maude-render (exporters/jobs.ts
    // render lane), zip runs browser-free, and lane `none` refuses with a
    // remedy. DDR-230 (amending DDR-209 A′1) records the contract.
    // `/_api/export-assemble` (DDR-231): the browser lane's assemble half —
    // the MEMBER's browser captured the artboard PNGs, the cell composes the
    // deck with PptxGenJS (pure JS over pure data, the zip containment
    // class). Nothing evaluates here either.
    // `/_api/export-warmup` (DDR-231 T7): proxies GET /_health to the render
    // service so the container wakes while the member picks export options —
    // no job body, no evaluation, no secret in the response.
    except: [
      '/_api/export-jobs',
      '/_api/export-jobs/download',
      '/_api/export-history',
      '/_api/export-assemble',
      '/_api/export-warmup',
    ],
  },
  {
    prefix: '/_api/generate',
    why: 'media generation runs tenant-authored prompts against a provider key held here',
  },
  {
    prefix: '/_api/figma',
    why: 'the Figma lane STORES and SPENDS a user personal access token, and imports write the design root — a cell must hold no provider credential (DDR-216 D2/D3, same class as /_api/generate)',
  },
  {
    prefix: '/_api/shell-shot',
    why: 'the shell screenshot spawns a headless browser against the studio — the same evaluation `/_api/export` is forbidden for',
  },
  {
    prefix: '/_ws/acp',
    why: 'the ACP bridge spawns the user’s own `claude` and can drive file edits (DDR-123 is desktop-only)',
  },
  // ---- Cloud Phase 27 D1 — the secret-bearing surfaces, named at last ----
  {
    prefix: '/_api/acp',
    why: 'the ACP surface drives the user’s own `claude` session; a cell must not hold one (DDR-123)',
  },
  {
    prefix: '/_api/claude',
    why: 'installing or signing in to `claude` from a cell would put a user’s subscription on our infra (DDR-123)',
  },
  {
    prefix: '/_api/cloud',
    why: 'cloud sign-in mints and stores an account session — a cell IS the cloud, it must not be a client of it',
  },
  {
    prefix: '/_api/github',
    why: 'the GitHub lane spends an operator credential; a cell asks the control plane, it never holds one (DDR-201)',
  },
  {
    prefix: '/_api/hub',
    why: 'hub linking rewrites which server owns this project — a cell must not repoint itself',
  },
  {
    prefix: '/_api/debug-bundle',
    why: 'the diagnostic bundle reads this process’s logs, where every cell secret has had a chance to appear',
  },
  {
    prefix: '/_api/diagnostics',
    why: 'diagnostics read the same process logs as the debug bundle (V2-2.9)',
  },
  {
    prefix: '/_api/design',
    why: 'design-system init shells out to the CLI on our compute against tenant-chosen input',
  },
]);

/**
 * Routes a cell MAY serve, but only while the contract that makes them safe is
 * armed. DDR-209 A′1.
 *
 * These are NOT a softer forbidden list. A forbidden route is absent; a
 * sandboxed route is PRESENT AND ATTESTED — the boot-assert refuses to start
 * when one of them is reachable and `sandboxArmed` is false, which is a check
 * the old list could not make because the route never existed to check.
 *
 * What they are, precisely:
 *
 *   `/_canvas-shell`    a static HTML harness with a strict CSP. The cell emits
 *                       a string; the MEMBER'S BROWSER mounts and executes. The
 *                       old entry's reason ("the surface that mounts and
 *                       executes a canvas module") described the browser's job,
 *                       not ours.
 *   `/_canvas-runtime`  pre-built VENDOR bundles (React, motion) compiled from
 *                       our own source at image build. Not one tenant byte, and
 *                       serving them evaluates nothing. The old entry's reason
 *                       ("only makes sense if something here renders") is the
 *                       premise Phase 25 A0 replaced: it makes sense because the
 *                       browser renders.
 *
 * THE CONTRACT (Cloud Phase 25 A1, unchanged and still CI-asserted): the build
 * that turns a canvas into that module runs in its OWN process, with an EMPTY
 * environment, an import allowlist, a wall-clock deadline and an RSS ceiling.
 * Serving the shell without that armed would mean building tenant source in the
 * cell's main process, next to HUB_SECRET — so the assert treats an unarmed
 * sandbox exactly like a forbidden route.
 */
export const SANDBOXED_ROUTE_PREFIXES: ReadonlyArray<{ prefix: string; why: string }> =
  Object.freeze([
    {
      prefix: '/_canvas-shell',
      why: 'the canvas shell is a static harness the BROWSER evaluates — permitted only while the build sandbox is armed',
    },
    {
      prefix: '/_canvas-runtime',
      why: 'the runtime bundles are vendor code — permitted only while the build sandbox is armed',
    },
  ]);

/**
 * Modules a cell must not be able to load. Presence of the *dependency* is the
 * signal — a cell image that ships Playwright is one `import()` away from
 * rendering tenant content, so the invariant is cheaper to hold at the image
 * boundary than at the call site.
 */
export const FORBIDDEN_MODULES: ReadonlyArray<string> = Object.freeze([
  'playwright',
  'playwright-core',
  'puppeteer',
  'puppeteer-core',
]);

function matches(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(prefix);
}

/** The forbidden entry shadowing `route`, honoring exact-path `except` escapes. */
function forbiddenEntryFor(
  route: string
): { prefix: string; why: string; except?: readonly string[] } | undefined {
  return FORBIDDEN_ROUTE_PREFIXES.find(
    (f) => matches(route, f.prefix) && !f.except?.includes(route)
  );
}

/** True when `route` is (or starts with) a forbidden prefix and is not excepted. */
export function isForbiddenRoute(route: string): boolean {
  return forbiddenEntryFor(route) !== undefined;
}

/** True when `route` is one a cell may serve only while the sandbox is armed. */
export function isSandboxedRoute(route: string): boolean {
  return SANDBOXED_ROUTE_PREFIXES.some((f) => matches(route, f.prefix));
}

/**
 * Remove every forbidden surface from a route table.
 *
 * This is what lets a cell boot at all: the studio serves one route table, and
 * most of it (sync, comments, annotations, assets, git) is exactly what a cell
 * needs. Pruning — rather than maintaining a separate cell server — means a cell
 * runs the SAME code path a self-hoster runs, which is the property DDR-192 §1
 * is built on. A second implementation would drift.
 *
 * Order matters: prune first, then `assertContainment` over the PRUNED keys.
 * That makes the boot-assert a post-condition on this function rather than an
 * independent opinion, so a prefix added to the vocabulary automatically both
 * prunes and is verified.
 */
export function pruneForWorkspace<T extends Record<string, unknown>>(
  routes: T
): { routes: Partial<T>; removed: string[] } {
  const kept: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [route, handler] of Object.entries(routes)) {
    if (isForbiddenRoute(route)) removed.push(route);
    else kept[route] = handler;
  }
  return { routes: kept as Partial<T>, removed: removed.sort() };
}

export interface ContainmentReport {
  ok: boolean;
  /** Route prefixes that are reachable and must not be. */
  routes: Array<{ route: string; prefix: string; why: string }>;
  /** Forbidden modules that resolve in this process. */
  modules: string[];
  /** Sandboxed routes that are reachable while the sandbox is NOT armed. */
  unattested: Array<{ route: string; prefix: string; why: string }>;
}

/**
 * Check a route table against the invariant. Pure — takes the route names so it
 * can be unit-tested without booting a server, and so the caller decides what
 * "reachable" means for its own dispatch shape.
 *
 * `sandboxArmed` is the A′1 contract, passed in rather than detected here: this
 * module has no business importing the build host, and the caller is the only
 * one who knows whether it wired it. Default `false` is deliberate — an unstated
 * contract is an unmet one.
 */
export function checkContainment(
  routeNames: Iterable<string>,
  {
    resolveModule,
    sandboxArmed = false,
  }: { resolveModule?: (specifier: string) => boolean; sandboxArmed?: boolean } = {}
): ContainmentReport {
  const routes: ContainmentReport['routes'] = [];
  const unattested: ContainmentReport['unattested'] = [];
  for (const route of routeNames) {
    const forbidden = forbiddenEntryFor(route);
    if (forbidden) {
      routes.push({ route, prefix: forbidden.prefix, why: forbidden.why });
      continue;
    }
    if (sandboxArmed) continue;
    const sandboxed = SANDBOXED_ROUTE_PREFIXES.find((f) => matches(route, f.prefix));
    if (sandboxed) unattested.push({ route, prefix: sandboxed.prefix, why: sandboxed.why });
  }

  const modules: string[] = [];
  if (resolveModule) {
    for (const specifier of FORBIDDEN_MODULES) {
      if (resolveModule(specifier)) modules.push(specifier);
    }
  }

  return {
    ok: routes.length === 0 && modules.length === 0 && unattested.length === 0,
    routes,
    modules,
    unattested,
  };
}

/** Render a report as the message the operator sees when a cell refuses to boot. */
export function formatContainmentFailure(report: ContainmentReport): string {
  const lines = [
    'REFUSING TO START: this process is running as a workspace cell',
    '(MAUDE_WORKSPACE_MODE=1) but exposes surfaces that break the containment',
    'invariant — "no tenant-authored TSX is ever evaluated by vendor-operated',
    'compute" (DDR-193 §2).',
    '',
  ];
  if (report.routes.length > 0) {
    lines.push('Reachable routes that must not be:');
    for (const { route, prefix, why } of report.routes) {
      lines.push(`  ${route}`);
      lines.push(`      matches ${prefix} — ${why}`);
    }
    lines.push('');
  }
  if (report.unattested.length > 0) {
    lines.push(
      'Canvas surfaces are reachable but the BUILD SANDBOX is not armed:',
      ...report.unattested.flatMap(({ route, prefix, why }) => [
        `  ${route}`,
        `      matches ${prefix} — ${why}`,
      ]),
      '',
      'These routes are permitted in a cell (DDR-209 A′1) — but only together',
      'with the Phase 25 A1 contract: the canvas build runs in its OWN process,',
      'with an EMPTY environment, an import allowlist and wall-clock + RSS',
      'ceilings. Serving the shell without it means parsing tenant source in the',
      'process that holds HUB_SECRET. Pass sandboxArmed once that host is wired.',
      ''
    );
  }
  if (report.modules.length > 0) {
    lines.push('Modules that resolve in this process and must not:');
    for (const m of report.modules) lines.push(`  ${m}`);
    lines.push('');
  }
  lines.push(
    'A cell syncs, keeps history, stores assets and BUILDS a member’s own canvas',
    'in a bounded sandbox. Evaluation happens in the member’s own browser, in a',
    'segregated origin, where DDR-063/DDR-054 already contain it. Nothing here',
    'renders, and no browser enters the image.',
    '',
    'If a feature genuinely needs one of the FORBIDDEN surfaces, Direction B (a',
    'structured, non-executable synced unit) is its HARD PREREQUISITE — not a',
    'flag to add here.'
  );
  if (report.modules.length > 0) {
    lines.push(
      '',
      'Testing workspace mode inside a DEV CHECKOUT? Playwright is a legitimate',
      'devDependency here (the E2E harness), so it resolves and this fires. Set',
      'MAUDE_WORKSPACE_ALLOW_DEV_MODULES=1 to skip the module check locally. It has',
      'no effect on a built cell image, where the runtime-dependency gate in',
      'scripts/check-containment.sh is the enforcement — a shipped cell must not',
      'contain a browser at all.'
    );
  }
  return lines.join('\n');
}

/**
 * Boot gate. No-op unless workspace mode is on; otherwise throws with the full
 * report when anything forbidden is reachable.
 *
 * Deliberately throws rather than returning a boolean: a caller that forgets to
 * check a return value is exactly the class of mistake this exists to survive.
 */
export function assertContainment(
  routeNames: Iterable<string>,
  {
    env = process.env,
    resolveModule,
    sandboxArmed = false,
  }: {
    env?: NodeJS.ProcessEnv;
    resolveModule?: (specifier: string) => boolean;
    sandboxArmed?: boolean;
  } = {}
): void {
  if (!isWorkspaceMode(env)) return;
  const report = checkContainment(routeNames, { resolveModule, sandboxArmed });
  if (report.ok) return;
  throw new Error(formatContainmentFailure(report));
}
