// client/v2/annotations/vote-store.js — S4.14: the shell's formal-vote store (Gate 0 A18, canvas 15
// artboard an-vote, contract S4-S9-votes-comments §1, §2.6).
//
// One store per page, following the ACTIVE canvas. It talks only to the studio's own door,
// routes/votes.ts (`/_api/votes*`, main origin): that route decides where the vote lives — the board
// (local: `vote` + one `ballot` element per voter) or the linked hub (`votes-v1`: the hub holds the
// ballots and the timer) — and always answers the SESSION's person's own picks only.
//
// The untrusted canvas (DDR-054) hears `vote-state` (the projection: the vote's targets, state, your own
// dots, the counts once ended — never a name, never anyone else's picks) and asks `vote-cast {artboard,
// remove?}` / `vote-board {artboards, open?}`. sec-a M2 (lead decision `v2-lead-ballots-commit-in-shell`):
// a `vote-cast` only moves a PENDING pick; the ballot is posted by the shell bar's Cast button alone, so a
// canvas can't spend the viewer's vote. `vote-board {open}` no longer opens the sheet either (C1(e)):
// "Start a vote…" is a shell gesture (⌘K, the artboard menu routed through the shell's own handlers). No React, no DOM: `fetchImpl` / `now` / `setTimer` are
// injected, so it is unit-tested without a browser.

/** The words (CONTRACT §3–§4). */
export const VOTE_WORDS = {
  title: 'Start a vote',
  start: 'Start vote',
  cancel: 'Cancel',
  end: 'End vote',
  hubLine: 'Nobody sees the others’ votes until the end.',
  pickTargets: 'Pick at least one artboard to vote on.',
  failed: 'Couldn’t start the vote. Nothing was changed.',
  castFailed: 'Your vote didn’t count. Try again.',
  noneLeft: 'No votes left. Take one back to move it.',
  cast: 'Cast',
  clear: 'Clear',
  ended: 'Vote ended. The counts are on the canvas.',
};

/** Durations the sheet offers (seconds); A18 default 2 min. */
export const DURATIONS = [60, 120, 300, 600];
export const DEFAULT_DURATION = 120;
export const DEFAULT_PER_VOTER = 3;
/** sec-a C1(e) — how long a shell "Start a vote…" lets the canvas's answer open the sheet. */
export const SHEET_ASK_MS = 3000;
/** While a vote is open the store re-reads this often (the "4 of 5 done" faces). */
export const POLL_MS = 3000;

const asTarget = (artboard) => `ab:${artboard}`;
const ARTBOARD_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** Sum of a picks map. */
export function spent(picks) {
  return Object.values(picks ?? {}).reduce((s, n) => s + (Number.isInteger(n) ? n : 0), 0);
}

/** `mine` after one dot more (`+1`) or less (`-1`) on `target`; null when the move is not allowed. */
export function nextPicks(mine, target, delta, perVoter, targets) {
  if (!targets.includes(target)) return null;
  const next = { ...(mine ?? {}) };
  if (delta > 0) {
    if (spent(next) >= perVoter) return null;
    next[target] = (next[target] ?? 0) + 1;
  } else {
    if (!next[target]) return null;
    next[target] -= 1;
    if (next[target] === 0) delete next[target];
  }
  return next;
}

/** "1:42" — the time left, never negative. */
export function clock(msLeft) {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The bar's pieces: "Vote · 3 directions · 0 left of your 3 · ⏱ 1:42 · 4 of 5 done". */
export function barModel(vote, mine, now, pending = null) {
  if (!vote || vote.state !== 'open') return null;
  const n = vote.targets.length;
  const picks = pending ?? mine;
  const left = Math.max(0, vote.perVoter - spent(picks));
  const done = vote.done?.length ?? 0;
  return {
    what: vote.title || (n === 1 ? '1 artboard' : `${n} artboards`),
    left,
    of: vote.perVoter,
    time: clock(vote.endsAt - now),
    done: vote.expected ? `${done} of ${vote.expected} done` : `${done} done`,
    faces: [...(vote.done ?? [])],
    /** sec-a M2 — picks moved on the canvas but not cast yet: the bar offers Cast / Clear. */
    pending: pending !== null && !samePicks(pending, mine),
  };
}

/** Two picks maps hold the same dots. */
export function samePicks(a, b) {
  const x = a ?? {};
  const y = b ?? {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if ((x[k] ?? 0) !== (y[k] ?? 0)) return false;
  return true;
}

/**
 * The ONLY thing the canvas hears about a vote (dgn `vote-state`). Built field by field from the
 * route's answer, so nothing the route adds later (names, other people's ballots) can ride along.
 */
export function voteStateMessage(vote, mine) {
  if (!vote) return { dgn: 'vote-state', vote: null, mine: {} };
  const ended = vote.state === 'ended';
  const own = {};
  if (!ended)
    for (const t of vote.targets) if (Number.isInteger(mine?.[t]) && mine[t] > 0) own[t] = mine[t];
  const out = {
    id: vote.id,
    targets: [...vote.targets],
    state: ended ? 'ended' : 'open',
    perVoter: vote.perVoter,
  };
  if (ended) {
    const tallies = {};
    for (const t of vote.targets) tallies[t] = Number(vote.tallies?.[t] ?? 0);
    out.tallies = tallies;
  }
  return { dgn: 'vote-state', vote: out, mine: own };
}

/** The vote the canvas shows: the open one, else the newest ended one (its counts stay). */
export function currentVote(votes) {
  const list = Array.isArray(votes) ? votes : [];
  return list.find((v) => v.state === 'open') ?? list.find((v) => v.state === 'ended') ?? null;
}

/** The canvas's artboards as the sheet lists them (untrusted: clamped, text only). */
export function cleanArtboards(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, 200)) {
    if (!a || typeof a.id !== 'string' || !ARTBOARD_RE.test(a.id)) continue;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    out.push({
      id: a.id,
      label: typeof a.label === 'string' ? a.label.slice(0, 120) : a.id,
      x: num(a.x),
      y: num(a.y),
      w: num(a.w),
      h: num(a.h),
    });
  }
  return out;
}

/** Where the result section goes: under the voted artboards (left edge of the leftmost). */
export function resultPlace(artboards, targets) {
  const hit = artboards.filter((a) => targets.includes(asTarget(a.id)));
  if (!hit.length) return undefined;
  return {
    x: Math.min(...hit.map((a) => a.x)),
    y: Math.max(...hit.map((a) => a.y + a.h)) + 80,
  };
}

async function call(fetchImpl, method, url, body) {
  try {
    const r = await fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/**
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, notify?: (line: string) => void,
 *           setTimer?: typeof setInterval, clearTimer?: typeof clearInterval }} [o]
 */
export function createVoteStore(o = {}) {
  const fetchImpl = o.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const now = o.now ?? (() => Date.now());
  let notify = o.notify ?? (() => {});
  const setTimer = o.setTimer ?? ((f, ms) => setInterval(f, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearInterval(t));
  let state = {
    file: null,
    mode: null,
    line: null,
    vote: null,
    mine: {},
    /** sec-a M2 — the picks the canvas moved, not cast yet (null = none). Only Cast posts them. */
    pending: null,
    me: null,
    artboards: [],
    sheet: null, // { focus?: string } while the sheet is open
    canEdit: false,
    canVote: false,
  };
  const subs = new Set();
  let timer = null;
  let gen = 0;
  let lastPoll = 0;
  let endingId = null;
  /** sec-a C1(e) — when the shell last asked the canvas for "Start a vote…" (null = not asked). */
  let askedAt = null;
  let offer = () => {};
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const f of subs) f(state);
  };
  const url = (p) => `/_api/votes${p}`;

  function arm() {
    const open = state.vote?.state === 'open';
    if (open && !timer)
      timer = setTimer(() => {
        if (now() - lastPoll >= POLL_MS || now() >= (state.vote?.endsAt ?? 0)) void load();
        else set({}); // the clock ticks
      }, 1000);
    if (!open && timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  async function load() {
    const file = state.file;
    if (!file) return;
    const g = ++gen;
    lastPoll = now();
    const r = await call(fetchImpl, 'GET', url(`?file=${encodeURIComponent(file)}`));
    if (g !== gen || state.file !== file) return;
    if (r.status !== 200 || !r.data?.ok) {
      set({ mode: null, vote: null, mine: {} });
      arm();
      return;
    }
    const before = state.vote;
    const vote = currentVote(r.data.votes);
    const keep = vote?.state === 'open' && before?.id === vote.id;
    set({
      mode: r.data.mode,
      line: r.data.line ?? null,
      vote,
      mine: (vote && r.data.mine?.[vote.id]) || {},
      pending: keep ? state.pending : null,
      me: r.data.me ?? null,
    });
    arm();
    // The time ran out (or another editor ended it): an editor's store writes the result once.
    if (before?.state === 'open' && vote?.id === before.id && vote.state === 'ended') {
      notify(VOTE_WORDS.ended);
      if (state.canEdit) void finish(vote.id);
    }
  }

  async function finish(id) {
    if (endingId === id) return;
    endingId = id;
    const v = state.vote;
    const labels = {};
    for (const a of state.artboards) labels[asTarget(a.id)] = a.label;
    await call(fetchImpl, 'POST', url('/end'), {
      file: state.file,
      id,
      labels,
      ...(v ? { place: resultPlace(state.artboards, v.targets) } : {}),
    });
    await load();
  }

  return {
    get: () => state,
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
    setFile(file) {
      if (file === state.file) return;
      gen++;
      set({
        file: file ?? null,
        vote: null,
        mine: {},
        pending: null,
        mode: null,
        artboards: [],
        sheet: null,
      });
      arm();
      if (file) void load();
    },
    setNotify(f) {
      notify = typeof f === 'function' ? f : () => {};
    },
    setRole({ canEdit, canVote }) {
      set({ canEdit: !!canEdit, canVote: !!canVote });
    },
    /**
     * dgn `vote-board` from the active canvas: its artboards. sec-a C1(e) — its `open` no longer opens
     * the sheet: a canvas could pop "Start a vote" over the shell unasked. The sheet opens from a shell
     * gesture (`openSheet`: ⌘K "Start a vote…", the artboard menu's run-action).
     */
    noteBoard({ artboards, open, focus }) {
      set({ artboards: cleanArtboards(artboards) });
      if (!open || !state.canEdit) return;
      const f = typeof focus === 'string' ? focus : null;
      if (askedAt !== null && now() - askedAt < SHEET_ASK_MS) {
        askedAt = null;
        set({ sheet: { focus: f } });
      } else offer(f); // the canvas's own row (its artboard menu): the shell asks first
    },
    /** The shell ran "Start a vote…" (⌘K / a menu): the canvas's answer may open the sheet once. */
    expectSheet() {
      askedAt = now();
    },
    /** `offer(focus)` — how the shell asks before a canvas-asked sheet opens (VoteHost: a toast). */
    setOffer(f) {
      offer = typeof f === 'function' ? f : () => {};
    },
    openSheet(focus = null) {
      if (state.canEdit) set({ sheet: { focus } });
    },
    closeSheet() {
      set({ sheet: null });
    },
    load,
    async start({ artboards, perVoter = DEFAULT_PER_VOTER, durationS = DEFAULT_DURATION, title }) {
      if (!artboards?.length) return { ok: false, line: VOTE_WORDS.pickTargets };
      const expected = Number.isInteger(o.expected?.()) ? o.expected() : undefined;
      const r = await call(fetchImpl, 'POST', url('/start'), {
        file: state.file,
        targets: artboards.map(asTarget),
        perVoter,
        durationS,
        ...(title ? { title } : {}),
        ...(expected ? { expected } : {}),
      });
      if (r.status !== 201) return { ok: false, line: r.data?.line ?? VOTE_WORDS.failed };
      set({ sheet: null });
      await load();
      return { ok: true };
    },
    /**
     * A dot on (`+1`) or off (`-1`) an artboard — `vote-cast {artboard, remove?}` from the canvas.
     * sec-a M2: it moves a PENDING pick only; nothing is posted until the person presses Cast.
     */
    pick(artboard, delta = 1) {
      const v = state.vote;
      if (!v || v.state !== 'open' || !state.canVote) return { ok: false };
      const from = state.pending ?? state.mine;
      const picks = nextPicks(from, asTarget(artboard), delta, v.perVoter, v.targets);
      if (!picks) {
        if (delta > 0 && v.targets.includes(asTarget(artboard))) notify(VOTE_WORDS.noneLeft);
        return { ok: false };
      }
      set({ pending: samePicks(picks, state.mine) ? null : picks });
      return { ok: true };
    },
    /** Drop the pending picks: back to the ballot as cast. */
    clearPending() {
      if (state.pending !== null) set({ pending: null });
    },
    /** The bar's Cast button (a shell gesture): post the pending picks as the session's ballot. */
    async cast() {
      const v = state.vote;
      const picks = state.pending;
      if (!v || v.state !== 'open' || !state.canVote || picks === null) return { ok: false };
      const r = await call(fetchImpl, 'POST', url('/ballot'), {
        file: state.file,
        id: v.id,
        picks,
      });
      if (r.status !== 200) {
        notify(r.data?.line ?? VOTE_WORDS.castFailed);
        if (r.status === 409) void load();
        return { ok: false };
      }
      set({ mine: r.data.mine ?? picks, pending: null, vote: r.data.vote ?? v });
      return { ok: true };
    },
    async end() {
      const v = state.vote;
      if (!v || v.state !== 'open' || !state.canEdit) return;
      await finish(v.id);
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
      subs.clear();
    },
  };
}

/** The page's one store. */
export const voteStore = createVoteStore();
