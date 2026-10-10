// V2-2.5 — deps for building the route table WITHOUT a server.
//
// A route factory only closes over its deps; it never calls them while it
// builds its `RouteSpec[]` (routes/index.ts says so). So a table built from
// these stubs has every real method, path, origin and readOnly — which is all
// the table tests read — and a handler that is never run. A factory that does
// call a dep at build time still works here (every property is a callable that
// returns another stub), so the contract is a convention the tests survive.

import type { RouteDeps } from '../routes/index.ts';

function anyStub(): unknown {
  const fn = () => anyStub();
  return new Proxy(fn, {
    // `then` stays undefined: a stub must never look like a promise.
    get: (_t, key) =>
      key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : anyStub(),
    apply: () => anyStub(),
  });
}

export function stubDeps(): RouteDeps {
  return anyStub() as RouteDeps;
}

/** A concrete request path for a spec path (`:id` → `id1`). */
export function samplePath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, '$11');
}
