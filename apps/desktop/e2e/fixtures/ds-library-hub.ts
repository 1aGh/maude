// A stand-in team-library hub for ds-library.e2e.ts (S10.18c): a loopback http server that serves ONLY what the
// S10.18a ds door serves — `/health` (capability `ds-library`), `…/v1/ds/gator/head` and `…/revisions/<id>`, behind
// one bearer. It starts with the library at V1; `GET /_flip` (loopback only, a test control) moves its head to V2.
// The revisions are the studio fixture's (test/_ds-library-hub.ts), so this and the unit tests share one library.
// Never a real hub. It exits by itself after 20 minutes so a crashed run leaves nothing behind.
//
// Run with bun: `bun fixtures/ds-library-hub.ts`. Prints the port on its first stdout line.

import { GRANT, LIB, PROJECT, V1, V2 } from '../../../studio/test/_ds-library-hub.ts';

export { GRANT, LIB, PROJECT, V1, V2 };

if (import.meta.main) {
  let head = V1.id;
  const revisions = new Map([
    [V1.id, V1.bytes],
    [V2.id, V2.bytes],
  ]);
  const base = `/api/projects/${PROJECT}/v1/ds/${LIB}`;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === '/health')
        return Response.json({ ok: true, capabilities: ['ledger', 'ds-library'] });
      if (u.pathname === '/_flip') {
        head = V2.id;
        return Response.json({ head });
      }
      if (req.headers.get('authorization') !== `Bearer ${GRANT}`)
        return Response.json({ code: 'unauthenticated' }, { status: 401 });
      if (u.pathname === `${base}/head`)
        return Response.json({
          head,
          log: [
            {
              rev: head,
              parent: null,
              action: 'publish',
              at: new Date().toISOString(),
              by: { kind: 'person', name: 'Tereza' },
              summary: 'Corners 2 → 6',
            },
          ],
        });
      const m = new RegExp(`^${base}/revisions/([0-9a-f]{64})$`).exec(u.pathname);
      const bytes = m ? revisions.get(m[1]) : undefined;
      if (bytes === undefined) return Response.json({ code: 'not-found' }, { status: 404 });
      return new Response(bytes, { headers: { 'content-type': 'application/json' } });
    },
  });
  console.log(server.port);
  setTimeout(() => process.exit(0), 20 * 60 * 1000);
}
