// Cloud Phase 3 — the containment invariant's boot-assert (DDR-193 §2).
//
//   > No tenant-authored TSX is ever evaluated by vendor-operated compute.
//
// The thing being tested is a REFUSAL. So the tests that matter are the ones
// that prove the gate fires: a cell exposing an export route, a canvas shell, a
// runtime bundle, or shipping Playwright must not be able to start.
//
// The negative case matters just as much: none of this may fire outside
// workspace mode, or every local dev-server stops booting.

import { describe, expect, test } from 'bun:test';

import {
  assertContainment,
  checkContainment,
  FORBIDDEN_MODULES,
  FORBIDDEN_ROUTE_PREFIXES,
  formatContainmentFailure,
  isForbiddenRoute,
  isSandboxedRoute,
  isWorkspaceMode,
  pruneForWorkspace,
  SANDBOXED_ROUTE_PREFIXES,
} from '../workspace-mode.ts';

const CELL = { MAUDE_WORKSPACE_MODE: '1' } as NodeJS.ProcessEnv;
const LAPTOP = {} as NodeJS.ProcessEnv;

/** The routes a cell legitimately serves: sync + git + assets, nothing else. */
const ALLOWED_ROUTES = [
  '/_health',
  '/_api/asset',
  '/_api/comments',
  '/_api/annotations',
  '/_api/git-committers',
  '/_config',
  '/_ws',
];

describe('workspace mode detection', () => {
  test('only MAUDE_WORKSPACE_MODE=1 turns it on', () => {
    expect(isWorkspaceMode(CELL)).toBe(true);
    expect(isWorkspaceMode(LAPTOP)).toBe(false);
    expect(isWorkspaceMode({ MAUDE_WORKSPACE_MODE: 'true' })).toBe(false);
    expect(isWorkspaceMode({ MAUDE_WORKSPACE_MODE: '0' })).toBe(false);
    expect(isWorkspaceMode({ MAUDE_WORKSPACE_MODE: '' })).toBe(false);
  });
});

describe('checkContainment — what a cell may serve', () => {
  test('sync + git + asset routes pass', () => {
    const report = checkContainment(ALLOWED_ROUTES);
    expect(report.ok).toBe(true);
    expect(report.routes).toEqual([]);
    expect(report.modules).toEqual([]);
  });

  test('every forbidden prefix is caught, and the reason travels with it', () => {
    for (const { prefix, why } of FORBIDDEN_ROUTE_PREFIXES) {
      const report = checkContainment([...ALLOWED_ROUTES, prefix]);
      expect(report.ok).toBe(false);
      expect(report.routes).toHaveLength(1);
      expect(report.routes[0]?.prefix).toBe(prefix);
      // The message has to teach, not just refuse — this is read by someone who
      // added a route in 2027 and has never heard of this invariant.
      expect(report.routes[0]?.why).toBe(why);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  test('a VARIANT of a forbidden route is still forbidden', () => {
    // The realistic way this gets reintroduced: not `/_api/export` verbatim, but
    // a sibling that does the same thing under a new name. (`/_api/export-jobs`
    // moved OUT of this list when render-workers excepted it explicitly — an
    // except-listed exact path is a classified decision, not a variant.)
    for (const route of [
      '/_api/export/png',
      '/_api/export-jobs-v2',
      '/_api/github/repos',
      '/_api/claude/signin',
      '/_ws/acp',
    ]) {
      const report = checkContainment([...ALLOWED_ROUTES, route]);
      expect(report.ok).toBe(false);
      expect(report.routes[0]?.route).toBe(route);
    }
  });

  test('a route that merely CONTAINS a forbidden word is not a false positive', () => {
    // Prefix matching, not substring — `/_api/asset` must not trip on nothing,
    // and a route about exports in its docs must not be blocked by name alone.
    const report = checkContainment([
      '/_api/asset',
      '/_api/export-history-docs-link',
      '/_api/no-export',
      '/_api/git-export-status',
    ]);
    expect(report.routes.map((r) => r.route)).toEqual(['/_api/export-history-docs-link']);
    // ...that one DOES start with /_api/export, and being caught is correct:
    // a surface named "export-*" is exactly what needs a human to look at it.
  });

  test('a resolvable browser automation module fails the check', () => {
    const report = checkContainment(ALLOWED_ROUTES, {
      resolveModule: (s) => s === 'playwright',
    });
    expect(report.ok).toBe(false);
    expect(report.modules).toEqual(['playwright']);
    // All four are checked, not just the popular one.
    const all = checkContainment(ALLOWED_ROUTES, { resolveModule: () => true });
    expect(all.modules).toEqual([...FORBIDDEN_MODULES]);
  });

  test('no resolver supplied ⇒ modules are simply not checked (not silently passed)', () => {
    const report = checkContainment(ALLOWED_ROUTES);
    expect(report.modules).toEqual([]);
  });
});

describe('assertContainment — the boot gate', () => {
  test('OUTSIDE workspace mode it never fires, whatever is exposed', () => {
    // A developer's laptop serves every one of these. If the gate fired here,
    // the entire local product would stop booting.
    expect(() =>
      assertContainment([...ALLOWED_ROUTES, ...FORBIDDEN_ROUTE_PREFIXES.map((f) => f.prefix)], {
        env: LAPTOP,
        resolveModule: () => true,
      })
    ).not.toThrow();
  });

  test('in a cell, a clean route table starts', () => {
    expect(() => assertContainment(ALLOWED_ROUTES, { env: CELL })).not.toThrow();
  });

  test('in a cell, an export route REFUSES TO START', () => {
    expect(() => assertContainment([...ALLOWED_ROUTES, '/_api/export'], { env: CELL })).toThrow(
      /REFUSING TO START/
    );
  });

  test('in a cell, shipping Playwright REFUSES TO START even with clean routes', () => {
    expect(() =>
      assertContainment(ALLOWED_ROUTES, { env: CELL, resolveModule: (s) => s === 'playwright' })
    ).toThrow(/playwright/);
  });

  test('the failure message names the surface, the reason, and the way out', () => {
    let message = '';
    try {
      assertContainment([...ALLOWED_ROUTES, '/_api/export'], { env: CELL });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('/_api/export');
    expect(message).toContain('DDR-193');
    expect(message).toContain('headless browser');
    // The escape hatch is named so the next engineer doesn't invent a flag.
    expect(message).toContain('Direction B');
    expect(message).toContain('HARD PREREQUISITE');
  });

  // ---- DDR-209 A′1: the sandboxed lane -----------------------------------
  //
  // `/_canvas-shell` and `/_canvas-runtime` used to be on the forbidden list.
  // They are not forbidden and they are not free: a cell may serve them ONLY
  // while the out-of-process build sandbox is armed. These three tests are the
  // difference between a reclassification and a loosening.

  test('a canvas surface is REFUSED when the build sandbox is not armed', () => {
    const report = checkContainment([...ALLOWED_ROUTES, '/_canvas-shell.html'], {
      sandboxArmed: false,
    });
    expect(report.ok).toBe(false);
    expect(report.unattested[0]?.route).toBe('/_canvas-shell.html');
    // And it is NOT reported as forbidden — the two failures have different
    // fixes, and collapsing them would send someone to delete a route that is
    // supposed to be there.
    expect(report.routes).toEqual([]);
  });

  test('a canvas surface is PERMITTED once the sandbox is armed', () => {
    const report = checkContainment(
      [...ALLOWED_ROUTES, '/_canvas-shell.html', '/_canvas-runtime/react.js'],
      { sandboxArmed: true }
    );
    expect(report.ok).toBe(true);
  });

  test('the attestation defaults to UNMET — an unstated contract is not a contract', () => {
    expect(checkContainment(['/_canvas-shell.html']).ok).toBe(false);
  });

  test('arming the sandbox does not permit anything on the FORBIDDEN list', () => {
    // The failure this rules out: `sandboxArmed: true` becoming a master key.
    const report = checkContainment([...ALLOWED_ROUTES, '/_api/export', '/_ws/acp'], {
      sandboxArmed: true,
    });
    expect(report.ok).toBe(false);
    expect(report.routes.map((r) => r.route).sort()).toEqual(['/_api/export', '/_ws/acp']);
  });

  test('the unattested message explains the contract rather than just refusing', () => {
    const message = formatContainmentFailure(
      checkContainment(['/_canvas-shell.html'], { sandboxArmed: false })
    );
    expect(message).toContain('BUILD SANDBOX is not armed');
    expect(message).toContain('EMPTY environment');
    expect(message).toContain('DDR-209');
  });

  test('formatContainmentFailure reports routes and modules together', () => {
    const report = checkContainment([...ALLOWED_ROUTES, '/_api/export'], {
      resolveModule: (s) => s === 'puppeteer',
    });
    const message = formatContainmentFailure(report);
    expect(message).toContain('/_api/export');
    expect(message).toContain('puppeteer');
    expect(message).toContain('Reachable routes');
    expect(message).toContain('Modules that resolve');
  });
});

describe('the vocabulary itself', () => {
  test('the forbidden set covers every way a cell could evaluate tenant code', () => {
    // Pinned deliberately: the realistic loss of this invariant is a refactor
    // quietly dropping an entry while every other test stays green. Changing
    // this list should require changing this test, on purpose.
    expect(FORBIDDEN_ROUTE_PREFIXES.map((f) => f.prefix).sort()).toEqual([
      // Surfaces that EVALUATE tenant content on our compute…
      '/_api/acp',
      '/_api/claude',
      '/_api/cloud',
      '/_api/debug-bundle',
      '/_api/design',
      // the same process logs as the debug bundle (V2-2.9 diagnostics)
      '/_api/diagnostics',
      '/_api/export',
      '/_api/figma',
      '/_api/generate',
      '/_api/github',
      '/_api/hub',
      // `/_api/photo-edit` left this list on purpose: it stores a validated
      // JSON sidecar and evaluates nothing — the decode happens in the
      // member's browser. Withholding it made photo edits unsavable in the
      // cloud. See workspace-mode.ts's header for the fuller account.
      // Spawns a headless browser against the studio — same evaluation as
      // `/_api/export`, and there is no browser in a cell image.
      '/_api/shell-shot',
      '/_ws/acp',
    ]);
    // …and the two that a cell SERVES, under an asserted contract (DDR-209 A′1).
    // They moved lists; they did not stop being checked. See the sandbox tests
    // above for what "under contract" is worth.
    expect(SANDBOXED_ROUTE_PREFIXES.map((f) => f.prefix).sort()).toEqual([
      '/_canvas-runtime',
      '/_canvas-shell',
    ]);
    // Nothing may be on both lists — that would make the weaker one decorative.
    const forbidden = new Set(FORBIDDEN_ROUTE_PREFIXES.map((f) => f.prefix));
    for (const { prefix } of SANDBOXED_ROUTE_PREFIXES) {
      expect(forbidden.has(prefix)).toBe(false);
    }
    expect([...FORBIDDEN_MODULES].sort()).toEqual([
      'playwright',
      'playwright-core',
      'puppeteer',
      'puppeteer-core',
    ]);
  });
});

describe('pruneForWorkspace — how a cell can boot at all', () => {
  test('keeps the sync/git/asset surface and removes exactly the forbidden one', () => {
    const table = {
      '/_health': 'h',
      '/_api/asset': 'a',
      '/_api/comments': 'c',
      '/_api/git-committers': 'g',
      '/_api/export': 'x',
      '/_api/export-jobs': 'x2',
      '/_api/photo-edit': 'p',
      '/_api/generate/keys': 'k',
    };
    const { routes, removed } = pruneForWorkspace(table);

    expect(Object.keys(routes).sort()).toEqual([
      '/_api/asset',
      '/_api/comments',
      // Kept since render-workers — the job lane enqueues/streams, it never
      // evaluates (the `except` escape on the `/_api/export` prefix).
      '/_api/export-jobs',
      '/_api/git-committers',
      // Kept since the unwithhold — a photo edit is a stored sidecar, and a
      // cell that cannot store it cannot save photo edits at all.
      '/_api/photo-edit',
      '/_health',
    ]);
    expect(removed).toEqual(['/_api/export', '/_api/generate/keys']);
    // Handlers are carried through by reference — pruning must not rebuild them.
    expect(routes['/_api/asset']).toBe('a');
  });

  test('the pruned table then PASSES the boot assert — prune and assert agree', () => {
    // This is the whole design: the assert is a post-condition on the pruning,
    // so a prefix added to the vocabulary both prunes and is verified, and the
    // two can never drift into disagreeing.
    const table = Object.fromEntries(
      [...FORBIDDEN_ROUTE_PREFIXES.map((f) => f.prefix), '/_health', '/_api/asset'].map((r) => [
        r,
        () => {},
      ])
    );
    const { routes } = pruneForWorkspace(table);
    expect(() => assertContainment(Object.keys(routes), { env: CELL })).not.toThrow();
    // ...and the unpruned table would have refused.
    expect(() => assertContainment(Object.keys(table), { env: CELL })).toThrow(/REFUSING TO START/);
  });

  test('the export JOB lane survives the prune; the synchronous render does not (render-workers)', () => {
    // feature-cloud-export-render-workers: enqueue/list/download evaluate
    // nothing — the render happens in the maude-render service (or refuses,
    // lane `none`). The synchronous `/_api/export` stays forbidden, and so
    // does any FUTURE `/_api/export-*` variant nobody has classified — the
    // escape is an explicit exact-path allowlist, not a loosened prefix.
    const table = {
      '/_api/export': 'x',
      '/_api/export-jobs': 'j',
      '/_api/export-jobs/download': 'd',
      '/_api/export-history': 'h',
      // DDR-231 — the browser lane's assemble half: pure data (client-captured
      // PNGs) → PptxGenJS in-cell; nothing evaluates, same class as zip.
      '/_api/export-assemble': 'a',
      // DDR-231 T7 — warm-up ping: proxies GET /_health to the render service
      // so the container wakes while the member is still picking options.
      '/_api/export-warmup': 'w',
      '/_api/export-next-phase-surprise': 'f',
      '/_health': 'ok',
    };
    const { routes, removed } = pruneForWorkspace(table);
    expect(Object.keys(routes).sort()).toEqual([
      '/_api/export-assemble',
      '/_api/export-history',
      '/_api/export-jobs',
      '/_api/export-jobs/download',
      '/_api/export-warmup',
      '/_health',
    ]);
    expect(removed).toEqual(['/_api/export', '/_api/export-next-phase-surprise']);
    // The single predicate agrees (the fetch fall-through gates on it too).
    expect(isForbiddenRoute('/_api/export')).toBe(true);
    expect(isForbiddenRoute('/_api/export-jobs')).toBe(false);
    expect(isForbiddenRoute('/_api/export-jobs/download')).toBe(false);
    expect(isForbiddenRoute('/_api/export-history')).toBe(false);
    expect(isForbiddenRoute('/_api/export-next-phase-surprise')).toBe(true);
  });

  test('pruning an already-clean table is a no-op', () => {
    const table = Object.fromEntries(ALLOWED_ROUTES.map((r) => [r, () => {}]));
    const { routes, removed } = pruneForWorkspace(table);
    expect(removed).toEqual([]);
    expect(Object.keys(routes).sort()).toEqual([...ALLOWED_ROUTES].sort());
  });

  test('isForbiddenRoute is the single predicate both the table and fetch use', () => {
    // The `fetch` fall-through owns `/_ws/acp`, which is not in the route table,
    // so it gates on this same function. One predicate, so the two gates cannot
    // disagree.
    expect(isForbiddenRoute('/_ws/acp')).toBe(true);
    expect(isForbiddenRoute('/_api/github/repos')).toBe(true);
    expect(isForbiddenRoute('/_ws')).toBe(false);
    expect(isForbiddenRoute('/_health')).toBe(false);
    expect(isForbiddenRoute('/_api/asset')).toBe(false);
    // DDR-209 A′1 — the canvas surfaces are NOT forbidden, which is exactly why
    // the fall-through stopped 404-ing them. `isSandboxedRoute` is where they
    // are now accounted for.
    expect(isForbiddenRoute('/_canvas-shell.html')).toBe(false);
    expect(isForbiddenRoute('/_canvas-runtime/react.js')).toBe(false);
    expect(isSandboxedRoute('/_canvas-shell.html')).toBe(true);
    expect(isSandboxedRoute('/_canvas-runtime/react.js')).toBe(true);
    expect(isSandboxedRoute('/_health')).toBe(false);
  });
});
