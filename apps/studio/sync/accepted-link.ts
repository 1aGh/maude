// The studio's side of accepted revisions — DDR-241 §3, plan T13–T17.
//
// One object per sync runtime. It knows whether the linked project is in
// `transactions` mode (asked, never assumed: a hub without the route is a
// legacy hub), and it turns every persistent change the studio makes into a
// proposal through the durable transaction client:
//
//   • lane values   — text/CSS/meta/comments/annotations, via `laneLink(slug)`
//                     handed to each canvas's projection;
//   • the manifest  — canvas create/move/delete and folder create/move/delete.
//
// Nothing here writes a Y.Doc. The documents change when the hub publishes the
// accepted revision, through the same providers that deliver a peer's edit.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { TrashListing } from '../history/trash.ts';
import { type ActionStageOptions, createActionStage, type StageSummary } from './action-stage.ts';
import { recordConflicts, recordFromResult } from './conflict-record.ts';
import type {
  AcceptedLaneLink,
  HeldObjectConflict,
  LaneProposal,
  ProposalOutcome,
} from './projection.ts';
import {
  type Bootstrap,
  createTransactionClient,
  type Operation,
  type ProposalResult,
  type Reservation,
  type TransactionClient,
  type TransactionClientOptions,
  TransactionError,
  type TransactionStats,
} from './transaction-client.ts';

export type AcceptedMode = 'unknown' | 'legacy' | 'transactions';

export interface AcceptedLinkOptions {
  hubUrl: string;
  token: () => string | null;
  designRoot: string;
  docNameFor: (slug: string) => string;
  fetchImpl?: typeof fetch;
  /** V2-1.12 §5.6 — hold proposals in the outbox while format-gated. */
  paused?: () => boolean;
  /** V2-1.12 §5.4 — the format a proposal is WRITTEN in (recorded per entry). */
  declaredFormat?: () => number;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
  onPending?: (count: number) => void;
  onStats?: (stats: TransactionStats) => void;
  onResult?: (result: ProposalResult, action: { label: string; operations: Operation[] }) => void;
  retryMs?: number;
  /** Injected client (tests). */
  client?: TransactionClient;
  /** T16 — an AI action opened, was held, or ended. */
  onStage?: (summary: StageSummary | null) => void;
  /** S5.5 — the artboards a staged canvas write changed (V2-1.5 §5.7), for the run's `touched`. */
  attribute?: ActionStageOptions['attribute'];
  /** Every bootstrap the project answered (its manifest and its own config). */
  onBootstrap?: (b: Bootstrap) => void;
  /** S6.13b — a refused create whose name a peer took (see the transaction client). */
  onCreateConflict?: TransactionClientOptions['onCreateConflict'];
  /** S6.13b — test seam, passed to the transaction client. */
  fault?: (point: string) => void;
}

export type StructuralOutcome = ProposalOutcome & { queued?: boolean };

/**
 * S6.13 (V2-1.14 fix 5.12d) — the create window's note on disk:
 * `_state/outbox/<createdAt>-<tx>.creates.ndjson`, line 1 the reservation,
 * then one `doc.create` per line, appended BEFORE the create is answered.
 * Sealed into `<createdAt>-<tx>.json` (the same place in the chain) when the
 * window closes. Not a `.json` name, so the transaction client never reads it
 * as a proposal; `outbox/content.ts` counts it for the O4 watermark.
 */
export const CREATE_NOTE_RE = /^(\d+)-(tx_[A-Za-z0-9]+)\.creates\.ndjson$/;
const TX_RE = /^tx_[A-Za-z0-9]+$/;

const LANE_LABEL: Record<LaneProposal['lane'], string> = {
  html: 'Edit canvas',
  css: 'Edit styles',
  meta: 'Edit layout',
  annotations: 'Edit annotations',
  comments: 'Edit comments',
};

/**
 * S9.24 — the elements the kernel held at the head's version (`merged[].conflicts`), shape-checked:
 * the answer is the hub's, and only a well-formed record may reach the card.
 */
export function heldObjects(r: ProposalResult): { objectConflicts?: HeldObjectConflict[] } {
  const out: HeldObjectConflict[] = [];
  const isRec = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  for (const m of Array.isArray(r.merged) ? r.merged : []) {
    const list = (m as { conflicts?: unknown }).conflicts;
    if (!Array.isArray(list)) continue;
    for (const c of list.slice(0, 200)) {
      if (!isRec(c) || typeof c.id !== 'string' || typeof c.type !== 'string') continue;
      out.push({
        id: c.id,
        type: c.type,
        fields: Array.isArray(c.fields)
          ? c.fields.filter((f): f is string => typeof f === 'string')
          : [],
        mine: isRec(c.mine) ? c.mine : null,
        theirs: isRec(c.theirs) ? c.theirs : null,
      });
    }
  }
  return out.length ? { objectConflicts: out } : {};
}

export function createAcceptedLink(opts: AcceptedLinkOptions) {
  const log = opts.log ?? console;
  const client =
    opts.client ??
    createTransactionClient({
      hubUrl: opts.hubUrl,
      token: opts.token,
      designRoot: opts.designRoot,
      fetchImpl: opts.fetchImpl,
      ...(opts.paused ? { paused: opts.paused } : {}),
      ...(opts.declaredFormat ? { declaredFormat: opts.declaredFormat } : {}),
      log,
      onPending: opts.onPending,
      onStats: opts.onStats,
      // S9.24 — every final answer, a replay after a restart included (nobody awaits that one):
      // held object conflicts go to _state/conflicts/ so the card survives (sync/conflict-record.ts).
      onResult: (result, action) => {
        recordFromResult(opts.designRoot, result);
        opts.onResult?.(result, action);
      },
      retryMs: opts.retryMs,
      ...(opts.onCreateConflict ? { onCreateConflict: opts.onCreateConflict } : {}),
      ...(opts.fault ? { fault: opts.fault } : {}),
    });

  const outboxDir = path.join(opts.designRoot, '_state', 'outbox');
  // The durable window needs a client that can hold a place in the chain
  // (an injected test client may not).
  const durable = typeof client.reserve === 'function' && typeof client.persist === 'function';
  const createLabel = (n: number) => (n === 1 ? 'Create canvas' : `Add ${n} canvases`);

  /**
   * A previous process's create window, recovered at boot: a note whose seal
   * exists is that same change (dropped); otherwise its creates are written
   * as the proposal the window would have sealed — same transaction, same
   * place, same link — and the drain delivers it with the rest. A torn last
   * line is a create that was never acknowledged.
   */
  function recoverCreateNotes(): void {
    if (!durable) return;
    let names: string[] = [];
    try {
      names = readdirSync(outboxDir).filter((n) => CREATE_NOTE_RE.test(n));
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const file = path.join(outboxDir, name);
      try {
        const [head, ...rest] = readFileSync(file, 'utf8').split('\n');
        const r = JSON.parse(head ?? '') as Partial<Reservation> & { v?: number };
        const ops: Operation[] = [];
        for (const line of rest) {
          try {
            const op = JSON.parse(line) as Operation;
            if (op && op.op === 'doc.create') ops.push(op);
          } catch {
            /* the torn tail of a crash */
          }
        }
        const valid =
          r.v === 1 &&
          typeof r.transactionId === 'string' &&
          TX_RE.test(r.transactionId) &&
          typeof r.createdAt === 'number' &&
          typeof r.link === 'string' &&
          (r.projectId === null || typeof r.projectId === 'string');
        if (valid && ops.length && !existsSync(client.entryFile(r as Reservation))) {
          client.persist(
            { kind: 'canvas.create', label: createLabel(ops.length), operations: ops },
            r as Reservation
          );
        }
        rmSync(file, { force: true });
      } catch (err) {
        // Kept: the next boot tries again. Never deleted unread.
        log.warn(
          `[sync/tx] a queued canvas create could not be recovered yet: ${(err as Error).message}`
        );
      }
    }
  }
  recoverCreateNotes();

  // Every proposal this link sends goes out AFTER the creates queued before it
  // (a lane edit of a canvas being added must never overtake its doc.create on
  // the serialized queue); see `queueCreate` below.
  const propose: TransactionClient['propose'] = (action) => {
    flushCreates();
    // A proposal about a canvas whose batched create is still unanswered waits
    // until that create is settled or re-queued on its own: a refused batch
    // falls back to one create each, and those must stay AHEAD of it.
    const waits = [
      ...new Set(
        action.operations
          .map((op) => (typeof op.doc === 'string' ? createsInFlight.get(op.doc) : undefined))
          .filter((w): w is Promise<void> => !!w)
      ),
    ];
    if (!waits.length) return client.propose(action);
    return Promise.all(waits).then(() => client.propose(action));
  };

  // THE LAST VERDICT SURVIVES A RESTART (F3/S06). Held only in memory, a
  // desktop that restarted without the network came back 'unknown', treated
  // its offline edits as legacy shared-document writes, and the hub fenced
  // those raw updates: the work never reached the project while the status
  // read "synced". The hub still has the last word — the next bootstrap
  // replaces this — but until it answers, the answer it last gave stands.
  // Keyed by hub, so a relinked copy starts from 'unknown' again.
  const modeFile = path.join(opts.designRoot, '_state', 'accepted-mode.json');
  const loadMode = (): AcceptedMode => {
    try {
      const v = JSON.parse(readFileSync(modeFile, 'utf8'));
      if (v?.v === 1 && v.hub === opts.hubUrl && (v.mode === 'transactions' || v.mode === 'legacy'))
        return v.mode;
    } catch {
      /* absent or unreadable — ask the hub */
    }
    return 'unknown';
  };
  const saveMode = (next: AcceptedMode): void => {
    if (next === 'unknown') return;
    try {
      mkdirSync(path.dirname(modeFile), { recursive: true });
      const tmp = `${modeFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, hub: opts.hubUrl, mode: next, at: Date.now() }));
      renameSync(tmp, modeFile);
    } catch {
      /* the in-memory verdict still holds for this run */
    }
  };
  let mode: AcceptedMode = loadMode();
  let manifest: Bootstrap | null = null;

  // T16 — AI and multi-file action boundaries (see action-stage.ts).
  const stage = createActionStage({
    designRoot: opts.designRoot,
    propose: (action) => propose(action),
    newTransactionId: client.newTransactionId,
    onChange: opts.onStage,
    ...(opts.attribute ? { attribute: opts.attribute } : {}),
    log,
  });
  stage.restore();

  /**
   * Ask the hub which protocol this project speaks. A network failure keeps
   * the previous verdict — flapping into legacy while the hub is unreachable
   * would let a local write bypass the proposal lane.
   */
  async function refresh(): Promise<Bootstrap | null> {
    try {
      const b = await client.bootstrap();
      const next: AcceptedMode = b.mode === 'transactions' ? 'transactions' : 'legacy';
      if (next !== mode && mode !== 'unknown') {
        log.log(`[sync/tx] project save mode changed: ${mode} → ${next}`);
      }
      if (next !== mode) saveMode(next);
      mode = next;
      manifest = b;
      opts.onBootstrap?.(b);
      return b;
    } catch (err) {
      if (err instanceof TransactionError && err.code === 'absent') {
        if (mode !== 'legacy') saveMode('legacy');
        mode = 'legacy';
      }
      return null;
    }
  }

  const on = (): boolean => mode === 'transactions';

  /**
   * The hub announced a mode change on a document socket. Believed at once —
   * it is the hub's own word, delivered before it closes the socket — and
   * confirmed by the next `refresh()`.
   */
  function noteMode(next: 'transactions' | 'legacy'): void {
    if (next !== mode) {
      log.log(`[sync/tx] the project switched its save mode: ${mode} → ${next}`);
      saveMode(next);
    }
    mode = next;
  }

  const outcome = (r: ProposalResult): ProposalOutcome => ({
    status: r.status,
    ...(r.code ? { code: r.code } : {}),
    ...(typeof r.head === 'string' ? { head: r.head } : {}),
    ...(typeof r.actionId === 'string' ? { actionId: r.actionId } : {}),
    ...heldObjects(r),
  });

  /** S2.20c — a waiting edit's transaction id → its final outcome (its inverse lands after it). */
  const waitingOutcome = new Map<string, Promise<ProposalOutcome>>();

  /**
   * Put a person's edit in the stage's waiting list (V2-1.5 §5.4 "pending"): it goes out when no
   * run holds what it depends on — `go` sends it — or is answered `discarded` with its run.
   */
  function waitBehind(
    p: LaneProposal,
    slug: string,
    label: string,
    madeAt: number,
    dependsOn: string[],
    go: () => Promise<ProposalOutcome>
  ): Promise<ProposalOutcome> {
    const answer = new Promise<ProposalOutcome>((resolve, reject) => {
      stage.wait({
        dependsOn,
        send: () => void go().then(resolve, reject),
        drop: resolve,
        edit: {
          transactionId: p.transactionId,
          slug,
          lane: p.lane,
          label,
          madeAt,
          content: p.content,
          baseContent: p.baseContent,
          ...(p.undoes ? { undoes: p.undoes } : {}),
        },
      });
    });
    waitingOutcome.set(p.transactionId, answer);
    const forget = () => waitingOutcome.delete(p.transactionId);
    answer.then(forget, forget);
    return answer;
  }

  function laneLink(slug: string): AcceptedLaneLink {
    return {
      on,
      newTransactionId: client.newTransactionId,
      propose: (p) => {
        const doc = opts.docNameFor(slug);
        if (stage.captures(slug, p.stageable === true, p.content))
          return stage.capture(slug, doc, p);
        const send = (dependsOn: string[] | undefined, madeAt?: number) =>
          propose({
            kind: 'edit',
            label: LANE_LABEL[p.lane],
            transactionId: p.transactionId,
            dependsOn,
            ...(madeAt ? { origin: { madeAt } } : {}),
            operations: [
              {
                op: 'lane.replace',
                doc,
                lane: p.lane,
                content: p.content,
                baseContent: p.baseContent,
                ...(p.writeId ? { writeId: p.writeId } : {}),
                // S9.24 — an element both sides changed is held, never char-merged into a third
                // text nobody wrote (sync/object-conflict.ts). A v1 hub ignores the field.
                ...(p.lane === 'annotations' ? { objects: 'hold' } : {}),
              },
            ],
          }).then((r) => {
            const o = outcome(r);
            // S9.24 — the answer's own producer of the card (the onResult one covers a replay).
            if (o.status === 'accepted' && o.objectConflicts)
              recordConflicts(opts.designRoot, slug, o.objectConflicts, {
                ...(o.actionId ? { actionId: o.actionId } : {}),
              });
            return o;
          });
        if (p.undoes) {
          // S2.20c — ⌘Z on a waiting edit: its inverse waits behind the same run, right after it
          // (decision v2-lead-pending-inverse-via-stage), and lands as THAT edit's undo once the
          // edit has an action — so history reads "Undo" of it and ⇧⌘Z can take the undo back.
          const target = waitingOutcome.get(p.undoes);
          if (!target || !stage.holdsDependency([p.undoes]))
            return Promise.resolve({ status: 'rejected', code: 'not-pending' });
          const madeAt = Date.now();
          const undo = async (): Promise<ProposalOutcome> => {
            const o = await target;
            // The edit never landed (refused, discarded with its run): nothing to take back —
            // the accepted version returns to disk.
            if (o.status !== 'accepted' || !o.actionId)
              return { status: 'rejected', code: 'discarded' };
            const r = await propose({
              kind: 'undo',
              label: 'Undo',
              transactionId: p.transactionId,
              origin: { madeAt },
              operations: [{ op: 'history.undo', actionId: o.actionId }],
            });
            return outcome(r);
          };
          return waitBehind(p, slug, 'Undo', madeAt, [...(p.dependsOn ?? []), p.undoes], undo);
        }
        if (stage.holdsDependency(p.dependsOn)) {
          // Authored on top of an agent's unpublished bytes: it waits behind
          // the stage, and goes out right after the group (or is discarded
          // with it). It is the person's edit, made NOW: `origin.madeAt` keeps
          // its place in their ⌘Z stack when it lands behind the run (V2-1.5 U2).
          const madeAt = Date.now();
          return waitBehind(p, slug, LANE_LABEL[p.lane], madeAt, p.dependsOn ?? [], () =>
            send(stage.mapDeps(p.dependsOn), madeAt)
          );
        }
        return send(stage.mapDeps(p.dependsOn));
      },
    };
  }

  /**
   * A structural action, answered within `waitMs` or reported as QUEUED: the
   * proposal stays in the durable outbox and lands when the hub is reachable
   * (the client delivers in creation order, so a later edit cannot overtake
   * it). The caller proceeds with its local change either way — the designer
   * never waits on the network to move a canvas.
   */
  // ONE PROPOSAL FOR A BURST OF NEW CANVASES. A fresh link adds every local
  // canvas the project does not have, each from its own cold start, all at
  // once; sent one by one they are that many round trips on the one
  // serialized transaction queue, and the first edit waits behind all of them
  // (F3 S14 on the cloud cell: 77 creates, 44 s). Creates that arrive within a
  // short window travel together; a refused batch falls back to one proposal
  // each, so one canvas the project will not take cannot hold back the rest.
  const CREATE_WINDOW_MS = 25;
  const CREATE_BATCH_MAX = 100;
  const CREATE_BATCH_BYTES = 4 * 1024 * 1024;
  type PendingCreate = { op: Operation; bytes: number; resolve: (o: ProposalOutcome) => void };
  let createBatch: PendingCreate[] = [];
  let createBatchBytes = 0;
  let createTimer: ReturnType<typeof setTimeout> | null = null;
  /** The open window's place in the chain and its note (S6.13). */
  let createNote: { r: Reservation; file: string } | null = null;
  /** doc → the gate a batched create of it holds until settled or re-queued. */
  const createsInFlight = new Map<string, Promise<void>>();
  const proposeCreates = (ops: Operation[], reservation?: Reservation) =>
    client
      .propose({
        kind: 'canvas.create',
        label: createLabel(ops.length),
        operations: ops,
        ...(reservation ? { reservation } : {}),
      })
      .then(outcome);
  /** Note one create on disk before it is answered (fix 5.12d). */
  function noteCreate(op: Operation): void {
    if (!durable) return;
    try {
      let head = '';
      if (!createNote) {
        const r = client.reserve();
        createNote = {
          r,
          file: path.join(outboxDir, `${r.createdAt}-${r.transactionId}.creates.ndjson`),
        };
        mkdirSync(outboxDir, { recursive: true });
        head = `${JSON.stringify({ v: 1, ...r })}\n`;
      }
      appendFileSync(createNote.file, `${head}${JSON.stringify(op)}\n`);
    } catch (err) {
      log.warn(`[sync/tx] could not note a canvas create on disk: ${(err as Error).message}`);
    }
  }
  function flushCreates(): void {
    if (createTimer) clearTimeout(createTimer);
    createTimer = null;
    const batch = createBatch;
    const note = createNote;
    createBatch = [];
    createBatchBytes = 0;
    createNote = null;
    if (!batch.length) return;
    const docs = batch.map((c) => c.op.doc).filter((d): d is string => typeof d === 'string');
    let settled: () => void = () => {};
    const gate = new Promise<void>((r) => {
      settled = r;
    });
    for (const d of docs) createsInFlight.set(d, gate);
    const release = () => {
      for (const d of docs) if (createsInFlight.get(d) === gate) createsInFlight.delete(d);
      settled();
    };
    const fail = (err: unknown) => {
      release();
      for (const c of batch)
        c.resolve({ status: 'rejected', code: (err as TransactionError)?.code ?? 'failed' });
    };
    // Sealed into the reserved place (written synchronously by `propose`);
    // the note goes only once the proposal is on disk.
    const sealed = proposeCreates(
      batch.map((c) => c.op),
      note?.r
    );
    if (note && existsSync(client.entryFile(note.r))) rmSync(note.file, { force: true });
    void sealed.then((o) => {
      if (o.status === 'accepted' || batch.length === 1) {
        release();
        for (const c of batch) c.resolve(o);
        return;
      }
      // Each create is queued (and so ahead of anything waiting on the gate)
      // before the gate opens.
      const each = batch.map((c) => proposeCreates([c.op]));
      release();
      each.forEach((answer, i) => void answer.then(batch[i].resolve, () => batch[i].resolve(o)));
    }, fail);
  }
  function queueCreate(op: Operation): Promise<ProposalOutcome> {
    const bytes = Buffer.byteLength(JSON.stringify(op), 'utf8');
    if (
      createBatch.length &&
      (createBatch.length >= CREATE_BATCH_MAX || createBatchBytes + bytes > CREATE_BATCH_BYTES)
    )
      flushCreates();
    noteCreate(op);
    return new Promise((resolve) => {
      createBatch.push({ op, bytes, resolve });
      createBatchBytes += bytes;
      createTimer ??= setTimeout(flushCreates, CREATE_WINDOW_MS);
    });
  }

  function structural(
    label: string,
    kind: string,
    operations: Operation[],
    waitMs: number,
    origin?: { trashed?: Array<{ artboard: string; label?: string }> },
    tx?: { transactionId?: string; dependsOn?: string[] }
  ): Promise<StructuralOutcome> {
    const answer = propose({
      kind,
      label,
      operations,
      ...(origin ? { origin } : {}),
      ...(tx?.transactionId ? { transactionId: tx.transactionId } : {}),
      ...(tx?.dependsOn?.length ? { dependsOn: tx.dependsOn } : {}),
    }).then(outcome);
    if (!Number.isFinite(waitMs)) return answer;
    return Promise.race([
      answer,
      new Promise<StructuralOutcome>((resolve) =>
        setTimeout(() => resolve({ status: 'accepted', queued: true }), waitMs)
      ),
    ]);
  }

  /**
   * S10.3b — lanes of SEVERAL canvases as ONE action (a design-system publish: the followers'
   * metas, the DS canvas's `dsPending`, the TSX `data-ds-rev` strips). One proposal on the
   * durable content lane (V2-1.14: the outbox holds it until the hub answers), so the hub
   * commits it as one attributed action and one ⌘Z takes every lane back together. Answered
   * when the hub answers — never reported as queued: the caller writes its off-lane half
   * (`head.json`) only after an acceptance that carries the action id.
   */
  function docsEdit(
    edits: Array<{
      slug: string;
      lane: LaneProposal['lane'];
      content: string;
      baseContent: string;
    }>,
    action: {
      kind: string;
      label: string;
      writeId?: string;
      /** S2.10b — an artboard-trash action names what it removed (S1-trash.md §2) */
      origin?: { trashed?: Array<{ artboard: string; label?: string }> };
      /** p8-fix-c2 — the id (and dependency) a projection assigned (`DocProjection.proposeVia`) */
      transactionId?: string;
      dependsOn?: string[];
    }
  ): Promise<StructuralOutcome> {
    return structural(
      action.label,
      action.kind,
      edits.map((e) => ({
        op: 'lane.replace',
        doc: opts.docNameFor(e.slug),
        lane: e.lane,
        content: e.content,
        baseContent: e.baseContent,
        ...(action.writeId ? { writeId: action.writeId } : {}),
      })),
      Number.POSITIVE_INFINITY,
      action.origin?.trashed?.length ? { trashed: action.origin.trashed } : undefined,
      { transactionId: action.transactionId, dependsOn: action.dependsOn }
    );
  }

  return {
    client,
    refresh,
    on,
    get mode(): AcceptedMode {
      return mode;
    },
    /** The last bootstrap answer — manifest dirs and docs at that revision. */
    get manifest(): Bootstrap | null {
      return manifest;
    },
    laneLink,
    noteMode,
    /** T16 — AI action boundaries. */
    stage,
    createDoc(
      slug: string,
      rel: string,
      lanes: Partial<Record<LaneProposal['lane'], string>>,
      waitMs = Number.POSITIVE_INFINITY
    ): Promise<StructuralOutcome> {
      const clean: Record<string, string> = {};
      for (const [lane, v] of Object.entries(lanes)) if (v) clean[lane] = v;
      const answer = queueCreate({
        op: 'doc.create',
        doc: opts.docNameFor(slug),
        path: rel,
        lanes: clean,
      });
      if (!Number.isFinite(waitMs)) return answer;
      return Promise.race([
        answer,
        new Promise<StructuralOutcome>((resolve) =>
          setTimeout(() => resolve({ status: 'accepted', queued: true }), waitMs)
        ),
      ]);
    },
    deleteDoc(slug: string, waitMs = 8_000): Promise<StructuralOutcome> {
      return structural(
        'Delete canvas',
        'canvas.delete',
        [{ op: 'doc.delete', doc: opts.docNameFor(slug) }],
        waitMs
      );
    },
    moveDoc(slug: string, toRel: string, waitMs = 8_000): Promise<StructuralOutcome> {
      return structural(
        'Move canvas',
        'canvas.move',
        [{ op: 'doc.move', doc: opts.docNameFor(slug), to: { path: toRel } }],
        waitMs
      );
    },
    dirCreate(rel: string, waitMs = 8_000): Promise<StructuralOutcome> {
      return structural(
        'Create folder',
        'folder.create',
        [{ op: 'dir.create', path: rel }],
        waitMs
      );
    },
    /** Several folders in ONE action (a cold start publishing local folders). */
    dirsCreate(rels: string[], waitMs = Number.POSITIVE_INFINITY): Promise<StructuralOutcome> {
      return structural(
        rels.length === 1 ? 'Create folder' : `Add ${rels.length} folders`,
        'folder.create',
        rels.map((path) => ({ op: 'dir.create', path })),
        waitMs
      );
    },
    dirDelete(rel: string, waitMs = 8_000): Promise<StructuralOutcome> {
      return structural(
        'Delete folder',
        'folder.delete',
        [{ op: 'dir.delete', path: rel }],
        waitMs
      );
    },
    dirMove(from: string, to: string, waitMs = 8_000): Promise<StructuralOutcome> {
      return structural('Move folder', 'folder.move', [{ op: 'dir.move', from, to }], waitMs);
    },
    /**
     * S4.7 — several lanes of ONE canvas as ONE action (a sticky ↔ comment
     * conversion: `annotations` + `comments`). One proposal, so one undo
     * restores every lane together (contract S4-S9-votes-comments §3.2).
     */
    lanesEdit(
      slug: string,
      lanes: Array<{ lane: LaneProposal['lane']; content: string; baseContent: string }>,
      action: {
        kind: string;
        label: string;
        writeId?: string;
        /** S2.10b — an artboard-trash action names what it removed (S1-trash.md §2) */
        origin?: { trashed?: Array<{ artboard: string; label?: string }> };
        transactionId?: string;
        dependsOn?: string[];
      }
    ): Promise<StructuralOutcome> {
      return docsEdit(
        lanes.map((l) => ({ slug, ...l })),
        action
      );
    },
    docsEdit,
    /** Logical history, newest first (optionally one entry's). */
    history(q: {
      limit?: number;
      before?: number | null;
      entry?: string | null;
      chat?: string | null;
      kind?: string | null;
      actor?: string | null;
    }) {
      const params: Record<string, string | number> = { limit: q.limit ?? 50 };
      if (q.before) params.before = q.before;
      if (q.entry) params.entry = q.entry;
      // S5.1a filters — an old hub ignores them (the caller re-checks rows).
      if (q.chat) params.chat = q.chat;
      if (q.kind) params.kind = q.kind;
      if (q.actor) params.actor = q.actor;
      return client.read('history', params) as Promise<{ history: HistoryAction[] }>;
    },
    /**
     * p8-hub-undo-collision — a lane body the hub holds, by hash (null: not served / unreachable).
     * The blob read is gated by the hub exactly like the history rows that name the hash.
     */
    async blob(hash: string): Promise<string | null> {
      if (!/^[0-9a-f]{64}$/.test(hash)) return null;
      const b = (await client.read(`blobs/${hash}`, {})) as { body?: unknown };
      return typeof b?.body === 'string' ? b.body : null;
    },
    /** p8-hub-undo-collision — a doc's lane at the hub's newest revision (what an undo merges onto). */
    async laneHead(doc: string, lane: LaneProposal['lane']): Promise<string | null> {
      const r = (await client.read('lane', { doc, lane, rev: Number.MAX_SAFE_INTEGER })) as {
        body?: unknown;
      };
      return typeof r?.body === 'string' ? r.body : null;
    },
    /** A canvas lane as it stood at `revision`. */
    laneAt(slug: string, lane: LaneProposal['lane'], revision: number) {
      return client.read('lane', { doc: opts.docNameFor(slug), lane, rev: revision }) as Promise<{
        body: string;
        hash: string | null;
      }>;
    },
    /** Restore canvases to a revision — a NEW action; nothing is rewound. */
    restore(slugs: string[], revision: number, label: string): Promise<StructuralOutcome> {
      return structural(
        label,
        'history.restore',
        [{ op: 'history.restore', revision, docs: slugs.map((s) => opts.docNameFor(s)) }],
        8_000
      );
    },
    /**
     * S1.13 — one artboard / one object / a kept-aside version back (V2-1.9 §5.8): the lanes the
     * studio computed, as ONE `restore` action; each carries the head it read as `baseContent`, so
     * the hub merges three-way onto whatever landed since (a conflict → `base-conflict`).
     */
    restoreLanes(
      slug: string,
      lanes: { lane: LaneProposal['lane']; content: string; baseContent: string }[],
      label: string
    ): Promise<StructuralOutcome> {
      const doc = opts.docNameFor(slug);
      return structural(
        label,
        'restore',
        lanes.map((l) => ({
          op: 'lane.replace',
          doc,
          lane: l.lane,
          content: l.content,
          baseContent: l.baseContent,
        })),
        8_000
      );
    },
    /** S1.13 — the body a `history.aside` at exactly `revision` kept for `lane` (null: none). */
    async asideAt(slug: string, lane: LaneProposal['lane'], revision: number) {
      const doc = opts.docNameFor(slug);
      const r = (await client.read('revisions', { after: revision - 1, limit: 1 })) as {
        revisions?: {
          revision: number;
          effects?: { doc: string; lane: string; op: string; afterHash: string | null }[];
        }[];
      };
      const row = r.revisions?.[0];
      const e =
        row?.revision === revision
          ? row.effects?.find(
              (x) => x.lane === '@aside' && x.doc === doc && x.op === `aside.${lane}`
            )
          : undefined;
      if (!e?.afterHash || !/^[0-9a-f]{64}$/.test(e.afterHash)) return null;
      const b = (await client.read(`blobs/${e.afterHash}`, {})) as { body?: string };
      return typeof b.body === 'string' ? b.body : null;
    },
    /** S1.12b — name a version (`history.name`, S1-trash.md §3); `null` clears the name. */
    name(slug: string, revision: number, name: string | null): Promise<StructuralOutcome> {
      return structural(
        name ?? 'Name cleared',
        'name',
        [{ op: 'history.name', doc: opts.docNameFor(slug), revision, name }],
        8_000
      );
    },
    /** S1.12b — keep a version nobody kept (`history.aside`): a body, no head moves. */
    aside(
      slug: string,
      lane: 'html' | 'css' | 'meta' | 'annotations',
      content: string,
      label?: string
    ): Promise<StructuralOutcome> {
      return structural(
        label ?? 'Version not kept',
        'aside',
        [
          {
            op: 'history.aside',
            doc: opts.docNameFor(slug),
            lane,
            content,
            ...(label ? { label } : {}),
          },
        ],
        8_000
      );
    },
    /**
     * Personal undo / redo of this actor's actions: one id, or several as ONE
     * action (S5.1a `actionIds` — "as if they never happened"). The answer
     * keeps the kernel's `undoes` and `skipped` (lanes someone changed since).
     */
    undo(
      target: string | { actionId: string } | { actionIds: string[] },
      redo = false,
      label?: string
    ): Promise<
      StructuralOutcome & {
        undoes?: string | string[];
        skipped?: Array<{ doc?: string; lane?: string; reason: string; conflictWith?: string }>;
      }
    > {
      const ids = typeof target === 'string' ? { actionId: target } : target;
      const answer = propose({
        kind: redo ? 'redo' : 'undo',
        label: label ?? (redo ? 'Redo' : 'Undo'),
        operations: [{ op: redo ? 'history.redo' : 'history.undo', ...ids }],
      }).then((r) => ({
        ...outcome(r),
        ...(typeof r.undoes === 'string' || Array.isArray(r.undoes)
          ? { undoes: r.undoes as string | string[] }
          : {}),
        ...(Array.isArray(r.skipped) && r.skipped.length ? { skipped: r.skipped } : {}),
      }));
      return Promise.race([
        answer,
        new Promise<StructuralOutcome>((resolve) =>
          setTimeout(() => resolve({ status: 'accepted', queued: true }), 8_000)
        ),
      ]);
    },
    /**
     * S1.7b — does the project speak the shared Trash? Only a hub that lists
     * `trash.restore` + `trash.clear` in its bootstrap `capabilities.operations`
     * (S1-trash.md §3); an older hub answers null everywhere below, and the
     * Trash view falls back to this Mac's own list.
     */
    trashOps(): boolean {
      const ops = (manifest as { capabilities?: { operations?: unknown } } | null)?.capabilities
        ?.operations;
      return Array.isArray(ops) && ops.includes('trash.restore') && ops.includes('trash.clear');
    },
    /** `GET v1/trash` — the store's records, L18-filtered by the hub. */
    trash(): Promise<TrashListing> {
      return client.read('trash', {}) as Promise<TrashListing>;
    },
    /** `trash.restore { entry }` — one action; the canvas comes back with the same entry. */
    trashRestore(entry: string, label: string): Promise<StructuralOutcome> {
      return structural(label, 'restore', [{ op: 'trash.restore', entry }], 8_000);
    },
    /** `trash.clear { items? }` — the owner's clear-out (the kernel re-checks the role). */
    trashClear(
      items: string[] | undefined,
      label: string
    ): Promise<
      StructuralOutcome & { cleared?: string[]; skipped?: { id?: string; reason: string }[] }
    > {
      const answer = propose({
        kind: 'trash.clear',
        label,
        operations: [{ op: 'trash.clear', ...(items ? { items } : {}) }],
      }).then((r) => ({
        ...outcome(r),
        ...(Array.isArray(r.cleared) ? { cleared: r.cleared as string[] } : {}),
        ...(Array.isArray(r.skipped) && r.skipped.length
          ? { skipped: r.skipped as { id?: string; reason: string }[] }
          : {}),
      }));
      return Promise.race([
        answer,
        new Promise<StructuralOutcome>((resolve) =>
          setTimeout(() => resolve({ status: 'accepted', queued: true }), 8_000)
        ),
      ]);
    },
    stop() {
      client.stop();
    },
  };
}

export interface HistoryAction {
  revision: number;
  actor: string;
  actionId: string;
  kind: string;
  label: string | null;
  committedAt: number;
  undoes: string | string[] | null;
  /** The proposal's transaction id (store-core `actions.tx`). */
  tx?: string;
  /** The stored envelope origin (V2-1.5 §5.1 keys among them). */
  origin?: Record<string, unknown> | null;
  effects: {
    doc: string | null;
    /** The canvas's stable id (S1 Q6); a hub before it may leave it out. */
    entry?: string | null;
    lane: string;
    op: string;
    beforePath: string | null;
    afterPath: string | null;
    /** The lane body's hash before the effect (p8-hub-undo-collision reads it; an older hub may omit it). */
    beforeHash?: string | null;
    /** The lane body's hash after the effect (an `@aside` effect: the kept-aside body). */
    afterHash?: string | null;
  }[];
}

export type AcceptedLink = ReturnType<typeof createAcceptedLink>;
