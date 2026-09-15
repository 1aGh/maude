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

import type { AcceptedLaneLink, LaneProposal, ProposalOutcome } from './projection.ts';
import {
  type Bootstrap,
  createTransactionClient,
  type Operation,
  type ProposalResult,
  type TransactionClient,
  TransactionError,
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
  onResult?: (result: ProposalResult, action: { label: string; operations: Operation[] }) => void;
  retryMs?: number;
  /** Injected client (tests). */
  client?: TransactionClient;
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
      onResult: opts.onResult,
      retryMs: opts.retryMs,
    });

  let mode: AcceptedMode = 'unknown';
  let manifest: Bootstrap | null = null;

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
      return b;
    } catch (err) {
      if (err instanceof TransactionError && err.code === 'absent') mode = 'legacy';
      return null;
    }
  }

  const on = (): boolean => mode === 'transactions';

  const outcome = (r: ProposalResult): ProposalOutcome => ({
    status: r.status,
    ...(r.code ? { code: r.code } : {}),
    ...(typeof r.head === 'string' ? { head: r.head } : {}),
  });

  function laneLink(slug: string): AcceptedLaneLink {
    return {
      on,
      newTransactionId: client.newTransactionId,
      propose: (p) =>
        client
          .propose({
            kind: 'edit',
            label: LANE_LABEL[p.lane],
            transactionId: p.transactionId,
            dependsOn: p.dependsOn,
            operations: [
              {
                op: 'lane.replace',
                doc: opts.docNameFor(slug),
                lane: p.lane,
                content: p.content,
                baseContent: p.baseContent,
                ...(p.writeId ? { writeId: p.writeId } : {}),
              },
            ],
          })
          .then(outcome),
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
    stop() {
      client.stop();
    },
  };
}

export type AcceptedLink = ReturnType<typeof createAcceptedLink>;
