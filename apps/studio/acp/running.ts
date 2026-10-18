// A one-line registry so the HTTP layer can ask "is a chat mid-turn right now?"
// without `createHttp` growing an `Acp` parameter (feature-acp-write-path-scope
// Addendum, Task 9).
//
// WHY A REGISTRY AND NOT A PARAMETER: `createHttp` is called with six
// collaborators already and is constructed in `server.ts` alongside — not
// after — the ACP manager. Threading the manager in would churn the signature
// and every test that builds an Http, to expose ONE boolean-ish query. The
// alternative that was rejected outright is asking the CLIENT (ChatPanel
// already tracks per-chat busy state): a bridge can now be running DETACHED,
// with no socket and therefore no client that knows about it — which is
// precisely the case the branch-switch warning exists for. Client state would
// answer "no chat is running" at the exact moment the answer matters most.
//
// One dev-server process serves one project and calls `createAcp` once, so the
// single-slot shape is correct here rather than merely convenient. It is
// deliberately a PULL (a getter the manager registers), not a pushed snapshot:
// a snapshot would be stale by the time anyone read it, and "was a turn running
// a moment ago" is the wrong question to gate a `git checkout` on.

type RunningChatsProbe = () => string[];

let probe: RunningChatsProbe | null = null;

// S5.3 — the run registry (ai/runs.ts) is where a chat's run lives. Until S5.6 moves the ACP turn
// onto it, both questions below are answered by the UNION of the registry's live runs and the
// bridge probe: dropping the probe now would make the branch-switch warning lose every chat whose
// turn the registry has not seen yet.
interface LiveRun {
  chatId: string | null;
  state: 'waiting' | 'starting' | 'running' | 'needs-you' | 'ended';
}
type LiveRunsProbe = () => LiveRun[];

let liveRuns: LiveRunsProbe | null = null;

/** Registered once by server.ts with `registry.live`. A later call replaces the earlier one. */
export function registerLiveRuns(fn: LiveRunsProbe | null): void {
  liveRuns = fn;
}

function registryRuns(): LiveRun[] {
  try {
    return liveRuns?.() ?? [];
  } catch {
    return [];
  }
}

/** Registered once by `createAcp`. A later call replaces the earlier one — the
 *  last manager constructed is the live one. */
export function registerRunningChatsProbe(fn: RunningChatsProbe): void {
  probe = fn;
}

/** Chat ids with a turn in flight. Empty when no ACP manager exists at all
 *  (web serve without the panel, tests) — never throws, because a failure to
 *  answer must not block a branch switch. */
export function runningChats(): string[] {
  let bridged: string[];
  try {
    bridged = probe?.() ?? [];
  } catch {
    bridged = [];
  }
  // a waiting ask counts: it starts by itself, and would then write into the switched tree
  const fromRegistry = registryRuns().flatMap((r) =>
    r.chatId && r.state !== 'ended' ? [r.chatId] : []
  );
  return [...new Set([...bridged, ...fromRegistry])];
}

// feature-acp-turn-notifications Task 2 — a richer PULL registry alongside the
// one above, not a replacement: `runningChats()` stays exactly as it is for
// the branch-switch warning + the reaper's `has_running_chat` probe (Task 3
// keeps `/_api/acp/running` unchanged for that reason). This one answers a
// different question — "what SHOULD the shell tell the user" — which needs a
// per-chat state, not just a busy/idle boolean, because a chat blocked on a
// permission prompt is technically still `turnActive` in the ACP sense but is
// the MORE actionable of the two (see bridge.ts's `awaitingInputCount`).
export type ChatActivityState = 'running' | 'awaiting-input' | 'idle';

export interface ChatActivity {
  chatId: string;
  state: ChatActivityState;
}

export interface ActivitySnapshot {
  /** Bumped only when the snapshot's (chatId, state) set actually changes —
   *  lets a poller skip re-deriving transitions on an unchanged read, without
   *  needing wall-clock time (Workflow-script-style determinism isn't a
   *  concern here, but a plain counter is simpler than a clock either way). */
  seq: number;
  chats: ChatActivity[];
}

type ActivityProbe = () => ChatActivity[];

let activityProbe: ActivityProbe | null = null;
let activitySeq = 0;
let lastSnapshotKey = '';

/** Registered once by `createAcp`, alongside `registerRunningChatsProbe`. */
export function registerActivityProbe(fn: ActivityProbe): void {
  activityProbe = fn;
}

/** Per-chat activity snapshot + a monotonic `seq`. Empty/unchanged-seq when no
 *  ACP manager exists — never throws, same failure posture as `runningChats`. */
export function activitySnapshot(): ActivitySnapshot {
  let bridged: ChatActivity[];
  try {
    bridged = activityProbe?.() ?? [];
  } catch {
    bridged = [];
  }
  // The union, one row per chat; the more actionable state wins (awaiting-input > running).
  // A waiting ask has no turn yet, so it is not activity here.
  const byChat = new Map<string, ChatActivityState>();
  const rank = (st: ChatActivityState) => (st === 'awaiting-input' ? 2 : st === 'running' ? 1 : 0);
  const note = (chatId: string, st: ChatActivityState) => {
    const cur = byChat.get(chatId);
    if (cur === undefined || rank(st) > rank(cur)) byChat.set(chatId, st);
  };
  for (const c of bridged) note(c.chatId, c.state);
  for (const r of registryRuns()) {
    if (!r.chatId || r.state === 'ended' || r.state === 'waiting') continue;
    note(r.chatId, r.state === 'needs-you' ? 'awaiting-input' : 'running');
  }
  const chats: ChatActivity[] = [...byChat].map(([chatId, state]) => ({ chatId, state }));
  // Order-independent key — chat enumeration order can shuffle between calls
  // (Map iteration) without the underlying state having changed.
  const key = [...chats]
    .sort((a, b) => a.chatId.localeCompare(b.chatId))
    .map((c) => `${c.chatId}:${c.state}`)
    .join(',');
  if (key !== lastSnapshotKey) {
    lastSnapshotKey = key;
    activitySeq++;
  }
  return { seq: activitySeq, chats };
}
