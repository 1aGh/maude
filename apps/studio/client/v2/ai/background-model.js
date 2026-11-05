// client/v2/ai/background-model.js — issue #177: the "Running in the background" strip's model.
//
// The server sends this chat's live background tasks as `{t:'background', tasks}` (acp/background-tasks.ts):
// the WHOLE set, every time it changes — a subagent the AI launched, a command it left running. A task
// that drops out of the set has ended; the snapshot does not say how, so the row says "Finished", never
// "Done" or "Failed". A finished row stays a few seconds so the end is seen, then goes.
//
// Pure: no React, no DOM. BackgroundStrip.jsx renders it.

/** How long a finished row stays on the strip. */
export const KEEP_FINISHED_MS = 8000;
const MAX_ITEMS = 50;
const KINDS = new Set(['agent', 'command', 'other']);

/** The server's list, checked: unknown shapes dropped, strings bounded (the frame is data, not trusted shape). */
export function cleanTasks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (out.length >= MAX_ITEMS) break;
    if (!t || typeof t.id !== 'string' || !t.id) continue;
    out.push({
      id: t.id.slice(0, 128),
      kind: KINDS.has(t.kind) ? t.kind : 'other',
      label: typeof t.label === 'string' ? t.label.slice(0, 120) : '',
      since: Number.isFinite(t.since) ? t.since : null,
    });
  }
  return out;
}

/**
 * Fold a new task list into the strip's items. Running tasks keep their start; a running item missing
 * from `tasks` becomes finished at `now`; finished items older than KEEP_FINISHED_MS are dropped.
 * Running rows first (oldest first), then finished ones.
 */
export function trackBackground(prev, tasks, now = Date.now()) {
  const live = new Map(tasks.map((t) => [t.id, t]));
  const before = new Map(prev.map((i) => [i.id, i]));
  const running = tasks.map((t) => ({
    id: t.id,
    kind: t.kind,
    label: t.label,
    since: t.since ?? before.get(t.id)?.since ?? now,
    state: 'running',
  }));
  const finished = [];
  for (const i of prev) {
    if (live.has(i.id)) continue;
    if (i.state === 'running') finished.push({ ...i, state: 'finished', endedAt: now });
    else if (now - i.endedAt < KEEP_FINISHED_MS) finished.push(i);
  }
  running.sort((a, b) => a.since - b.since);
  return [...running, ...finished];
}

/** Drop finished rows past their time; the same array when nothing changed. */
export function pruneFinished(items, now = Date.now()) {
  const next = items.filter((i) => i.state !== 'finished' || now - i.endedAt < KEEP_FINISHED_MS);
  return next.length === items.length ? items : next;
}

export function runningCount(items) {
  return items.filter((i) => i.state === 'running').length;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "3 agents working" · "1 agent working · 1 command running" · "Finished" when nothing runs. */
export function summaryText(items) {
  const run = items.filter((i) => i.state === 'running');
  if (!run.length) return 'Finished';
  const agents = run.filter((i) => i.kind === 'agent').length;
  const commands = run.filter((i) => i.kind === 'command').length;
  const other = run.length - agents - commands;
  const parts = [];
  if (agents) parts.push(`${count(agents, 'agent', 'agents')} working`);
  if (commands) parts.push(`${count(commands, 'command', 'commands')} running`);
  if (other) parts.push(`${count(other, 'task', 'tasks')} running`);
  return parts.join(' · ');
}

/** What a row is: "Agent" · "Command" · "Task". */
export function kindWord(kind) {
  return kind === 'agent' ? 'Agent' : kind === 'command' ? 'Command' : 'Task';
}

/** A row's name; an empty label reads as its kind. */
export function rowLabel(item) {
  return item.label || kindWord(item.kind);
}

/** m:ss (h:mm:ss past an hour); null under a second. */
export function elapsedText(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A row's time: how long it has run, or how long it ran. */
export function rowElapsed(item, now = Date.now()) {
  return elapsedText((item.state === 'finished' ? item.endedAt : now) - item.since);
}

/** The strip's time: since the oldest running task started. */
export function stripElapsed(items, now = Date.now()) {
  const run = items.filter((i) => i.state === 'running');
  if (!run.length) return null;
  return elapsedText(now - Math.min(...run.map((i) => i.since)));
}
