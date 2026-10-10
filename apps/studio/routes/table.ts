// The route-table shape (V2-2.5: "split new-route homes out of http.ts —
// routes/<area>.ts + one table"). A NEW route is a `RouteSpec` in a
// `routes/<area>.ts` factory, collected by `routes/index.ts` (`allSpecs`) —
// never a new key in http.ts's legacy `routes` literal. http.ts mounts the one
// table: exact paths into the main-origin `routes` map (behind the same
// `readOnlyRefusal` wrap as the legacy keys, after `guardTableRoute`),
// `:param` paths through `matchRoute` first in the fall-through. A spec is
// canvas-safe only when it says `origin: 'canvas'`.

export interface RouteSpec {
  method: 'GET' | 'POST';
  /** Bun-style path; `:id` segments are params. */
  path: string;
  /**
   * Where it may be served from. `main`: the main origin only (the default for
   * anything privileged). `canvas`: ALSO the untrusted canvas origin and the
   * read-only capture origin (DDR-054/088, V2-2.8 S9) — the path is derived into
   * BOTH canvas allowlists (`CANVAS_SAFE_API` in http.ts and the canvas server's
   * routes map, routes/canvas-origin.ts), so a canvas-safe route is one field
   * here, never two hand edits. Exact paths only: `mountRoutes` refuses a
   * `:param` canvas spec (the canvas fall-through gate matches exact paths).
   */
  origin: 'main' | 'canvas';
  /**
   * Whether a read-only session (viewer, or a format-gated project) may call
   * it — the route's entry in `READ_ONLY_ALLOWED_WRITES` (or not). Reads are
   * always allowed.
   */
  readOnly: 'allowed' | 'refused';
  handle(req: Request, params: Record<string, string>): Response | Promise<Response>;
}

/** Match a request against a table — the fall-through dispatcher's half of
 *  the table. `null` = not ours. */
export function matchRoute(
  specs: readonly RouteSpec[],
  method: string,
  pathname: string
): { spec: RouteSpec; params: Record<string, string> } | null {
  for (const spec of specs) {
    if (spec.method !== method) continue;
    const want = spec.path.split('/');
    const got = pathname.split('/');
    if (want.length !== got.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < want.length; i++) {
      const w = want[i] as string;
      const g = got[i] as string;
      if (w.startsWith(':')) {
        let v: string | null = null;
        try {
          v = g ? decodeURIComponent(g) : null;
        } catch {
          v = null; // a malformed escape is not a match
        }
        if (!v) {
          ok = false;
          break;
        }
        params[w.slice(1)] = v;
      } else if (w !== g) {
        ok = false;
        break;
      }
    }
    if (ok) return { spec, params };
  }
  return null;
}

const paramRe = (p: string) =>
  new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+')}$`);

/**
 * Turn route tables into what http.ts mounts: `exact` for the main-origin
 * `routes` map (path → handler, 405 on another method), `dynamic` for the
 * fall-through (`null` = not ours), the read-only allowlist additions the
 * specs declare (`readOnly: 'allowed'` writes), and `canvasPaths` — the exact
 * paths of `origin: 'canvas'` specs, which both canvas allowlists derive.
 */
export function mountRoutes(specs: readonly RouteSpec[]): {
  exact: Record<string, (req: Request) => Promise<Response>>;
  dynamic: (req: Request) => Promise<Response> | null;
  readOnlyAllowed: { exact: string[]; patterns: RegExp[] };
  canvasPaths: string[];
} {
  for (const s of specs)
    if (s.origin === 'canvas' && s.path.includes(':'))
      throw new Error(`${s.method} ${s.path}: an origin 'canvas' route takes exact paths only`);
  const byPath = new Map<string, RouteSpec[]>();
  for (const s of specs) byPath.set(s.path, [...(byPath.get(s.path) ?? []), s]);
  const exact: Record<string, (req: Request) => Promise<Response>> = {};
  for (const [p, list] of byPath) {
    if (p.includes(':')) continue;
    exact[p] = async (req) => {
      const spec = list.find((s) => s.method === req.method);
      return spec ? spec.handle(req, {}) : new Response('Method not allowed', { status: 405 });
    };
  }
  const dynamicSpecs = specs.filter((s) => s.path.includes(':'));
  const dynamic = (req: Request): Promise<Response> | null => {
    let pathname: string;
    try {
      pathname = new URL(req.url).pathname;
    } catch {
      return null;
    }
    const m = matchRoute(dynamicSpecs, req.method, pathname);
    if (m) return Promise.resolve(m.spec.handle(req, m.params));
    if (dynamicSpecs.some((s) => paramRe(s.path).test(pathname)))
      return Promise.resolve(new Response('Method not allowed', { status: 405 }));
    return null;
  };
  const writes = specs.filter((s) => s.method !== 'GET' && s.readOnly === 'allowed');
  return {
    exact,
    dynamic,
    readOnlyAllowed: {
      exact: writes.filter((s) => !s.path.includes(':')).map((s) => s.path),
      patterns: writes.filter((s) => s.path.includes(':')).map((s) => paramRe(s.path)),
    },
    canvasPaths: [...new Set(specs.filter((s) => s.origin === 'canvas').map((s) => s.path))],
  };
}

/**
 * One sample path per dynamic `/_api/` branch http.ts's fall-through owns
 * (`handleFallthrough`). The table's `dynamic` runs FIRST there, so a `:param`
 * spec matching one of these would answer it instead of the legacy handler.
 * Legacy-side only: a new dynamic route is a table spec, not a new branch.
 */
export const FALLTHROUGH_API_SAMPLES = ['/_api/thumb/key1', '/_api/comments/id1/reply'];

const sampleOf = (path: string) => path.replace(/:([A-Za-z_]+)/g, '$11');

export interface RouteTableInput {
  /** the table (routes/index.ts `allSpecs`) */
  specs: readonly RouteSpec[];
  /** the keys of http.ts's legacy `routes` literal */
  legacyKeys: readonly string[];
  /** http.ts READ_ONLY_ALLOWED_WRITES / READ_ONLY_ALLOWED_WRITE_PATTERNS */
  readOnlyAllowedWrites: ReadonlySet<string>;
  readOnlyAllowedPatterns: readonly RegExp[];
}

/**
 * Every way the one table can be wrong when it merges with the legacy routes —
 * `[]` when it is sound. http.ts runs this at construction and refuses to boot
 * on a problem (like the containment boot-assert); test/routes-table.test.ts
 * runs it over the source and over planted faults.
 *   - a path+method declared twice in the table;
 *   - a table exact path that is ALSO a legacy key: `{ ...table, ...legacy }`
 *     keeps only one, silently (the "nothing lost" rule);
 *   - `readOnly` disagreeing with the module allowlists (a refused spec the
 *     allowlist lets through, an allowed one declared twice, a refused GET);
 *   - a `:param` spec outside `/_api/<literal>/`, or matching an exact route
 *     or a path the legacy fall-through owns (it would shadow it).
 */
export function checkRouteTable(t: RouteTableInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const legacy = new Set(t.legacyKeys);
  const exactPaths = new Set([
    ...t.legacyKeys,
    ...t.specs.filter((s) => !s.path.includes(':')).map((s) => s.path),
  ]);
  const collided = new Set<string>();
  for (const s of t.specs) {
    const id = `${s.method} ${s.path}`;
    if (seen.has(id)) out.push(`${id}: declared twice in the table`);
    seen.add(id);
    const dynamic = s.path.includes(':');
    if (!dynamic && legacy.has(s.path) && !collided.has(s.path)) {
      collided.add(s.path);
      out.push(`${s.path}: in the table AND the legacy routes literal (the merge keeps only one)`);
    }
    if (s.method === 'GET') {
      if (s.readOnly === 'refused')
        out.push(`${id}: a read is never refused — declare readOnly 'allowed'`);
    } else {
      const sample = sampleOf(s.path);
      const listedBy = t.readOnlyAllowedWrites.has(s.path)
        ? 'READ_ONLY_ALLOWED_WRITES'
        : t.readOnlyAllowedPatterns.some((re) => re.test(sample))
          ? 'READ_ONLY_ALLOWED_WRITE_PATTERNS'
          : null;
      if (listedBy && s.readOnly === 'refused')
        out.push(`${id}: readOnly 'refused' but ${listedBy} allows it`);
      if (listedBy && s.readOnly === 'allowed')
        out.push(
          `${id}: readOnly 'allowed' is declared twice (spec + ${listedBy}) — keep the spec`
        );
    }
    if (!dynamic) continue;
    if (!/^\/_api\/[^/:]+\//.test(s.path)) {
      out.push(`${id}: a :param route lives under /_api/<literal>/`);
      continue;
    }
    const re = paramRe(s.path);
    for (const p of exactPaths) if (re.test(p)) out.push(`${id}: matches the exact route ${p}`);
    for (const p of FALLTHROUGH_API_SAMPLES)
      if (re.test(p)) out.push(`${id}: matches ${p}, which the fall-through owns`);
  }
  return out;
}
