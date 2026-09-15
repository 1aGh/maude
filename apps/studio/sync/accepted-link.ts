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

import { createActionStage, type StageSummary } from './action-stage.ts';
import type { AcceptedLaneLink, LaneProposal, ProposalOutcome } from './projection.ts';
import {
  type Bootstrap,
  createTransactionClient,
  type Operation,
  type ProposalResult,
  type TransactionClient,
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
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
  onPending?: (count: number) => void;
  onStats?: (stats: TransactionStats) => void;
  onResult?: (result: ProposalResult, action: { label: string; operations: Operation[] }) => void;
  retryMs?: number;
  /** Injected client (tests). */
  client?: TransactionClient;
  /** T16 — an AI action opened, was held, or ended. */
  onStage?: (summary: StageSummary | null) => void;
  /** Every bootstrap the project answered (its manifest and its own config). */
  onBootstrap?: (b: Bootstrap) => void;
}

export type StructuralOutcome = ProposalOutcome & { queued?: boolean };

const LANE_LABEL: Record<LaneProposal['lane'], string> = {
  html: 'Edit canvas',
  css: 'Edit styles',
  meta: 'Edit layout',
  annotations: 'Edit annotations',
  comments: 'Edit comments',
};

export function createAcceptedLink(opts: AcceptedLinkOptions) {
  const log = opts.log ?? console;
  const client =
    opts.client ??
    createTransactionClient({
      hubUrl: opts.hubUrl,
      token: opts.token,
      designRoot: opts.designRoot,
      fetchImpl: opts.fetchImpl,
      log,
      onPending: opts.onPending,
      onStats: opts.onStats,
      onResult: opts.onResult,
      retryMs: opts.retryMs,
    });

  let mode: AcceptedMode = 'unknown';
  let manifest: Bootstrap | null = null;

  // T16 — AI and multi-file action boundaries (see action-stage.ts).
  const stage = createActionStage({
    designRoot: opts.designRoot,
    propose: (action) => client.propose(action),
    newTransactionId: client.newTransactionId,
    onChange: opts.onStage,
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
      mode = next;
      manifest = b;
      opts.onBootstrap?.(b);
      return b;
    } catch (err) {
      if (err instanceof TransactionError && err.code === 'absent') mode = 'legacy';
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
    if (next !== mode) log.log(`[sync/tx] the project switched its save mode: ${mode} → ${next}`);
    mode = next;
  }

  const outcome = (r: ProposalResult): ProposalOutcome => ({
    status: r.status,
    ...(r.code ? { code: r.code } : {}),
    ...(typeof r.head === 'string' ? { head: r.head } : {}),
    ...(typeof r.actionId === 'string' ? { actionId: r.actionId } : {}),
  });

  function laneLink(slug: string): AcceptedLaneLink {
    return {
      on,
      newTransactionId: client.newTransactionId,
      propose: (p) => {
        const doc = opts.docNameFor(slug);
        if (stage.captures(slug, p.stageable === true)) return stage.capture(slug, doc, p);
        const send = (dependsOn: string[] | undefined) =>
          client
            .propose({
              kind: 'edit',
              label: LANE_LABEL[p.lane],
              transactionId: p.transactionId,
              dependsOn,
              operations: [
                {
                  op: 'lane.replace',
                  doc,
                  lane: p.lane,
                  content: p.content,
                  baseContent: p.baseContent,
                  ...(p.writeId ? { writeId: p.writeId } : {}),
                },
              ],
            })
            .then(outcome);
        if (stage.holdsDependency(p.dependsOn)) {
          // Authored on top of an agent's unpublished bytes: it waits behind
          // the stage, and goes out right after the group (or is discarded
          // with it).
          return new Promise<ProposalOutcome>((resolve, reject) => {
            stage.wait({
              dependsOn: p.dependsOn ?? [],
              send: (d) => void send(d).then(resolve, reject),
              drop: resolve,
            });
          });
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
  function structural(
    label: string,
    kind: string,
    operations: Operation[],
    waitMs: number
  ): Promise<StructuralOutcome> {
    const answer = client.propose({ kind, label, operations }).then(outcome);
    if (!Number.isFinite(waitMs)) return answer;
    return Promise.race([
      answer,
      new Promise<StructuralOutcome>((resolve) =>
        setTimeout(() => resolve({ status: 'accepted', queued: true }), waitMs)
      ),
    ]);
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
      return structural(
        'Create canvas',
        'canvas.create',
        [{ op: 'doc.create', doc: opts.docNameFor(slug), path: rel, lanes: clean }],
        waitMs
      );
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
    /** Logical history, newest first (optionally one entry's). */
    history(q: { limit?: number; before?: number | null; entry?: string | null }) {
      const params: Record<string, string | number> = { limit: q.limit ?? 50 };
      if (q.before) params.before = q.before;
      if (q.entry) params.entry = q.entry;
      return client.read('history', params) as Promise<{ history: HistoryAction[] }>;
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
    /** Personal undo / redo of one of this actor's actions. */
    undo(actionId: string, redo = false): Promise<StructuralOutcome> {
      return structural(
        redo ? 'Redo' : 'Undo',
        redo ? 'redo' : 'undo',
        [{ op: redo ? 'history.redo' : 'history.undo', actionId }],
        8_000
      );
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
  undoes: string | null;
  effects: {
    doc: string | null;
    lane: string;
    op: string;
    beforePath: string | null;
    afterPath: string | null;
  }[];
}

export type AcceptedLink = ReturnType<typeof createAcceptedLink>;
