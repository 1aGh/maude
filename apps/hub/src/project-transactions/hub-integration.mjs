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
import { applyLane, LANE_NAMES, laneHash, readLane } from './lanes.mjs';

export const ACCEPTED_ORIGIN = 'maude-accepted';
const ROUTE =
  /^\/api\/projects\/([A-Za-z0-9._-]{1,128})\/v1\/([a-z-]+)(?:\/([A-Za-z0-9_-]{1,128}))?$/;
export const MAX_BODY_BYTES = 17 * 1024 * 1024;

/** More than this many proposals waiting on a switch are told to retry. */
const MAX_WAITING_PROPOSALS = 64;

export function createAcceptedRevisions({
  server,
  store,
  projectId,
  canvasGroups,
  /** The project's own labels and design systems, for copies that were
   *  declared without them (a managed desktop copy) — `{ canvasGroups:
   *  [{label, path}], designSystems: [{name, path, tokensCssRel?}] }`. */
  projectConfig = () => null,
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
  /** False when the store sits on a disposable disk — see setMode. */
  storeDurable = true,
  /**
   * The hub supervises a browser studio that is NOT a paired participant
   * (workspace mode without MAUDE_CELL_PAIRING). Its edits never become
   * accepted actions, so this hub must not take proposals: the switch is
   * refused, and an accepted project that boots this way says so loudly.
   */
  browserUnpaired = false,
  /** Does the checkout hold any canvas? (A brand-new project holds none.) */
  checkoutHasCanvases = () => false,
  /** Waits between attempts to resume an unfinished import (tests shorten them). */
  resumeBackoffMs = [2_000, 5_000, 15_000, 30_000, 60_000],
  /** …and how many (≈ 10 minutes with the default waits). */
  resumeAttempts = 13,
  log = console,
}) {
  let state = { mode: 'legacy', epoch: 0, revision: 0 };
  // T19/T29 — the coordinator's own readiness and counters, apart from the
  // renderer's: a project can accept edits while its studio child restarts,
  // and a studio can render while the store is failing.
  let ready = false;
  let storeError = null;
  const metrics = createAcceptedMetrics();

  async function withDoc(name, context, fn) {
    const conn = await server.hocuspocus.openDirectConnection(name, context);
    try {
      await conn.transact(fn);
    } finally {
      await conn.disconnect();
    }
  }

  // T29 — RENDER REVISION LAG, measured where it can actually be wrong.
  //
  // `state.revision` is what the store has durably accepted. What a person
  // SEES is whatever `applyAccepted` last finished writing into the documents
  // every renderer reads. Those two are the same number in the happy path and
  // diverge exactly when it matters: publish runs strictly after the durable
  // commit and a failure there does not undo the acceptance (kernel.mjs), so
  // a hub can be accepting work nobody is being shown. Until now nothing
  // measured that gap — an operator could only see the accepted number, which
  // is the one that is never behind.
  let renderedRevision = 0;
  let renderedAt = null;
  // NOT a render failure: `onAccepted` only tells the rest of the hub that
  // documents changed. Counted separately so a quiet notify fault is visible
  // without being mistaken for content nobody can see.
  let notifyFailures = 0;

  async function applyAccepted({ revision, actionId, changes, dirs, actor }) {
    const context = {
      accepted: { revision, actionId },
      user: { name: actor, email: actor.includes('@') ? actor : undefined },
    };
    // T14 — how many documents this revision writes content into, so a
    // receiver can show them together (studio sync/revision-barrier.ts).
    const cohort = changes.filter((ch) => !ch.deleted && !ch.retiredFor).length;
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
        meta.set('acceptedCohort', cohort);
        meta.set('acceptedRevision', revision);
      });
    }
    state = { ...state, revision };
    // Reached only when every document above was written. A throw on the way
    // here leaves `renderedRevision` behind, which is the whole point.
    renderedRevision = Math.max(renderedRevision, revision);
    renderedAt = Date.now();
    try {
      onAccepted({ revision, changes, dirs });
    } catch (err) {
      notifyFailures++;
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
    // A cell's store is a round trip away, so the old loop — every lane of
    // every document fetched one after the other, even where the document
    // already held the head — was most of a switch's time (G2: ~130 canvases,
    // 55 s through the Durable Object). Now a lane is fetched only when the
    // document differs from its head, and documents go eight at a time.
    const one = async (d) => {
      const held = {};
      await withDoc(d.doc, { accepted: { reconcile: true } }, (doc) => {
        for (const lane of LANE_NAMES) held[lane] = readLane(doc, lane);
      });
      const lanes = {};
      for (const lane of LANE_NAMES) {
        const hash = d.lanes[lane]?.hash;
        if (!hash) lanes[lane] = '';
        else if (held[lane] && laneHash(held[lane]) === hash) lanes[lane] = held[lane];
        else lanes[lane] = (await store.blob(hash)) ?? '';
      }
      await withDoc(d.doc, { accepted: { reconcile: true } }, (doc) => {
        const meta = doc.getMap('syncMeta');
        if (d.path && meta.get('path') !== d.path) meta.set('path', d.path);
        if (meta.has('movedTo')) meta.delete('movedTo');
        let touched = false;
        for (const lane of LANE_NAMES) touched = applyLane(doc, lane, lanes[lane]) || touched;
        if (touched) {
          // A repair, not an action — nothing to wait for on the receiver.
          meta.set('acceptedCohort', 1);
          meta.set('acceptedRevision', manifest.revision);
        }
      });
      reconciled++;
    };
    const live = manifest.docs.filter((d) => !d.retired);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, live.length) }, async () => {
        while (next < live.length) await one(live[next++]);
      })
    );
    return { reconciled };
  }

  let warnedUnpaired = false;
  async function refresh() {
    try {
      state = await store.state();
      ready = true;
      storeError = null;
      if (browserUnpaired && state.mode === 'transactions' && !warnedUnpaired) {
        warnedUnpaired = true;
        log.error?.(
          '[transactions] this project saves through accepted revisions, but the browser studio is NOT a participant (MAUDE_CELL_PAIRING is off): browser edits will not reach the project. Set MAUDE_CELL_PAIRING=1 and restart the hub.'
        );
      }
    } catch (err) {
      storeError = err.message;
      throw err;
    }
    return state;
  }

  /** Synchronous snapshot for `/health` (the probe cannot await the store). */
  function health({ privileged = false } = {}) {
    const known = ready && !storeError;
    const base = {
      ready: known,
      // Not a claim the probe cannot back: before the store answers, `state`
      // holds a default, and reporting that default as the project's mode told
      // a fleet sweep a waking cell was in `legacy` when it was not.
      mode: known ? state.mode : 'unknown',
      protocol: 1,
      durable: !!storeDurable,
    };
    if (!privileged) return base;
    return {
      ...base,
      epoch: state.epoch,
      revision: state.revision,
      browserPaired: !browserUnpaired,
      // Bounded: three numbers and a timestamp, no per-document cardinality.
      render: {
        revision: renderedRevision,
        lag: Math.max(0, state.revision - renderedRevision),
        at: renderedAt,
        notifyFailures,
      },
      ...(storeError ? { storeError } : {}),
      ...metrics.snapshot(),
    };
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
    // AN UNKNOWN MODE FENCES. `state` starts at the `legacy` default and only
    // becomes a reading when the store answers; until then "not transactions"
    // is an assumption, not a fact. On a hub whose store is LOCAL that window
    // is microseconds, which is why the boot comment in server.mjs reasoned it
    // away — but a cloud cell's store is a Durable Object across the network,
    // it cold-starts constantly, and it listens before the read resolves.
    // Observed on a live cell: `/health` answered `mode: "legacy"` seconds
    // after boot and `transactions` moments later. A peer reconnecting into
    // that window was handed a writable socket on a project that accepts only
    // proposals — two writable authorities, which is the one thing this design
    // forbids outright. Fail closed: nobody writes until the mode is known.
    connection.readOnly = !ready || acceptedMode() || context?.user?.readOnly === true;
  }

  /** A mode switch in progress — proposals wait for it (see `setMode`). */
  let switching = Promise.resolve();
  /** Proposals held behind a switch — bounded, each one an open request. */
  let waitingProposals = 0;

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
    // A new decision by the owner outranks a resume still in progress.
    cancelResume?.();
    if (mode === 'transactions' && browserUnpaired) {
      return Promise.reject(
        Object.assign(
          new Error(
            'the browser studio on this hub is not a project participant (MAUDE_CELL_PAIRING is off), so its edits would never become accepted actions — set MAUDE_CELL_PAIRING=1 and restart the hub first'
          ),
          { status: 409, code: 'browser-not-paired' }
        )
      );
    }
    if (mode === 'transactions' && !storeDurable) {
      return Promise.reject(
        Object.assign(
          new Error(
            'this hub has no durable project store (its data directory is disposable) — configure MAUDE_PROJECT_STORE_URL or a persistent data volume first'
          ),
          { status: 409, code: 'store-not-durable' }
        )
      );
    }
    const run = async () => {
      const next = await store.setMode({ mode, expectEpoch });
      // Per connection, with that connection's write right after the switch:
      // the fence re-decides per message, but a peer admitted read-only while
      // the project took proposals learns it may write again only from this
      // (F3 S17, 2026-09-23 — its legacy saves after a rollback were held
      // silently until it happened to reconnect).
      const notice = (writable) =>
        JSON.stringify({ type: 'maude.mode', mode: next.mode, epoch: next.epoch, writable });
      let undelivered = 0;
      let lastError = null;
      for (const document of server.hocuspocus?.documents?.values?.() ?? []) {
        for (const connection of document.getConnections?.() ?? []) {
          try {
            const writable =
              next.mode !== 'transactions' && connection.context?.user?.readOnly !== true;
            connection.sendStateless(notice(writable));
          } catch (err) {
            // One gone peer must not keep the notice from the rest.
            undelivered += 1;
            lastError = err;
          }
        }
      }
      if (undelivered > 0) {
        log.warn?.(
          `[transactions] mode notice not delivered to ${undelivered} connection(s): ${lastError?.message}`
        );
      }
      if (switchGraceMs > 0) await new Promise((r) => setTimeout(r, switchGraceMs));
      state = { ...state, ...next };
      // A switch that the store accepted IS a reading of the mode — the most
      // authoritative one there is. Without this the fence would stay closed
      // after a switch on a coordinator whose first refresh had not run.
      ready = true;
      if (mode !== 'transactions') {
        answer(next);
        return;
      }
      // IMPORT BEFORE RECONCILE — reconciling first would roll back any
      // document the store already knew with content from a legacy interval.
      try {
        const imported = await importAndReconcile();
        // The state AFTER the import — `next` still carries step 1's note.
        answer({ ...next, importPending: !!state.importPending, imported });
      } catch (err) {
        // A store call that failed mid-import (a transport blip on a cell) left
        // the switch half done, and nothing retried it until the next start
        // (F3 on the cloud cell, reproduced on the cloud-shaped fixture as
        // "mode failed: fetch failed"). The owner is told the truth now; the
        // import keeps resuming, and proposals keep waiting for it, until it
        // lands.
        log.warn?.(
          `[transactions] the switch's import did not finish (${err.message}) — resuming it until it does`
        );
        answer({ ...next, importPending: true, importResuming: true, reason: err.message });
        await resumeUntilImported();
      }
    };
    let answer;
    const answered = new Promise((resolve) => {
      answer = resolve;
    });
    const p = switching.then(run, run);
    switching = p.catch(() => {});
    // `p` rejecting before an answer (the store refused the mode itself)
    // rejects the caller; an answer given first stands.
    return Promise.race([answered, p.then(() => answered)]);
  }

  /**
   * The import, then the reconcile. A TRANSIENT failure (a store call that
   * threw, or a chunk refused as `retryable`) is thrown for the caller to
   * resume; a chunk the kernel refused for good is returned as it was before —
   * resuming it forever would hold every proposal behind it.
   */
  async function importAndReconcile() {
    const imported = await runBaselineImport();
    if (imported.failed && imported.failed.code === 'retryable') {
      throw Object.assign(
        new Error(`import incomplete at chunk ${imported.failed.chunk} (${imported.failed.code})`),
        { imported }
      );
    }
    await reconcile();
    return imported;
  }

  /**
   * Resume an unfinished import until it lands (the import creates only what
   * the store lacks, so every attempt is safe). Backoff 2 s → 60 s; stops when
   * the project is no longer in accepted mode or the import is noted done.
   */
  // BOUNDED, AND NEVER IN THE OWNER'S WAY (security review M1). The kernel
  // reports every failed store commit as `retryable`, including ones that will
  // never succeed (a value over the store's size limit), so an unbounded loop
  // held every proposal — and the owner's own switch back to legacy, queued
  // behind it — forever. Now it gives up after `resumeAttempts` (proposals are
  // released; the import stays noted pending for the next start, bounded the
  // same way), and any new setMode cancels it at once.
  let cancelResume = null;
  async function resumeUntilImported() {
    let cancelled = false;
    let wake = null;
    cancelResume = () => {
      cancelled = true;
      wake?.();
    };
    try {
      for (let attempt = 0; attempt < resumeAttempts; attempt++) {
        await new Promise((r) => {
          wake = r;
          const t = setTimeout(r, resumeBackoffMs[Math.min(attempt, resumeBackoffMs.length - 1)]);
          t.unref?.();
        });
        if (cancelled) return null;
        try {
          const s = await store.state();
          state = { ...state, ...s };
          if (s.mode !== 'transactions') return null;
          if (!s.importPending) {
            await reconcile();
            return null;
          }
          const imported = await importAndReconcile();
          log.log?.(
            `[transactions] resumed import: ${imported.created} created, ${imported.updated} updated, ${imported.dirs} folders`
          );
          return imported;
        } catch (err) {
          log.warn?.(`[transactions] import still unfinished (${err.message}) — retrying`);
        }
      }
      log.error?.(
        `[transactions] the import did not finish after ${resumeAttempts} attempts — proposals are no longer held for it; the next start resumes it. Check the store (a value over its size limit, credentials).`
      );
      return null;
    } finally {
      cancelResume = null;
    }
  }

  /**
   * The baseline import, and the store's note that it finished. A chunk the
   * kernel refused leaves the note set, so the next start resumes it.
   */
  async function runBaselineImport() {
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
    if (!imported.failed) {
      const after = await store.markImported();
      state = { ...state, ...after };
    }
    return imported;
  }

  /**
   * T30 — a switch whose process died between persisting the mode and
   * finishing the import. Boot finishes it (the import is idempotent against
   * the store: it creates only what the store lacks) BEFORE reconciling, so no
   * document a peer still holds is left outside the project. A project that
   * finished its import is never re-imported here — in accepted mode a
   * document is a replica, and a stale one must not overwrite its head.
   */
  async function resumeImport() {
    const s = await store.state();
    state = { ...state, ...s };
    if (s.mode !== 'transactions' || !s.importPending) return null;
    log.warn?.('[transactions] the last switch did not finish importing — resuming it now');
    try {
      const imported = await importAndReconcile();
      log.log?.(
        `[transactions] resumed import: ${imported.created} created, ${imported.updated} updated, ${imported.dirs} folders`
      );
      return imported;
    } catch (err) {
      // Not "until the next start" again: keep resuming in this process, and
      // hold proposals behind it exactly as a switch does.
      log.warn?.(`[transactions] resumed import did not finish (${err.message}) — retrying`);
      const done = resumeUntilImported();
      switching = switching.then(() => done).catch(() => {});
      return { resuming: true, reason: err.message };
    }
  }

  /**
   * A BRAND-NEW project starts in accepted revisions (MAUDE_NEW_PROJECT_MODE,
   * followup-multiplayer-hardening G3a): legacy is only as durable as the last
   * backup generation on a cloud cell, and a project that never had legacy
   * content has nothing to migrate. Brand new means the store never switched
   * (epoch 0, revision 0) and neither the hub's documents nor the checkout hold
   * a canvas — anything else waits for the owner's switch. The switch is the
   * owner's path, with its every guard (durable store, paired browser studio).
   */
  async function adoptNewProjectMode(initialMode) {
    if (initialMode !== 'transactions') return null;
    const s = await store.state();
    if (s.mode !== 'legacy' || s.epoch !== 0 || s.revision !== 0) return null;
    const docs = listDocuments().filter(({ name }) => name !== 'maude.files');
    if (docs.length || checkoutHasCanvases()) {
      log.log?.(
        '[transactions] new-project mode skipped — the project already has canvases; the owner switches it'
      );
      return { skipped: 'has-canvases' };
    }
    try {
      const next = await setMode({ mode: 'transactions', expectEpoch: 0 });
      log.log?.(
        `[transactions] a new project — it saves through accepted revisions from the start (epoch ${next.epoch})`
      );
      return next;
    } catch (err) {
      log.error?.(`[transactions] new-project mode not applied: ${err.message}`);
      return { skipped: err.code ?? 'refused' };
    }
  }

  /** T30 — what switching to accepted revisions WOULD import (no write). */
  async function previewSwitch() {
    return importBaseline({
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
      dryRun: true,
    });
  }

  /**
   * T30 — byte parity after (or instead of) a switch: every live document's
   * lanes against the store head, and its source against the checkout. Reads
   * only; a mismatch is reported, never repaired here.
   */
  async function parity() {
    const s = await store.state();
    const manifest = await store.manifest();
    const out = { mode: s.mode, revision: manifest.revision, checked: 0, mismatches: [] };
    for (const d of manifest.docs) {
      if (d.retired) continue;
      out.checked += 1;
      const conn = await server.hocuspocus.openDirectConnection(d.doc, {
        accepted: { parity: true },
      });
      const lanes = {};
      try {
        await conn.transact((doc) => {
          for (const lane of LANE_NAMES) lanes[lane] = readLane(doc, lane);
        });
      } finally {
        await conn.disconnect();
      }
      for (const lane of LANE_NAMES) {
        const head = d.lanes[lane]?.hash ?? null;
        const live = lanes[lane] ? laneHash(lanes[lane]) : null;
        if (head !== live)
          out.mismatches.push({ doc: d.doc, path: d.path, lane, where: 'document' });
      }
      const body = d.path ? checkoutBody(d.path) : null;
      if (body !== null && d.lanes.html?.hash && laneHash(body) !== d.lanes.html.hash) {
        out.mismatches.push({ doc: d.doc, path: d.path, lane: 'html', where: 'checkout' });
      }
    }
    out.ok = out.mismatches.length === 0;
    return out;
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
          // The project's declared canvas groups (workspace checkouts), so a
          // brand-new managed copy can be declared before its first pull.
          canvasGroups: (typeof canvasGroups === 'function' ? canvasGroups() : null) ?? null,
          projectConfig: projectConfig() ?? null,
          ...manifest,
          capabilities: {
            lanes: LANE_NAMES,
            // DDR-242 — the annotations lane is the v2 board (JSON, '' = empty).
            annotationsFormat: 2,
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
        // Refuse, and wait, BEFORE the body is read (security review, chain
        // 2): a switch or a resume holds proposals, and each waiting request
        // would otherwise pin a body of up to 17 MB in memory — a viewer could
        // run the hub out of memory while it waited.
        if (who.readOnly) {
          respondJson(403, {
            protocol: 1,
            status: 'rejected',
            code: 'forbidden',
            reason: 'this account can view but not edit',
          });
          return true;
        }
        if (waitingProposals >= MAX_WAITING_PROPOSALS) {
          respondJson(503, { protocol: 1, status: 'rejected', code: 'retryable' });
          return true;
        }
        waitingProposals += 1;
        try {
          await switching;
        } finally {
          waitingProposals -= 1;
        }
        const bytes = await readBody(request);
        const t0 = performance.now();
        const { status, body } = await kernel.submit(bytes, {
          actor: who.actor,
          readOnly: who.readOnly,
        });
        metrics.record(body, performance.now() - t0);
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
      if (route === 'lane' && method === 'GET') {
        // A lane as it stood at a revision — the history preview's source.
        const doc = typeof query.doc === 'string' ? query.doc.slice(0, 300) : '';
        const lane = typeof query.lane === 'string' ? query.lane : 'html';
        const rev = Number.parseInt(query.rev ?? '', 10);
        if (!doc || !LANE_NAMES.includes(lane) || !Number.isSafeInteger(rev) || rev < 0) {
          respondJson(400, { code: 'invalid' });
          return true;
        }
        const hash = await kernel.laneAt(doc, lane, rev);
        const body = hash ? await kernel.blob(hash) : '';
        respondJson(200, { doc, lane, revision: rev, hash, body: body ?? '' });
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
      if (route === 'parity' && method === 'GET') {
        if (!who.admin) {
          respondJson(403, {
            error: 'only the project owner can run a parity check',
            code: 'forbidden',
          });
          return true;
        }
        respondJson(200, await parity());
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
        if (body.dryRun === true) {
          // Preflight: the import this switch would commit — nothing persists.
          respondJson(200, {
            dryRun: true,
            mode: state.mode,
            epoch: state.epoch,
            imported: await previewSwitch(),
            ...(browserUnpaired ? { blockers: ['browser-not-paired'] } : {}),
          });
          return true;
        }
        respondJson(200, await setMode({ mode: body.mode, expectEpoch: body.expectEpoch }));
        return true;
      }
      respondJson(405, { code: 'method-not-allowed' });
      return true;
    } catch (err) {
      log.error?.(
        `[transactions] ${route} failed: ${err.message}\n${String(err.stack ?? '')
          .split('\n')
          .slice(1, 4)
          .join('\n')}`
      );
      // A stale epoch is the caller's view, not the hub's health: retrying the
      // same request can never succeed, so it is a conflict, not a 503.
      respondJson(err.status ?? (err.code === 'epoch-stale' ? 409 : 503), {
        code: err.code ?? 'retryable',
        ...(err.status && err.status < 500 ? { error: err.message } : {}),
      });
      return true;
    }
  }

  return {
    kernel,
    reconcile,
    resumeImport,
    adoptNewProjectMode,
    refresh,
    acceptedMode,
    fence,
    setMode,
    handleRoutes,
    health,
    previewSwitch,
    parity,
    get state() {
      return state;
    },
  };
}

/**
 * Bounded counters for the operator — counts by outcome and rejection code,
 * and the durable acknowledgment latency (submit → committed answer, which is
 * what a person waits for before "Saved"). Never payloads, paths or actors.
 */
export function createAcceptedMetrics({ window = 256, maxCodes = 24 } = {}) {
  let accepted = 0;
  let replayed = 0;
  const rejected = {};
  const ack = [];
  let lastAt = null;
  const pct = (sorted, q) =>
    sorted.length
      ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10
      : null;
  return {
    record(result, ms) {
      lastAt = Date.now();
      if (result?.status === 'accepted') {
        if (result.replay) replayed++;
        else accepted++;
        ack.push(ms);
        if (ack.length > window) ack.shift();
      } else {
        let code = typeof result?.code === 'string' ? result.code.slice(0, 40) : 'unknown';
        // Bounded cardinality: the kernel's codes are a small fixed set, but a
        // counter keyed by anything must not grow without limit.
        if (!(code in rejected) && Object.keys(rejected).length >= maxCodes) code = 'other';
        rejected[code] = (rejected[code] ?? 0) + 1;
      }
    },
    snapshot() {
      const sorted = [...ack].sort((a, b) => a - b);
      return {
        proposals: { accepted, replayed, rejected: { ...rejected } },
        ackMs: {
          p50: pct(sorted, 0.5),
          p95: pct(sorted, 0.95),
          p99: pct(sorted, 0.99),
          n: sorted.length,
        },
        lastProposalAt: lastAt,
      };
    },
  };
}
