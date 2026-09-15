// T32 verification Worker — the REAL ProjectStore Durable Object behind a
// bearer, so a local hub (the real kernel) can use Cloudflare's actual durable
// SQLite store and latency. Disposable: deployed under a unique name, deleted
// after the run. Never a product route.
//
//   POST /t/<project>/v1/<method>  {args}  → {ok, value|error}
import { ProjectStore } from '../../../apps/cells/project-store-do.mjs';

export { ProjectStore };

const METHOD = /^\/t\/([a-z0-9][a-z0-9-]{0,62})\/v1\/([A-Za-z]+)$/;

export default {
  async fetch(request, env) {
    if (request.headers.get('authorization') !== `Bearer ${env.T32_SECRET}`) {
      return new Response('unauthorized', { status: 401 });
    }
    const m = METHOD.exec(new URL(request.url).pathname);
    if (!m || request.method !== 'POST') return new Response('not found', { status: 404 });
    const args = (await request.json().catch(() => ({})))?.args ?? [];
    const stub = env.PROJECT_STORE.get(env.PROJECT_STORE.idFromName(m[1]));
    return Response.json(await stub.projectStore(m[2], args));
  },
};
