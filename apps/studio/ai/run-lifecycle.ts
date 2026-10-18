// run-lifecycle.ts — the AI run records and the pure lifecycle reducer (V2-1.15 §5.1, §5.5).
//
// One row of §5.5 = one `(state, event)` case here. The reducer never does I/O: it returns the
// next record plus the side effects the registry (ai/runs.ts) carries out, in order. The lease
// home, the turn (ACP) and the stage (V2-1.5) are the registry's business, so every row is a
// unit test with no server.
//
// `RunPublic` is what every member sees. `publicRun` is the ONLY projection that leaves this Mac,
// and it never carries `prompt`, `question` or `doing` (V2-1.15 Decision D).

export type RunId = string;
export type AskId = string;
export const RUN_ID_RE = /^r_[A-Za-z0-9_-]{6,64}$/;
export const ASK_ID_RE = /^a_[A-Za-z0-9_-]{6,64}$/;

export interface LeaseKey {
  /** the kernel's stable doc `entry`, or `path:<repoRel>` before the op log has it */
  canvas: string;
  artboard: string;
}

export interface ElementRef extends LeaseKey {
  element: string;
  occurrence?: number;
}

export type RunState = 'waiting' | 'starting' | 'running' | 'needs-you' | 'ended';
export type RunOrigin = 'maude-chat' | 'claude-code' | 'design-edit';
export type RunOutcome = 'done' | 'stopped' | 'failed' | 'interrupted' | 'cancelled' | 'lease-lost';
export type StoppedBy = 'you' | 'quit' | 'close-tab' | 'crash' | 'sleep';

export interface RunScope {
  /** designRoot-relative canvas */
  canvas: string;
  artboards: string[] | '*';
  elements?: ElementRef[];
}

export interface RunPublic {
  runId: RunId;
  askId: AskId | null;
  actor: string;
  origin: RunOrigin;
  label: string;
  state: 'waiting' | 'running' | 'needs-you';
  artboards: LeaseKey[];
  waitingFor: Array<LeaseKey & { position: number }>;
  objects: ElementRef[];
  since: number;
}

/** `<designRoot>/_state/runs/<runId>.json` — per Mac, never synced. */
export interface RunRecord {
  v: 1;
  runId: RunId;
  askId: AskId;
  resumeOf?: RunId;
  continuationOf?: RunId;
  chatId: string | null;
  sessionId: string | null;
  origin: RunOrigin;
  actor: string;
  device: string;
  label: string;
  /** full text ONLY while queued / waiting — dropped the moment the turn is sent */
  prompt?: string;
  scope: RunScope | null;
  copyOf?: LeaseKey;
  state: RunState;
  leases: Array<LeaseKey & { token: number; provisional?: true }>;
  waiting: Array<LeaseKey & { position: number; heldBy: RunPublic | null }>;
  touched: Record<string, string[]>;
  objects: ElementRef[];
  doing?: string;
  question?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: RunOutcome;
  stoppedBy?: StoppedBy;
  /** studio-local: the chat-level line — this ask waits for that run of the same chat (§5.4) */
  behind?: RunId;
  /** studio-local: keys a multi-key ask could not get; they become continuation runs at its end */
  deferred?: LeaseKey[];
  /** studio-local: the last hook event of a hook-driven run (Q4: 120 s without one → lapse) */
  hookAt?: number;
  /** studio-local: who is doing it, for the derived v1 banner ("Claude Code", a v1 `author`) */
  agent?: string;
  /** studio-local: the home's run id after a lapse re-claim minted a new one (§5.9.4) */
  homeRunId?: string;
  /** studio-local: keys an edit/check denied `artboard-busy` — continued at the end (§5.5) */
  busyDenied?: LeaseKey[];
}

export type RunEvent =
  | { type: 'granted' }
  | { type: 'accepted' }
  | { type: 'ask-permission'; question: string }
  | { type: 'answered' }
  | { type: 'turn-end' }
  | { type: 'stop'; by: 'you' | 'quit' | 'close-tab' }
  | { type: 'cancel'; by?: 'you' | 'trash' }
  | { type: 'fail' }
  | { type: 'crash' }
  | { type: 'lease-lost' };

/**
 * What the registry does after a transition, in order:
 * - `send-turn`        hand the turn to the agent (ACP prompt / a continuation's generated turn)
 * - `renew`            report the new state to the lease home on the next renew
 * - `confirm`          confirm every provisional lease by CAS before anything is published (§5.6)
 * - `publish`          V2-1.5 publish of the run's stage with its `fence` (`partial` when stopped)
 * - `hold`             V2-1.5: keep the stage unpublished, for the person's decision
 * - `cancel-turn`      ACP cancel of the live turn
 * - `end-leases`       `runsEnd` — the line moves up
 * - `continuations`    one continuation run per key this run could not get
 */
export type RunEffect =
  | 'send-turn'
  | 'renew'
  | 'confirm'
  | 'publish'
  | 'publish-partial'
  | 'hold'
  | 'cancel-turn'
  | 'end-leases'
  | 'continuations';

export type Reduced = { rec: RunRecord; effects: RunEffect[] } | { refused: string };

const LIVE: ReadonlySet<RunState> = new Set(['waiting', 'starting', 'running', 'needs-you']);
export const isLive = (r: Pick<RunRecord, 'state'>) => LIVE.has(r.state);
/** a turn was sent: something may be staged */
const STARTED: ReadonlySet<RunState> = new Set(['starting', 'running', 'needs-you']);

function ended(rec: RunRecord, outcome: RunOutcome, t: number, stoppedBy?: StoppedBy): RunRecord {
  const next: RunRecord = {
    ...rec,
    state: 'ended',
    outcome,
    endedAt: t,
    leases: [],
    waiting: [],
  };
  delete next.prompt;
  delete next.question;
  delete next.behind;
  if (stoppedBy) next.stoppedBy = stoppedBy;
  return next;
}

/** §5.5, one case per row. Pure. */
export function reduceRun(rec: RunRecord, ev: RunEvent, t: number): Reduced {
  const s = rec.state;
  const refuse = () => ({ refused: `${ev.type} from ${s}` });
  switch (ev.type) {
    // waiting → starting: every wanted key granted, or a whole-canvas / multi-key ask with ≥ 1
    case 'granted': {
      if (s !== 'waiting') return refuse();
      const next: RunRecord = { ...rec, state: 'starting', waiting: [] };
      delete next.behind;
      return { rec: next, effects: ['send-turn'] };
    }
    // starting → running: the bridge accepted the prompt; the queued text is no longer kept
    case 'accepted': {
      if (s !== 'starting') return refuse();
      const next: RunRecord = { ...rec, state: 'running', startedAt: rec.startedAt ?? t };
      delete next.prompt;
      return { rec: next, effects: ['renew'] };
    }
    case 'ask-permission': {
      if (s !== 'running') return refuse();
      return {
        rec: { ...rec, state: 'needs-you', question: ev.question.slice(0, 500) },
        effects: ['renew'],
      };
    }
    case 'answered': {
      if (s !== 'needs-you') return refuse();
      const next: RunRecord = { ...rec, state: 'running' };
      delete next.question;
      return { rec: next, effects: ['renew'] };
    }
    // running / needs-you → ended:done: publish with the fence, release, continue what was busy
    case 'turn-end': {
      if (s !== 'running' && s !== 'needs-you') return refuse();
      return {
        rec: ended(rec, 'done', t),
        effects: ['confirm', 'publish', 'end-leases', 'continuations'],
      };
    }
    // any live → ended:stopped (a waiting ask on quit: stopped, unstarted — no turn, no publish)
    case 'stop': {
      if (!isLive(rec)) return refuse();
      if (s === 'waiting') {
        if (ev.by === 'you') return { rec: ended(rec, 'cancelled', t), effects: ['end-leases'] };
        return { rec: ended(rec, 'stopped', t, ev.by), effects: ['end-leases'] };
      }
      return {
        rec: ended(rec, 'stopped', t, ev.by),
        effects: ['cancel-turn', 'confirm', 'publish-partial', 'end-leases'],
      };
    }
    // waiting → ended:cancelled (Cancel, or the chat moved to the trash)
    case 'cancel': {
      if (s !== 'waiting') return refuse();
      return { rec: ended(rec, 'cancelled', t), effects: ['end-leases'] };
    }
    // running → ended:failed (error, token limit, adapter crash): the stage is held
    case 'fail': {
      if (!STARTED.has(s)) return refuse();
      return { rec: ended(rec, 'failed', t), effects: ['hold', 'end-leases'] };
    }
    // any live, found at boot → ended:interrupted
    case 'crash': {
      if (!isLive(rec)) return refuse();
      return {
        rec: ended(rec, 'interrupted', t, 'crash'),
        effects: STARTED.has(s) ? ['hold', 'end-leases'] : ['end-leases'],
      };
    }
    // lapsed + CAS re-claim failed, or a publish answered lease-fenced
    case 'lease-lost': {
      if (!isLive(rec)) return refuse();
      return {
        rec: ended(rec, 'lease-lost', t, 'sleep'),
        effects: STARTED.has(s) ? ['cancel-turn', 'hold', 'end-leases'] : ['end-leases'],
      };
    }
  }
}

/** The kit state of a live record as members see it (`starting` reads as running). */
function publicState(s: RunState): RunPublic['state'] {
  return s === 'waiting' ? 'waiting' : s === 'needs-you' ? 'needs-you' : 'running';
}

/** RunRecord → RunPublic. Whitelisted field by field: no prompt, question, doing, chat or session. */
export function publicRun(rec: RunRecord): RunPublic {
  return {
    runId: rec.runId,
    askId: rec.askId,
    actor: rec.actor,
    origin: rec.origin,
    label: rec.label,
    state: publicState(rec.state),
    artboards: rec.leases.map((l) => ({ canvas: l.canvas, artboard: l.artboard })),
    waitingFor: rec.waiting.map((w) => ({
      canvas: w.canvas,
      artboard: w.artboard,
      position: w.position,
    })),
    objects: rec.objects.map((o) => ({
      canvas: o.canvas,
      artboard: o.artboard,
      element: o.element,
      ...(o.occurrence !== undefined ? { occurrence: o.occurrence } : {}),
    })),
    since: rec.createdAt,
  };
}

/** What YOUR shell reads (`GET /_api/ai/runs` `mine`): the record minus the queued prompt. */
export type RunView = Omit<RunRecord, 'prompt' | 'sessionId' | 'hookAt' | 'homeRunId'>;
export function runView(rec: RunRecord): RunView {
  const { prompt: _p, sessionId: _s, hookAt: _h, homeRunId: _r, ...view } = rec;
  return view;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** `label` ≤ 80, control characters stripped (V2-1.15 §5.2 caps). */
export function cleanLabel(v: unknown): string {
  return typeof v === 'string'
    ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    : '';
}
