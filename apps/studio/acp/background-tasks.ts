// acp/background-tasks.ts — issue #177: what the AI chat knows about work running in the background.
//
// Claude Code reports its live background work (subagents launched with the Agent tool, a Bash call
// with `run_in_background`, a Monitor) as one LEVEL signal: the SDK system message
// `background_tasks_changed`, whose `tasks` array is "every live background task after the change"
// (replace semantics; emitted on start, completion, kill, a foreground agent being backgrounded).
// The edge events (`task_started` / `task_progress` / `task_updated` / `task_notification`) never reach
// us: the pinned adapter (claude-agent-acp 0.57.0) swallows them. It has no case for
// `background_tasks_changed` either, so it calls `unreachable()`, which logs the WHOLE message to its
// stderr as `Unexpected case: <json>` — that stderr line is the one place the snapshot survives, so the
// bridge reads it there (decision maude/v2-204-background-from-adapter-stderr).
//
// `command_lifecycle` (queued / started / completed) is the lifecycle of the host's OWN prompts in
// Claude Code's input queue, not background work: it is dropped quietly.
//
// What leaves this module is a short, render-ready list: an id, a kind (agent / command / other), a
// one-line label and the time this bridge first saw the task. The label is model-authored text — it is
// cut to one line and capped here, and rendered as text by the client, never as markup.

/** One live background task, as the chat shows it. */
export interface BackgroundTask {
  id: string;
  kind: 'agent' | 'command' | 'other';
  label: string;
  /** Epoch ms this bridge first saw the task in a snapshot (drives the elapsed time). */
  since: number;
}

/** A parsed `background_tasks_changed` message: the session it is for and its raw tasks. */
export interface BackgroundSnapshot {
  sessionId: string | null;
  tasks: RawTask[];
}

interface RawTask {
  task_id?: unknown;
  task_type?: unknown;
  description?: unknown;
  subagent_type?: unknown;
  ambient?: unknown;
  awaited?: unknown;
}

/** At most this many rows reach the client (a runaway list must not flood the chat). */
export const MAX_TASKS = 50;
const LABEL_MAX = 80;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const PREFIX = 'Unexpected case: ';

/** The JSON body of an adapter `Unexpected case:` line (any leading timestamp tolerated), or null. */
function unexpectedBody(line: string): unknown {
  const at = line.indexOf(PREFIX);
  if (at < 0) return null;
  const body = line.slice(at + PREFIX.length).trim();
  if (!body.startsWith('{')) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The background snapshot an adapter stderr line carries, or null when it carries none. */
export function parseBackgroundLine(line: string): BackgroundSnapshot | null {
  if (!line.includes('background_tasks_changed')) return null;
  const msg = unexpectedBody(line) as Record<string, unknown> | null;
  if (msg?.type !== 'system' || msg.subtype !== 'background_tasks_changed') return null;
  if (!Array.isArray(msg.tasks)) return null;
  return {
    sessionId: typeof msg.session_id === 'string' ? msg.session_id : null,
    tasks: msg.tasks.filter((t): t is RawTask => !!t && typeof t === 'object'),
  };
}

/** True for the adapter's `command_lifecycle` line — the host's own prompt queue, not background work. */
export function isCommandLifecycleLine(line: string): boolean {
  if (!line.includes('command_lifecycle')) return false;
  const msg = unexpectedBody(line) as Record<string, unknown> | null;
  return !!msg && msg.type === 'command_lifecycle';
}

/** One line of model text: control and bidi characters out, whitespace collapsed, capped. */
export function oneLine(s: unknown, max = LABEL_MAX): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ');
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

function kindOf(taskType: unknown): BackgroundTask['kind'] {
  if (taskType === 'local_agent' || taskType === 'remote_agent') return 'agent';
  if (taskType === 'local_bash') return 'command';
  return 'other';
}

/**
 * Fold a snapshot into the live list. Replace semantics: a task missing from the snapshot has
 * ended. `prev` keeps a task's `since` across snapshots. Ambient tasks (housekeeping, live-update
 * watchers — "hosts should exclude them from activity indicators") and awaited runs (a foreground
 * call is waiting on them, so they are not background) are left out.
 */
export function foldSnapshot(
  prev: readonly BackgroundTask[],
  snap: BackgroundSnapshot,
  now: number = Date.now()
): BackgroundTask[] {
  const before = new Map(prev.map((t) => [t.id, t]));
  const out: BackgroundTask[] = [];
  const seen = new Set<string>();
  for (const raw of snap.tasks) {
    if (out.length >= MAX_TASKS) break;
    if (raw.ambient === true || raw.awaited === true) continue;
    const id = typeof raw.task_id === 'string' && ID_RE.test(raw.task_id) ? raw.task_id : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kind = kindOf(raw.task_type);
    const label =
      oneLine(raw.description) ||
      (kind === 'agent' ? oneLine(raw.subagent_type) : '') ||
      (kind === 'agent' ? 'Agent' : kind === 'command' ? 'Command' : 'Task');
    out.push({ id, kind, label, since: before.get(id)?.since ?? now });
  }
  return out;
}

/** Same list, same order, same fields — so an unchanged snapshot sends no frame. */
export function sameTasks(a: readonly BackgroundTask[], b: readonly BackgroundTask[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const o = b[i];
    return o && o.id === t.id && o.kind === t.kind && o.label === t.label && o.since === t.since;
  });
}

/**
 * Split a stderr stream into whole lines. A chunk can end mid-line (a long snapshot is one long
 * line), so the tail is carried into the next chunk; `flush()` hands back what is left at the end.
 */
export function createLineSplitter(onLine: (line: string) => void) {
  let carry = '';
  return {
    push(chunk: string): void {
      const text = carry + chunk;
      const parts = text.split('\n');
      carry = parts.pop() ?? '';
      // A line longer than 1 MB is never a snapshot we want; do not hold it forever.
      if (carry.length > 1_000_000) carry = '';
      for (const p of parts) onLine(p);
    },
    flush(): void {
      if (carry) onLine(carry);
      carry = '';
    },
  };
}
