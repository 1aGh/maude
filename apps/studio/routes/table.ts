// The shape every lane's route table uses until V2-2.5's shared table lands
// ("split new-route homes out of http.ts — routes/<area>.ts + one table").
// A lane exports `RouteSpec[]`; the lead registers them: exact paths into the
// main-origin `routes` map, `:param` paths through `matchRoute` in the
// fall-through. None is ever canvas-safe unless its spec says so (none does).

export interface RouteSpec {
  method: 'GET' | 'POST';
  /** Bun-style path; `:id` segments are params. */
  path: string;
  /** Where it may be served from. Always `main` here. */
  origin: 'main';
  /**
   * Whether a read-only session (viewer, or a format-gated project) may call
   * it — the route's entry in `READ_ONLY_ALLOWED_WRITES` (or not). Reads are
   * always allowed.
   */
  readOnly: 'allowed' | 'refused';
  handle(req: Request, params: Record<string, string>): Response | Promise<Response>;
}

/** Match a request against a table — for the fall-through dispatcher until
 *  V2-2.5's table exists. `null` = not ours. */
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
 * Turn route tables into what http.ts mounts today: `exact` for the main-origin
 * `routes` map (path → handler, 405 on another method), `dynamic` for the
 * fall-through (`null` = not ours), and the read-only allowlist additions the
 * specs declare (`readOnly: 'allowed'` writes).
 */
export function mountRoutes(specs: readonly RouteSpec[]): {
  exact: Record<string, (req: Request) => Promise<Response>>;
  dynamic: (req: Request) => Promise<Response> | null;
  readOnlyAllowed: { exact: string[]; patterns: RegExp[] };
} {
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
  };
}
