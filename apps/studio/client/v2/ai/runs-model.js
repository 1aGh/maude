// client/v2/ai/runs-model.js — S5.11: what the run list, the waiting card and the artboard rings read out of
// `GET /_api/ai/runs` (V2-1.15 §5.8). Pure: no React, no fetch, no clock it was not handed.
//
// The shapes it reads (ai/run-lifecycle.ts):
//   mine    RunView[]    YOUR runs on this Mac — the record minus the queued prompt. `label` is the prompt,
//                        shortened; `waiting[]` are this run's tickets; `leases[]` the artboards it holds.
//   others  RunPublic[]  other people's live runs. Never carries prompt, question or doing.
//
// Three rules live here and nowhere else (each has a test):
//   • "✦ N" counts YOUR live runs — a waiting ask counts, an ended run and anyone else's never do.
//   • An estimate on the waiting card ("about a minute") exists only when it is computed from the holder's
//     elapsed time and that chat's median turn. Never copy.
//   • The ring data that goes to the canvas iframe (`ringsFor`) carries a state, a name and a count — never a
//     prompt, a question or a progress line. The canvas is the untrusted side (DDR-054).

export const RUN_WORD = {
  working: 'Working',
  waiting: 'Waiting',
  needs: 'Needs you',
  done: 'Done',
};

const LIVE = new Set(['waiting', 'starting', 'running', 'needs-you']);

/** A run that has not ended (waiting counts: it is in line, and still yours). */
export const isLiveRun = (r) => !!r && LIVE.has(r.state);

/** The kit's four row states: starting/running → working, waiting → waiting, needs-you → needs. */
export function uiState(state) {
  if (state === 'starting' || state === 'running') return 'working';
  if (state === 'waiting') return 'waiting';
  if (state === 'needs-you') return 'needs';
  return null;
}

/** `GET /_api/ai/runs` as the store keeps it. Anything else (an old server, a bad body) is an empty list. */
export function normalizeRuns(body) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    seq: Number.isFinite(body?.seq) ? body.seq : 0,
    mine: arr(body?.mine),
    others: arr(body?.others),
    needsYou: Number.isFinite(body?.needsYou) ? body.needsYou : 0,
    live: Number.isFinite(body?.live) ? body.live : 0,
    diagnostics: typeof body?.diagnostics === 'string' ? body.diagnostics : null,
  };
}

export const EMPTY_RUNS = normalizeRuns(null);

/** "✦ N" — your live runs. The only number the header shows. */
export function yoursCount(view) {
  return (view?.mine || []).filter(isLiveRun).length;
}

/** Needs-you runs of YOURS (the folded spark's azure count reads this one, S5.13). */
export function needsYouCount(view) {
  return (view?.mine || []).filter((r) => r.state === 'needs-you').length;
}

// ── which canvas / artboard a run is on ────────────────────────────────────────────────────────────

/** The lease key a canvas has before the op log gives it an entry: `path:<repo-relative file>`. */
export const pathKey = (file) => (file ? `path:${file}` : null);

const join = (designRel, rel) =>
  designRel && rel && !rel.startsWith(`${designRel}/`) ? `${designRel}/${rel}` : rel;

/** The repo-relative file a run of mine is on (its scope), or null for a lazy run. */
export function runFile(run, designRel) {
  const rel = run?.scope?.canvas;
  return typeof rel === 'string' && rel ? join(designRel, rel) : null;
}

/** Does this lease key belong to the open canvas? `entryOf(file)` (optional) maps a file to its kernel entry. */
export function onCanvas(key, activeCanvas, entryOf) {
  if (!key || !activeCanvas) return false;
  if (key.canvas === pathKey(activeCanvas)) return true;
  const entry = entryOf?.(activeCanvas);
  return !!entry && key.canvas === entry;
}

/** artboard label by (file, id) from the canvases index (`indexMeta` → `boards`). */
export function artboardLabel(labels, file, id) {
  const hit = labels?.get?.(file)?.find?.((b) => b.id === id);
  if (hit?.label) return hit.label;
  return humanize(id);
}

/** `post-1-1` → "Post 1 1": the last resort when the index has not listed the artboard. */
export function humanize(id) {
  const s = String(id ?? '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Artboard';
}

/** The artboards a run of mine is on: what it holds, else what it is waiting for, else its scope. */
function runKeys(run) {
  const held = (run.leases || []).map((l) => ({ canvas: l.canvas, artboard: l.artboard }));
  if (held.length) return held;
  const wait = (run.waiting || []).map((w) => ({ canvas: w.canvas, artboard: w.artboard }));
  if (wait.length) return wait;
  return [];
}

/** "Post 1:1" / "Post 1:1, Story 9:16" / "Whole canvas" / "" — the artboard half of a row's second line. */
export function whereLabel(run, { designRel, labels } = {}) {
  const scope = run?.scope;
  if (scope && scope.artboards === '*') return 'Whole canvas';
  const file = runFile(run, designRel);
  const ids = runKeys(run).map((k) => k.artboard);
  const names = [...new Set(ids)].map((id) => artboardLabel(labels, file, id));
  if (names.length > 2) return `${names[0]}, ${names[1]} +${names.length - 2}`;
  return names.join(', ');
}

const displayActor = (actor) => {
  const s = typeof actor === 'string' ? actor.trim() : '';
  if (!s || s === 'you') return 'You';
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const actorName = displayActor;

/** Rows for "Yours": the kit's `AIRun` ({title, where, state, current}) plus what a click needs. */
export function yoursRows(view, { designRel, labels, currentChatId } = {}) {
  return (view?.mine || [])
    .filter(isLiveRun)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => {
      const keys = runKeys(r);
      return {
        id: r.runId,
        title: r.label || 'AI run',
        where: whereLabel(r, { designRel, labels }),
        state: uiState(r.state),
        current: !!currentChatId && r.chatId === currentChatId,
        chatId: r.chatId,
        file: runFile(r, designRel),
        artboard: keys[0]?.artboard ?? null,
      };
    });
}

/** Rows for "On this canvas": other people's live runs, View only. Never counted as yours. */
export function canvasRows(view, { activeCanvas, labels, entryOf } = {}) {
  return (view?.others || [])
    .filter((o) => o && uiState(o.state))
    .map((o) => ({
      o,
      // where it is now, else where it stands in line
      keys: [...(o.artboards || []), ...(o.waitingFor || [])].filter((k) =>
        onCanvas(k, activeCanvas, entryOf)
      ),
    }))
    .filter(({ keys }) => keys.length > 0)
    .map(({ o, keys }) => {
      const names = [...new Set(keys.map((k) => artboardLabel(labels, activeCanvas, k.artboard)))];
      return {
        id: o.runId,
        title: o.label || 'AI run',
        where: `${names.join(', ')} · ${actorName(o.actor)}'s AI`,
        state: uiState(o.state),
        who: o.actor,
        viewOnly: true,
        file: activeCanvas,
        artboard: keys[0]?.artboard ?? null,
      };
    });
}

// ── the rings on the canvas (dgn `ai-runs`) ────────────────────────────────────────────────────────

export const TAG_WORKING = 'AI is working';
export const TAG_NEEDS_YOU = 'Waiting for you';
/** S7.14 — an AI cut placing shots: "AI is cutting · 7 of 14", built from the progress NUMBERS only. */
export const TAG_CUTTING = 'AI is cutting';
/** S7.15 — an AI watching the attached footage, before a shot is placed (07 · ve-ai-watch): a fixed phrase. */
export const TAG_WATCHING = 'AI is watching footage';
export const watchingTag = (p) => (p?.kind === 'watch' && p.done < p.total ? TAG_WATCHING : null);
export const cuttingTag = (p) =>
  p?.kind === 'place' && Number.isFinite(p.done) && Number.isFinite(p.total)
    ? `${TAG_CUTTING} · ${p.done} of ${p.total}`
    : null;

/**
 * `{artboards: Record<artboardId, {state, who, tag, waiting}>}` for the open canvas (V2-1.15 §5.8, S5.11 P3).
 *   state    'running' | 'needs-you' | 'done'  (done is the settled ring, driven by the V2-1.5 action event)
 *   who      'you' for your AI, else the other person's actor id — the canvas draws their face from it
 *   tag      a fixed phrase: "AI is working", "Tereza's AI", "Waiting for you", "Waiting for Tereza". Built here
 *            from the state and the NAME only — the run's label, question and progress line never reach it
 *            (S7.14: an AI cut's tag carries its progress NUMBERS, "AI is cutting · 7 of 14", never text)
 *   waiting  the number of tickets on the artboard (the tag reads "· N waiting")
 * One entry per artboard; the holder wins. A run that is only waiting has no ring of its own.
 */
export function ringsFor(view, { activeCanvas, entryOf } = {}) {
  const out = {};
  const waiting = {};
  const addWait = (key) => {
    if (!onCanvas(key, activeCanvas, entryOf)) return;
    waiting[key.artboard] = (waiting[key.artboard] || 0) + 1;
  };
  for (const r of view?.mine || []) {
    if (!isLiveRun(r)) continue;
    if (r.state === 'waiting') for (const w of r.waiting || []) addWait(w);
    if (r.state === 'waiting') continue;
    for (const l of r.leases || []) {
      if (!onCanvas(l, activeCanvas, entryOf)) continue;
      const needs = r.state === 'needs-you';
      out[l.artboard] = {
        state: needs ? 'needs-you' : 'running',
        who: 'you',
        tag: needs
          ? TAG_NEEDS_YOU
          : (l.artboard === r.progress?.artboard && cuttingTag(r.progress)) ||
            watchingTag(r.progress) ||
            TAG_WORKING,
        waiting: 0,
      };
    }
  }
  for (const o of view?.others || []) {
    if (!o || !uiState(o.state)) continue;
    if (o.state === 'waiting') for (const w of o.waitingFor || []) addWait(w);
    if (o.state === 'waiting') continue;
    const name = actorName(o.actor);
    for (const k of o.artboards || []) {
      if (!onCanvas(k, activeCanvas, entryOf) || out[k.artboard]) continue;
      const needs = o.state === 'needs-you';
      out[k.artboard] = {
        state: needs ? 'needs-you' : 'running',
        who: String(o.actor ?? ''),
        tag: needs ? `Waiting for ${name}` : `${name}'s AI`,
        waiting: 0,
      };
    }
  }
  for (const [id, n] of Object.entries(waiting)) if (out[id]) out[id].waiting = n;
  return out;
}

/** A settled ring for `ids` — S5.5 hands over the artboards a finished run changed. */
export function doneRings(ids) {
  const out = {};
  for (const id of ids || [])
    out[id] = { state: 'done', who: 'you', tag: 'Made by AI', waiting: 0 };
  return out;
}

/** What the canvas gets: the live rings with the done ones under them (a live ring wins its artboard). */
export function mergeRings(live, done) {
  return { ...(done || {}), ...(live || {}) };
}

// ── the objects a run holds (dgn `ai-holds`, S2.18 / S9.22b) ───────────────────────────────────────

/** The canvas parser's caps (bridge/dgn-protocol.ts HOLD_LABEL_MAX / AI_HOLDS_MAX): a row past them would
 *  make the canvas drop the WHOLE message, so it is left out here instead. */
const HOLD_TEXT_MAX = 120;
const HOLDS_MAX = 256;
const holdText = (v) => typeof v === 'string' && v.length > 0 && v.length <= HOLD_TEXT_MAX;

/** S2.19 — the ring tag of a ⌘/ ask on `n` elements: a fixed phrase and a count, never a word of the prompt. */
export const scopeTag = (n) => `AI is working on ${n} ${n === 1 ? 'element' : 'elements'}`;

const holdKey = (o) =>
  `${o?.artboard}\u0000${o?.element}\u0000${Number.isInteger(o?.occurrence) ? o.occurrence : ''}`;
/** The keys of the elements a run was ASKED about (its scope's `elements`), not the ones it touched since. */
const askedKeys = (r) => new Set((r?.scope?.elements || []).map(holdKey));

/**
 * `[{artboard, element, occurrence?, tag, mine, scope?}]` — the objects running / needs-you runs hold on the open
 * canvas (a run's `objects`). The tag is the ring's fixed phrase (v2-lead-neutral-ai-ring-tags): built from
 * the state and the holder's NAME only. A run's label (its prompt), question and progress line never reach
 * the canvas — it is the untrusted side (DDR-054). One row per object; your run wins a shared object.
 */
export function holdsFor(view, { activeCanvas, entryOf } = {}) {
  const out = [];
  const seen = new Set();
  const add = (o, tag, mine, scoped = false) => {
    if (out.length >= HOLDS_MAX || !o || !onCanvas(o, activeCanvas, entryOf)) return;
    if (!holdText(o.artboard) || !holdText(o.element)) return;
    const occ =
      Number.isInteger(o.occurrence) && o.occurrence >= 0 && o.occurrence < 10000
        ? o.occurrence
        : undefined;
    const key = `${o.artboard}\u0000${o.element}\u0000${occ ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      artboard: o.artboard,
      element: o.element,
      ...(occ !== undefined ? { occurrence: occ } : {}),
      tag,
      mine,
      ...(scoped ? { scope: true } : {}),
    });
  };
  const holding = (s) => s === 'running' || s === 'needs-you';
  for (const r of view?.mine || []) {
    if (!r || !holding(r.state)) continue;
    // S2.19 — a ⌘/ ask on a selection: the asked elements are ONE outline on the canvas, tagged with how many
    const asked = askedKeys(r);
    const tag = r.state === 'needs-you' ? TAG_NEEDS_YOU : TAG_WORKING;
    const askedTag = r.state === 'needs-you' ? TAG_NEEDS_YOU : scopeTag(asked.size);
    for (const o of r.objects || []) {
      const hit = asked.has(holdKey(o));
      add(o, hit ? askedTag : tag, true, hit);
    }
  }
  for (const o of view?.others || []) {
    if (!o || !holding(o.state)) continue;
    const name = actorName(o.actor);
    const tag = o.state === 'needs-you' ? `Waiting for ${name}` : `${name}'s AI`;
    for (const x of o.objects || []) add(x, tag.slice(0, HOLD_TEXT_MAX), false);
  }
  return out;
}

// ── the spot an answered question points at (dgn `ai-holds` rows with `point`, S5.19) ──────────────────

/** How long a question's spot stays marked after the answer (a click puts it away sooner, canvas side). */
export const POINT_MS = 20000;

/**
 * `[{artboard, element, occurrence?, tag, mine, point: true}]` — 03 `ai-question`: "AI points at the spot it means
 * with a small spark ring". The newest run of YOURS that ended `done` having changed nothing (`touched` is empty —
 * a question) and was asked about elements marks those elements on the open canvas for `POINT_MS`. The tag is
 * the element's NAME (its id, humanized) and nothing else: the prompt and the answer never reach the canvas
 * (DDR-054, v2-lead-neutral-ai-ring-tags).
 */
export function pointsFor(view, { activeCanvas, entryOf, now = Date.now() } = {}) {
  let best = null;
  for (const r of view?.mine || []) {
    if (!r || r.state !== 'ended' || r.outcome !== 'done' || !Number.isFinite(r.endedAt)) continue;
    if (now - r.endedAt > POINT_MS || r.endedAt > now + POINT_MS) continue;
    if (Object.keys(r.touched || {}).length) continue;
    if (!Array.isArray(r.scope?.elements) || !r.scope.elements.length) continue;
    if (!best || r.endedAt > best.endedAt) best = r;
  }
  if (!best) return [];
  const out = [];
  const seen = new Set();
  for (const o of best.scope.elements) {
    if (out.length >= HOLDS_MAX || !onCanvas(o, activeCanvas, entryOf)) continue;
    if (!holdText(o.artboard) || !holdText(o.element)) continue;
    const key = holdKey(o);
    if (seen.has(key)) continue;
    seen.add(key);
    const occ =
      Number.isInteger(o.occurrence) && o.occurrence >= 0 && o.occurrence < 10000
        ? o.occurrence
        : undefined;
    out.push({
      artboard: o.artboard,
      element: o.element,
      ...(occ !== undefined ? { occurrence: occ } : {}),
      tag: humanize(o.element).slice(0, HOLD_TEXT_MAX),
      mine: true,
      point: true,
    });
  }
  return out;
}

/** When the marked spot lets go (ms epoch), for the relay's timer; null = nothing marked. */
export function pointExpiry(view, now = Date.now()) {
  let at = null;
  for (const r of view?.mine || []) {
    if (r?.state !== 'ended' || r.outcome !== 'done' || !Number.isFinite(r.endedAt)) continue;
    const end = r.endedAt + POINT_MS;
    if (end > now && (at === null || end > at)) at = end;
  }
  return at;
}

// ── the waiting card ───────────────────────────────────────────────────────────────────────────────

/** The waiting runs of one chat, oldest first. */
export function waitingOfChat(view, chatId) {
  return (view?.mine || [])
    .filter((r) => r.state === 'waiting' && r.chatId === chatId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Median turn of a chat, from its finished runs (needs at least two — one turn is not a median). */
export function medianTurnMs(view, chatId) {
  const spans = (view?.mine || [])
    .filter(
      (r) =>
        r.chatId === chatId &&
        r.outcome === 'done' &&
        Number.isFinite(r.startedAt) &&
        Number.isFinite(r.endedAt) &&
        r.endedAt > r.startedAt
    )
    .map((r) => r.endedAt - r.startedAt)
    .sort((a, b) => a - b);
  if (spans.length < 2) return null;
  const mid = Math.floor(spans.length / 2);
  return spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
}

/** "about a minute" / "about 3 minutes" / "under a minute" — or null when nothing was computed. */
export function waitEstimate({ elapsedMs, medianMs } = {}) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(medianMs) || medianMs <= 0) return null;
  const left = medianMs - elapsedMs;
  if (!(left > 0)) return null;
  if (left < 45_000) return 'under a minute';
  const min = Math.round(left / 60_000);
  return min <= 1 ? 'about a minute' : `about ${min} minutes`;
}

/**
 * The card's words, from the run's first ticket. The estimate is appended only when `estimate` is a string
 * (the caller computed it); otherwise the line ends at "result." — it never invents a number.
 */
export function waitingCopy(run, { designRel, labels, estimate = null } = {}) {
  const ticket = (run?.waiting || [])[0];
  const file = runFile(run, designRel);
  const board = ticket
    ? artboardLabel(labels, file, ticket.artboard)
    : whereLabel(run, { designRel, labels });
  const holder = ticket?.heldBy?.label;
  const title = holder
    ? `Waiting for “${holder}” to finish on ${board}.`
    : `Waiting for another AI to finish on ${board}.`;
  const detail = `Starts by itself, on top of its result${typeof estimate === 'string' && estimate ? ` — ${estimate}` : ''}.`;
  return { title, detail, board };
}

/** The estimate for one waiting run, or null — holder elapsed from its `since`, median from your chat's turns. */
export function estimateFor(view, run, now) {
  const holder = (run?.waiting || [])[0]?.heldBy;
  if (!holder || !Number.isFinite(holder.since)) return null;
  // the median is of THIS chat's turns; the holder's own chat is the only one whose speed it tells us
  const holderMine = (view?.mine || []).find((r) => r.runId === holder.runId);
  if (!holderMine?.chatId) return null;
  return waitEstimate({
    elapsedMs: now - (holderMine.startedAt ?? holder.since),
    medianMs: medianTurnMs(view, holderMine.chatId),
  });
}

// ── the run list's width (03 `ai-two-artboards`) ───────────────────────────────────────────────────

/** The list's natural width (runs.css `.ai-runs`). */
export const RUN_LIST_WIDTH = 320;

/**
 * S5.18 G1 — the list hangs from the ✦ N button's right edge. In a narrow dock column (288 px) its natural
 * width would run out past the column's left edge and be clipped; it narrows to what fits instead, never wider
 * than `natural`, never past `boundsLeft` (the column's, else the window's, left edge) plus a margin.
 */
export function fitRunListWidth({
  anchorRight,
  boundsLeft = 0,
  natural = RUN_LIST_WIDTH,
  margin = 8,
  floor = 160,
} = {}) {
  if (!Number.isFinite(anchorRight)) return natural;
  const room = anchorRight - Math.max(Number.isFinite(boundsLeft) ? boundsLeft : 0, 0) - margin;
  return Math.max(floor, Math.min(natural, Math.floor(room)));
}
