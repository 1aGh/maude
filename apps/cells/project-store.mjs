// The cloud durable home of a project's accepted revisions — DDR-241 §2, plan T10.
//
// THE SAME STORE, A DIFFERENT DISK. `store-core.mjs` is the one schema and the
// one commit procedure both distributions run; here it runs INSIDE the cell's
// Durable Object, over the DO's own SQLite. The hub in the container reaches it
// through `http://project-store.internal/` — an outbound request the container
// runtime hands to `projectStoreOutbound` below, which forwards it to THIS
// cell's Durable Object (the id comes from the runtime's `containerId`, never
// from the request, so a container can reach no store but its own).
//
// Why the DO and not the container's disk: a container is disposable — it is
// replaced on every rollout and may be rescheduled at any time — while the DO's
// SQLite is durable storage the platform replicates before a write returns.
// Nothing here waits on R2 or any other remote store inside the commit: the
// output gate releases the RPC answer only after the SQL transaction is
// durable, so the hub acknowledges nothing the store could lose.

import { createStoreCore, StoreConflict } from '../hub/src/project-transactions/store-core.mjs';

export const PROJECT_STORE_HOST = 'project-store.internal';

/** Store methods the container may call — the whole async store API, nothing else. */
export const STORE_METHODS = Object.freeze([
  'state',
  'setMode',
  'markImported',
  'heads',
  'blob',
  'result',
  'recordResult',
  'commit',
  'revisions',
  'history',
  'action',
  'manifest',
  'docByPath',
  'laneAt',
  'effectsAfter',
  'liveDocByEntry',
]);
const ALLOWED = new Set(STORE_METHODS);

/** `{exec, transaction}` over a Durable Object's `ctx.storage`. */
export function durableObjectSqlAdapter(storage) {
  return {
    exec(query, ...params) {
      return storage.sql.exec(query, ...params).toArray();
    },
    transaction(fn) {
      return storage.transactionSync(fn);
    },
  };
}

/**
 * The DO-side host: lazily migrates once, then runs one store method. Errors
 * become plain data — RPC does not carry classes — and the client rebuilds a
 * `StoreConflict` from them.
 */
export function createProjectStoreHost(storage, { now } = {}) {
  let core = null;
  const ready = () => {
    if (!core) {
      core = createStoreCore(durableObjectSqlAdapter(storage), { now });
      core.migrate();
    }
    return core;
  };
  return function call(method, args) {
    if (typeof method !== 'string' || !ALLOWED.has(method)) {
      return {
        ok: false,
        error: { name: 'Error', code: 'unknown-method', message: 'no such store method' },
      };
    }
    if (!Array.isArray(args)) args = [];
    try {
      return { ok: true, value: ready()[method](...args) ?? null };
    } catch (err) {
      if (err instanceof StoreConflict) {
        return {
          ok: false,
          error: { name: 'StoreConflict', code: err.code, message: err.message },
        };
      }
      return {
        ok: false,
        error: { name: 'Error', code: 'store-error', message: String(err?.message ?? err) },
      };
    }
  };
}

/**
 * The container's outbound request → its own cell's Durable Object.
 * Signature is @cloudflare/containers' `outboundByHost` handler.
 */
export async function projectStoreOutbound(request, env, ctx) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const url = new URL(request.url);
  const m = /^\/v1\/([A-Za-z]+)$/.exec(url.pathname);
  if (!m || !ALLOWED.has(m[1])) return new Response('not found', { status: 404 });
  if (!ctx?.containerId || !env?.MAUDE_CELL) {
    return new Response('store unavailable', { status: 503 });
  }
  let args;
  try {
    args = (await request.json())?.args ?? [];
  } catch {
    return new Response('bad request', { status: 400 });
  }
  // The container's OWN cell (the id comes from the runtime, not the
  // request); the cell resolves its tenant and forwards to that tenant's
  // ProjectStore — so no container can name another project's store.
  const cell = env.MAUDE_CELL.get(env.MAUDE_CELL.idFromString(ctx.containerId));
  const answer = await cell.projectStore(m[1], args);
  return Response.json(answer);
}
