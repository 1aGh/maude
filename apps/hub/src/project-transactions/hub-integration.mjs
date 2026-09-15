// Wiring the acceptance kernel into the hub — DDR-241 §1, §7.
//
//   • `applyAccepted` — the ONLY writer of accepted content into Hocuspocus
//     documents. It speaks the protocols receivers already understand
//     (`syncMeta.path`, the `movedTo` retirement stamp, tombstones), so a studio
//     that receives accepted revisions needs no second receive path.
//   • `fence` — in `transactions` mode every content connection is read-only,
//     re-asserted per message (T7: a cached permission is not a boundary).
//   • `handleRoutes` — `/api/projects/:project/v1/*`.

import { importBaseline } from './baseline.mjs';
import { createKernel } from './kernel.mjs';
import { applyLane, LANE_NAMES } from './lanes.mjs';

export const ACCEPTED_ORIGIN = 'maude-accepted';
const ROUTE =
  /^\/api\/projects\/([A-Za-z0-9._-]{1,128})\/v1\/([a-z-]+)(?:\/([A-Za-z0-9_-]{1,128}))?$/;
export const MAX_BODY_BYTES = 17 * 1024 * 1024;

export function createAcceptedRevisions({
  server,
  store,
  projectId,
  canvasGroups,
  designRel,
  deleteDocument,
  reviveDocument,
  onAccepted = () => {},
  // Baseline import (T30) — what the project holds outside the store.
  listDocuments = () => [],
  tombstoned = () => new Set(),
  checkoutPath = () => null,
  checkoutBody = () => null,
  checkoutDirs = () => [],
  // How long peers get, after the mode notice, to deliver what they sent
  // before it reached them (one generous round trip).
  switchGraceMs = 1500,
  log = console,
}) {
  let state = { mode: 'legacy', epoch: 0, revision: 0 };

  async function withDoc(name, context, fn) {
    const conn = await server.hocuspocus.openDirectConnection(name, context);
    try {
      await conn.transact(fn);
    } finally {
      await conn.disconnect();
    }
  }

  async function applyAccepted({ revision, actionId, changes, dirs, actor }) {
    const context = {
      accepted: { revision, actionId },
      user: { name: actor, email: actor.includes('@') ? actor : undefined },
    };
    for (const ch of changes) {
      if (ch.deleted) {
        deleteDocument(ch.doc);
        continue;
      }
      if (ch.retiredFor) {
        // The move protocol receivers already follow: stamp, then let go.
        await withDoc(ch.doc, context, (doc) => {
          doc.getMap('syncMeta').set('movedTo', ch.retiredFor);
        });
        continue;
      }
      if (ch.revived) reviveDocument(ch.doc);
      await withDoc(ch.doc, context, (doc) => {
        const meta = doc.getMap('syncMeta');
        if (ch.path && meta.get('path') !== ch.path) meta.set('path', ch.path);
        if (meta.has('movedTo')) meta.delete('movedTo');
        for (const lane of LANE_NAMES) {
          if (!(lane in ch.lanes)) continue;
          applyLane(
            doc,
            lane,
            ch.lanes[lane],
            lane === 'annotations' ? { writeId: ch.writeId } : {}
          );
        }
        if ('html' in ch.lanes) meta.set('bodyEditAt', Date.now());
        if ('annotations' in ch.lanes) meta.set('annotationsEditAt', Date.now());
        meta.set('acceptedRevision', revision);
      });
    }
    state = { ...state, revision };
    try {
      onAccepted({ revision, changes, dirs });
    } catch (err) {
      log.error?.(`[transactions] onAccepted failed: ${err.message}`);
    }
  }

  const kernel = createKernel({
    store,
    projectId,
    applyAccepted,
    canvasGroups,
    designRel,
    log,
  });

  /**
   * Re-apply accepted heads to their documents — boot, and after a publish
   * failure. The store is the authority; a document is a replica of it.
   */
  async function reconcile() {
    state = await store.state();
    if (state.mode !== 'transactions') return { reconciled: 0 };
    const manifest = await store.manifest();
    let reconciled = 0;
    for (const d of manifest.docs) {
      if (d.retired) continue;
      const lanes = {};
      for (const lane of LANE_NAMES) {
        const hash = d.lanes[lane]?.hash;
        lanes[lane] = hash ? ((await store.blob(hash)) ?? '') : '';
      }
      await withDoc(d.doc, { accepted: { reconcile: true } }, (doc) => {
        const meta = doc.getMap('syncMeta');
        if (d.path && meta.get('path') !== d.path) meta.set('path', d.path);
        if (meta.has('movedTo')) meta.delete('movedTo');
        let touched = false;
        for (const lane of LANE_NAMES) touched = applyLane(doc, lane, lanes[lane]) || touched;
        if (touched) meta.set('acceptedRevision', manifest.revision);
      });
      reconciled++;
    }
    return { reconciled };
  }

  async function refresh() {
    state = await store.state();
    return state;
  }

  /** Synchronous — Hocuspocus hooks cannot wait on the store. */
  const acceptedMode = () => state.mode === 'transactions';

  /**
   * Hocuspocus `beforeHandleMessage`: decide read-only on EVERY message, from
   * the current mode and the credential's own right — so a switch takes
   * effect on sockets that are already open (no reconnect needed, which a
   * multiplexed socket would not do on a per-document close), and a switch
   * back to legacy restores write access to exactly the credentials that had
   * it.
   */
  function fence({ connection, context }) {
    if (!connection) return;
    connection.readOnly = acceptedMode() || context?.user?.readOnly === true;
  }

  /** A mode switch in progress — proposals wait for it (see `setMode`). */
  let switching = Promise.resolve();

  /**
   * Switch the project's save mode. THE ORDER IS THE SAFETY ARGUMENT:
   *
   *   1. persist the new mode + epoch;
   *   2. tell every connected peer ON ITS OWN SOCKET (a stateless message);
   *      from the moment it arrives the peer proposes instead of writing;
   *   3. wait one grace round trip — a write the peer sent BEFORE the notice
   *      reached it is still in flight, and is applied, not dropped;
   *   4. raise the fence — enforced per message on every open socket, so no
   *      socket is closed (a multiplexed provider does not re-attach after a
   *      per-document close, and would silently stop receiving);
   *   5. import the documents' final state as accepted actions (T30), and
   *   6. reconcile the documents to the store.
   *
   * Proposals wait on the switch, so none is judged against a store that does
   * not hold the imported documents yet.
   */
  function setMode({ mode, expectEpoch }) {
    const run = async () => {
      const next = await store.setMode({ mode, expectEpoch });
      const notice = JSON.stringify({ type: 'maude.mode', mode: next.mode, epoch: next.epoch });
      try {
        for (const document of server.hocuspocus?.documents?.values?.() ?? []) {
          document.broadcastStateless(notice);
        }
      } catch (err) {
        log.warn?.(`[transactions] mode notice not delivered everywhere: ${err.message}`);
      }
      if (switchGraceMs > 0) await new Promise((r) => setTimeout(r, switchGraceMs));
      state = { ...state, ...next };
      if (mode !== 'transactions') return next;
      // IMPORT BEFORE RECONCILE — reconciling first would roll back any
      // document the store already knew with content from a legacy interval.
      const imported = await importBaseline({
        hocuspocus: server.hocuspocus,
        store,
        kernel,
        projectId,
        listDocuments,
        tombstoned,
        checkoutPath,
        checkoutBody,
        checkoutDirs,
        canvasGroups,
        designRel,
      });
      if (imported.skipped.length || imported.failed) {
        log.warn?.(
          `[transactions] baseline import: ${imported.created} created, ${imported.updated} updated, ${imported.dirs} folders; skipped ${imported.skipped.length}${imported.failed ? `; FAILED at chunk ${imported.failed.chunk} (${imported.failed.code})` : ''}`
        );
      }
      await reconcile();
      return { ...next, imported };
    };
    const p = switching.then(run, run);
    switching = p.catch(() => {});
    return p;
  }

  async function readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * `/api/projects/:project/v1/<route>[/<id>]`. Returns true when handled.
   * `auth(request)` → `{ actor, readOnly, scope, admin }` or null.
   */
  async function handleRoutes({ path, method, query, request, auth, respondJson }) {
    const m = ROUTE.exec(path);
    if (!m) return false;
    const [, project, route, id] = m;
    const who = auth(request);
    if (!who) {
      respondJson(401, { error: 'sign in to this project first', code: 'unauthenticated' });
      return true;
    }
    if (project !== projectId && project !== 'current') {
      respondJson(404, { error: 'no such project', code: 'unknown-project' });
      return true;
    }
    try {
      if (route === 'bootstrap' && method === 'GET') {
        const manifest = await kernel.bootstrap();
        respondJson(200, {
          protocol: 1,
          projectId,
          ...manifest,
          capabilities: {
            lanes: LANE_NAMES,
            operations: [
              'lane.replace',
              'doc.create',
              'doc.move',
              'doc.delete',
              'dir.create',
              'dir.move',
              'dir.delete',
              'history.undo',
              'history.redo',
              'history.restore',
            ],
          },
          limits: { proposalBytes: MAX_BODY_BYTES - 1024 * 1024 },
          you: { actor: who.actor, readOnly: !!who.readOnly },
        });
        return true;
      }
      if (route === 'proposals' && method === 'POST') {
        const bytes = await readBody(request);
        await switching;
        const { status, body } = await kernel.submit(bytes, {
          actor: who.actor,
          readOnly: who.readOnly,
        });
        respondJson(status, body);
        return true;
      }
      if (route === 'transactions' && method === 'GET' && id) {
        const r = await kernel.transaction(who.actor, id);
        respondJson(r ? 200 : 404, r ?? { code: 'absent' });
        return true;
      }
      if (route === 'revisions' && method === 'GET') {
        const after = Number.parseInt(query.after ?? '0', 10);
        const limit = Number.parseInt(query.limit ?? '200', 10);
        const revisions = await kernel.revisions({
          after: Number.isFinite(after) ? after : 0,
          limit: Number.isFinite(limit) ? limit : 200,
        });
        const s = await kernel.state();
        respondJson(200, { revision: s.revision, epoch: s.epoch, mode: s.mode, revisions });
        return true;
      }
      if (route === 'history' && method === 'GET') {
        const before = query.before ? Number.parseInt(query.before, 10) : null;
        const limit = Number.parseInt(query.limit ?? '50', 10);
        const history = await kernel.history({
          before: Number.isFinite(before) ? before : null,
          limit: Number.isFinite(limit) ? limit : 50,
          entry: typeof query.entry === 'string' ? query.entry.slice(0, 128) : null,
        });
        respondJson(200, { history });
        return true;
      }
      if (route === 'blobs' && method === 'GET' && id) {
        const body = /^[0-9a-f]{64}$/.test(id) ? await kernel.blob(id) : null;
        respondJson(
          body === null ? 404 : 200,
          body === null ? { code: 'absent' } : { hash: id, body }
        );
        return true;
      }
      if (route === 'mode' && method === 'GET') {
        respondJson(200, await kernel.state());
        return true;
      }
      if (route === 'mode' && method === 'POST') {
        if (!who.admin) {
          respondJson(403, {
            error: 'only the project owner can switch the save mode',
            code: 'forbidden',
          });
          return true;
        }
        const body = JSON.parse(await readBody(request));
        if (body?.mode !== 'transactions' && body?.mode !== 'legacy') {
          respondJson(400, { code: 'invalid' });
          return true;
        }
        respondJson(200, await setMode({ mode: body.mode, expectEpoch: body.expectEpoch }));
        return true;
      }
      respondJson(405, { code: 'method-not-allowed' });
      return true;
    } catch (err) {
      log.error?.(`[transactions] ${route} failed: ${err.message}`);
      respondJson(err.status ?? 503, { code: err.code ?? 'retryable' });
      return true;
    }
  }

  return {
    kernel,
    reconcile,
    refresh,
    acceptedMode,
    fence,
    setMode,
    handleRoutes,
    get state() {
      return state;
    },
  };
}
