// client/v2/ai/run-model.js — S5.9 (03 AI Chat `ai-working`, `ai-done`): what the panel says about the
// chat's run, as pure functions. No React, no fetch, no clock.
//
// The run comes from the S5.3 registry as the `{t:'run', run}` frame (S5.6) and from
// `GET /_api/ai/runs` (`mine`, a RunView): `state` waiting | starting | running | needs-you | ended, and
// once ended an `outcome` done | stopped | failed | interrupted | cancelled | lease-lost.
//
// Words are CONTRACT §3–§4: "AI is drawing the footer" (a name, no article), "Done — <artboard> is
// <result>." (the AI describes the result, never itself), Undo first and then the way on.

import { groupLabel } from '../history/use-versions.js';
import { humanize } from './runs-model.js';
import { shortArtboardName } from './scope.js';

/** The run is on a turn (or about to be): the working line shows, with Stop. */
export const WORKING_STATES = new Set(['starting', 'running']);

// ── the chat's runs ──────────────────────────────────────────────────────────────────────────────────

export const emptyRuns = () => ({ byId: {} });

/** `{t:'run', run}` — the newest frame for a run wins. */
export function reduceRuns(state, frame) {
  const run = frame?.t === 'run' ? frame.run : null;
  if (!run || typeof run.runId !== 'string') return state;
  return { byId: { ...state.byId, [run.runId]: run } };
}

/**
 * A snapshot from `GET /_api/ai/runs`. A frame that arrived first is newer than the fetch that was
 * already in flight: keep what is known, add what is not, and let a snapshot close a run the frames
 * never saw end.
 */
export function seedRuns(state, runs) {
  let byId = state.byId;
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run.runId !== 'string') continue;
    const known = byId[run.runId];
    if (known && !(known.state !== 'ended' && run.state === 'ended')) continue;
    if (byId === state.byId) byId = { ...byId };
    byId[run.runId] = run;
  }
  return byId === state.byId ? state : { byId };
}

/** The chat's newest run (it is the one the panel talks about), or null. */
export function latestRun(state) {
  let best = null;
  for (const run of Object.values(state.byId)) {
    if (!best || (run.createdAt ?? 0) >= (best.createdAt ?? 0)) best = run;
  }
  return best;
}

export const isWorking = (run) => !!run && WORKING_STATES.has(run.state);

/**
 * Does the panel draw the working line? Only for a run that IS working: a queued ask (`waiting`) has its own card and
 * a question has its card too (03 `ai-same-artboard`: "only the Waiting card" — a working line beside it read as two runs).
 */
export const showsWorkingLine = (live, run) =>
  !!live && run?.state !== 'needs-you' && run?.state !== 'waiting';

// ── the working line ─────────────────────────────────────────────────────────────────────────────────

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "making it greener" → "AI is making it greener"; already "AI is …" stays; nothing → "AI is working". */
export function workingText(run) {
  const doing = typeof run?.doing === 'string' ? run.doing.replace(/\s+/g, ' ').trim() : '';
  if (!doing) return 'AI is working';
  if (/^AI is\b/i.test(doing)) return doing;
  return `AI is ${lowerFirst(doing)}`;
}

/** m:ss — the working line's quiet clock. */
export function clock(ms) {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** "41 s" · "1 min" · "3 min" — how long a finished run took. */
export function took(ms) {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs} s`;
  return `${Math.round(secs / 60)} min`;
}

// ── the result ───────────────────────────────────────────────────────────────────────────────────────

/** Did the run change anything on the canvas? A run that only answered has nothing to undo. */
export function changedSomething(run) {
  if (!run) return false;
  if (Object.values(run.touched || {}).some((ids) => Array.isArray(ids) && ids.length > 0))
    return true;
  return Array.isArray(run.objects) && run.objects.length > 0;
}

/** The artboard ids the run changed on its own canvas (empty = the whole canvas or unknown). */
export function touchedIds(run) {
  const canvas = run?.scope?.canvas;
  const mine = canvas ? run.touched?.[canvas] : null;
  if (Array.isArray(mine) && mine.length) return mine;
  const scoped = run?.scope?.artboards;
  return Array.isArray(scoped) ? scoped : [];
}

const names = (ids, artboards) =>
  ids.map((id) =>
    shortArtboardName((artboards || []).find((a) => a.id === id)?.label ?? humanize(id))
  );

/**
 * "Done — Post 1:1 is updated." — the sentence for a finished run whose reply has no words of its own.
 * The AI describes the result (rule `ai-describes-the-result`); it never says "I made…".
 */
export function describeResult(run, artboards = []) {
  const ids = touchedIds(run);
  if (!ids.length) return 'Done — the canvas is updated.';
  const list = names(ids, artboards);
  if (list.length === 1) return `Done — ${list[0]} is updated.`;
  const head = list.slice(0, -1).join(', ');
  return `Done — ${head} and ${list[list.length - 1]} are updated.`;
}

/** The sentence for a run that was cut short. The changes already made are on the canvas. */
export function interruptedText(run) {
  const how = run?.outcome === 'stopped' ? 'Stopped' : 'Interrupted';
  return changedSomething(run)
    ? `${how} — the changes AI already made are on the canvas.`
    : `${how} — nothing was changed.`;
}

/**
 * The verbs under a result, in order: Undo first, then the way on (CONTRACT). A variant is the run's
 * shape:
 *   done, changed        Undo · Keep going
 *   done, on a copy      Undo · Keep the copy
 *   done, before/after   Undo · Compare            (only where the panel can show one)
 *   done, only answered  —  (the answer already ends "The canvas didn't change.")
 *   stopped / cut off    Undo (if it changed anything) · Keep going
 * A run that failed or was cancelled has no result card: the problem card (S5.13) owns it.
 */
export function resultVerbs(run, { canCompare = false } = {}) {
  if (run?.state !== 'ended') return [];
  const changed = changedSomething(run);
  if (run.outcome === 'done') {
    if (!changed) return [];
    if (run.copyOf) return ['Undo', 'Keep the copy'];
    if (canCompare) return ['Undo', 'Compare'];
    return ['Undo', 'Keep going'];
  }
  if (run.outcome === 'stopped' || run.outcome === 'interrupted') {
    return changed ? ['Undo', 'Keep going'] : ['Keep going'];
  }
  return [];
}

/** Does this run get a result card at all? */
export const hasResultCard = (run) => resultVerbs(run).length > 0 || runCutShort(run);
export const runCutShort = (run) =>
  !!run && run.state === 'ended' && (run.outcome === 'stopped' || run.outcome === 'interrupted');

/** Follow-ups after a one-artboard change: "Same on <another artboard>" for up to two untouched ones. */
export function followUps(run, artboards = [], max = 2) {
  if (run?.state !== 'ended' || run.outcome !== 'done' || !changedSomething(run)) return [];
  const touched = touchedIds(run);
  if (touched.length !== 1) return [];
  return (artboards || [])
    .filter((a) => a?.id && !touched.includes(a.id))
    .slice(0, max)
    .map((a) => `Same on ${shortArtboardName(a.label ?? a.id)}`);
}

/** "What AI did · 6 steps · 41 s" — the fold's summary line. */
export function stepsSummary(steps, run) {
  const n = Array.isArray(steps) ? steps.length : Number(steps) || 0;
  const parts = ['What AI did', `${n} ${n === 1 ? 'step' : 'steps'}`];
  if (run?.startedAt && run?.endedAt && run.endedAt >= run.startedAt) {
    parts.push(took(run.endedAt - run.startedAt));
  }
  return parts.join(' · ');
}

// ── what the last reply holds ────────────────────────────────────────────────────────────────────────

/** One line for a tool call: its own description, else "Edit Post.tsx". */
export function stepTitle(part) {
  const args = part?.args && typeof part.args === 'object' ? part.args : {};
  const said = [args.description, args.title].find((v) => typeof v === 'string' && v.trim());
  if (said) return said.trim();
  const file = [args.path, args.file, args.filePath, args.file_path].find(
    (v) => typeof v === 'string' && v
  );
  const base = file ? file.split('/').pop() : '';
  return base ? `${part.toolName} ${base}` : String(part?.toolName ?? 'Step');
}

/** The newest assistant message, as the card needs it: its words and one title per tool call. */
export function lastAssistantDigest(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let last = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'assistant') {
      last = list[i];
      break;
    }
  }
  const parts = Array.isArray(last?.content) ? last.content : [];
  const text = parts
    .filter((p) => p?.type === 'text')
    .map((p) => String(p.text ?? ''))
    .join('\n')
    .trim();
  const steps = parts.filter((p) => p?.type === 'tool-call').map(stepTitle);
  return { text, steps };
}

// ── the live region ──────────────────────────────────────────────────────────────────────────────────

/** What a screen reader hears for a run in this state, or '' when the state has nothing to say. */
export function liveText(run, resultSentence = '') {
  if (!run) return '';
  if (run.state === 'starting' || run.state === 'running') return workingText(run);
  if (run.state === 'needs-you') return run.question ? `Needs you — ${run.question}` : 'Needs you';
  if (run.state === 'ended') {
    if (run.outcome === 'done') return resultSentence || describeResult(run);
    if (run.outcome === 'stopped' || run.outcome === 'interrupted') return interruptedText(run);
  }
  return '';
}

/**
 * Announce each state once. `next(run, sentence)` returns the text the first time a (run, state) pair
 * is seen with something to say, and null on every repeat — a re-render, a second frame for the same
 * state, a steps update.
 */
export function createAnnouncer() {
  let last = '';
  return {
    next(run, resultSentence = '') {
      if (!run) return null;
      const key = `${run.runId}:${run.state}:${run.state === 'ended' ? run.outcome : ''}`;
      if (key === last) return null;
      const text = liveText(run, resultSentence);
      if (!text) return null;
      last = key;
      return text;
    },
  };
}

/**
 * S5.18 G2 (03 `ai-copy`) — the divider above a run that ran on a copy: "Ran on a copy — Post 1:1 was busy".
 * `name` is the artboard the copy was made of (its short name); null when the run is not a copy.
 */
export function copyDividerText(run, { name = null } = {}) {
  const of = run?.copyOf?.artboard;
  if (!of) return null;
  return `Ran on a copy — ${name || humanize(of)} was busy`;
}

// ── day dividers in a long chat (S5.19 G4, 03 `ai-long`) ─────────────────────────────────────────────

const two = (n) => String(n).padStart(2, '0');

/**
 * "Yesterday, 18:20" · "Today, 09:12" · "6 Oct, 14:05" (CONTRACT §4: relative first, absolute 24-hour) — the
 * divider above the first ask of a new day. `stamps` is the chat's asks in order, `[[messageId, ms | null], …]`
 * (null = no time known: no divider). The first ask of a chat gets one only when it is not from today (a
 * fresh chat needs no "Today"). Words are the history groups' own (`groupLabel`), so the two never disagree.
 */
export function dayDividerFor(stamps, id, now = Date.now()) {
  const list = Array.isArray(stamps) ? stamps : [];
  const at = list.findIndex((s) => s && s[0] === id);
  const ms = at >= 0 ? list[at][1] : null;
  if (!Number.isFinite(ms)) return null;
  let prev = null;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (Number.isFinite(list[i]?.[1])) {
      prev = list[i][1];
      break;
    }
  }
  const word = groupLabel(ms, now);
  if (prev === null ? word === 'Today' : groupLabel(prev, now) === word) {
    // same day as the one before — except a "6 Oct" and a "6 Oct" of another year, which differ by label
    return null;
  }
  const d = new Date(ms);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${word}, ${time}`;
}
