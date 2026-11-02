// Formal votes over HTTP — Gate 0 A18, contract S4-S9-votes-comments.md §2.4–§2.6
// (S9.13, the votes half; the store is `../votes.mjs`, S4.6).
//
//   GET  votes?canvas=<path>&after=<seq>   read   the votes this session sees
//   GET  votes/:id                         read   one vote (+ `mine` when you hold `vote`)
//   POST votes                             edit   start a vote on a canvas
//   POST votes/:id/ballot   { picks }      vote   cast / replace / withdraw ({}) your ballot
//   POST votes/:id/end                     edit   end it: counts revealed, ballots deleted
//
// All under `/api/projects/:p/v1/`, bearer auth, in NEITHER canvas allowlist
// (the canvas origin is one row, `CANVAS_ORIGIN_ROW`, with no handler).
// `canvasDoor`: a canvas-only session passes the gate when ANY grant holds the
// capability; the handler then judges the vote's own canvas, and a vote on a
// canvas the session cannot see answers EXACTLY as a missing vote (U1).
//
// Each route is ONE store call that decides (one transaction); a ballot route
// first reads the vote to judge its canvas — a vote's canvas never changes,
// so that read cannot race the write into a wrong answer.
//
// SECRECY (§2.6). A ballot reaches exactly one client: its voter, in the
// answer to their own `POST ballot` / `GET votes/:id`. No poke carries picks
// (`{t:'votes', seq}` is payload-free), no response to anyone else carries
// `mine`, nothing is logged, and the awareness hook drops `ballot` / `picks` /
// `vote` keys from every client state (`stripVoteAwareness`).

import { connectionClaimDecides } from '../access-files.mjs';
import { OBSERVER_REFUSAL, READ_ONLY_REFUSAL } from '../access-gate.mjs';
import { documentMap, FILES_CTL_DOC } from '../files-ctl.mjs';
import { matchesScope } from '../tokens.mjs';
import { asVoteCanvas } from '../votes.mjs';

/** The `/health` capability a v2 studio looks for before it offers "Start a vote…". */
export const VOTES_CAPABILITY = 'votes-v1';

const PROJECT = '[A-Za-z0-9._-]{1,128}';
const SEG = '[A-Za-z0-9_-]{1,128}';
const base = `^/api/projects/(${PROJECT})/v1/votes`;
export const VOTES_COLLECTION_ROUTE = new RegExp(`${base}$`);
export const VOTES_ONE_ROUTE = new RegExp(`${base}/(${SEG})$`);
export const VOTES_BALLOT_ROUTE = new RegExp(`${base}/(${SEG})/ballot$`);
export const VOTES_END_ROUTE = new RegExp(`${base}/(${SEG})/end$`);

export const VOTES_BODY_BYTES = 16 * 1024;
export const VOTES_POKE_COALESCE_MS = 100;
/**
 * Vote writes (start, ballot, end) per person per minute. A ballot is one call
 * per dot moved, so the budget is generous; it exists so one credential cannot
 * turn the store (one transaction per call) into a write amplifier.
 */
export const VOTES_WRITE_LIMIT = Object.freeze({ max: 240, windowMs: 60_000 });
const RATE_LIMITED = Object.freeze({
  code: 'rate-limited',
  error: 'Too many vote changes at once. Try again in a minute.',
});
/** Ceiling on tracked people — a flood of actors must not grow the map unbounded. */
const MAX_TRACKED_ACTORS = 10_000;

/**
 * A sliding-window counter per key, in memory. Votes are not a brute-force
 * surface (every call is already authenticated), so the persistent
 * `rate-store.mjs` buys nothing here; a restart resetting it is fine.
 */
export function createWriteLimiter({ max, windowMs } = VOTES_WRITE_LIMIT) {
  const hits = new Map();
  return {
    check(key, now) {
      const floor = now - windowMs;
      const list = (hits.get(key) ?? []).filter((t) => t > floor);
      if (list.length >= max) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      if (!hits.has(key) && hits.size >= MAX_TRACKED_ACTORS) {
        for (const [k, v] of hits) if (!v.some((t) => t > floor)) hits.delete(k);
        if (hits.size >= MAX_TRACKED_ACTORS) hits.delete(hits.keys().next().value);
      }
      hits.set(key, list);
      return true;
    },
  };
}

const STATUS = { invalid: 400, 'not-found': 404, ended: 409, 'vote-open': 409, capacity: 429 };
const NOT_FOUND = Object.freeze({ code: 'not-found', error: 'no such vote' });

/** Awareness keys no client may publish (picks must never ride presence). */
export const VOTE_AWARENESS_KEYS = Object.freeze(['ballot', 'picks', 'vote']);

/**
 * `beforeHandleAwareness` — drop `ballot`, `picks` and `vote` from every client
 * state, whoever sent it (defence in depth: no vote client publishes them).
 * Mutates in place, which is what the re-encode downstream sees.
 *
 * @returns {number} how many states lost a key
 */
export function stripVoteAwareness({ states }) {
  if (!states || typeof states.values !== 'function') return 0;
  let n = 0;
  for (const state of states.values()) {
    if (!state || typeof state !== 'object') continue;
    let hit = false;
    for (const k of VOTE_AWARENESS_KEYS) {
      if (k in state) {
        delete state[k];
        hit = true;
      }
    }
    if (hit) n += 1;
  }
  return n;
}

/**
 * The votes poke: `{t:'votes', seq}` on the control document, coalesced to the
 * latest seq. Project sessions hear every one; a canvas-only connection hears
 * it only when a changed vote's canvas is in its grants
 * (`visibility.votesVisible`, V2-1.16 L3). No visibility wired ⇒ such a
 * connection hears nothing. Never throws.
 */
export function createVotesPoke({
  instance,
  visibility = null,
  coalesceMs = VOTES_POKE_COALESCE_MS,
  log = console,
  setTimeoutImpl = setTimeout,
}) {
  let timer = null;
  let pending = 0;
  let sentSeq = 0;
  let canvases = new Set();
  let sent = 0;
  const emit = () => {
    timer = null;
    const seq = pending;
    const touched = canvases;
    canvases = new Set();
    const doc = documentMap(instance)?.get(FILES_CTL_DOC);
    if (!doc) return;
    const frame = JSON.stringify({ t: 'votes', seq });
    try {
      let connections = [];
      try {
        connections = doc.getConnections?.() ?? [];
      } catch {
        connections = [];
      }
      doc.broadcastStateless(frame, (c) => !connectionClaimDecides(c));
      for (const c of connections) {
        if (!connectionClaimDecides(c) || !visibility) continue;
        if ([...touched].some((canvas) => visibility.votesVisible(c, canvas))) {
          c.sendStateless(frame);
        }
      }
      sentSeq = seq;
      sent += 1;
    } catch (err) {
      log.error?.(`[votes] poke broadcast failed: ${err.message}`);
    }
  };
  return {
    schedule(seq, touched = []) {
      if (!Number.isSafeInteger(seq) || seq <= sentSeq) return;
      for (const c of touched) canvases.add(c);
      if (seq > pending) pending = seq;
      if (timer !== null) return;
      timer = setTimeoutImpl(emit, coalesceMs);
      timer?.unref?.();
    },
    flushNow() {
      if (timer !== null) clearTimeout(timer);
      emit();
    },
    sent: () => sent,
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > VOTES_BODY_BYTES) return { tooLarge: true };
    chunks.push(chunk);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { body: v } : {};
  } catch {
    return {};
  }
}

/**
 * The runtime behind the rows. `server.mjs` builds one per hub and hands it to
 * `runHubRoutes` as `deps.votes`.
 *
 * @param {object} deps
 * @param {object} deps.store        the project store (votes* methods)
 * @param {string} deps.projectId    this hub's project (`:p` must name it, or `current`)
 * @param {(request: object) => object | null} deps.auth  `{ actor, readOnly, access? }`
 * @param {{ schedule: (seq: number, canvases: string[]) => void } | null} [deps.poke]
 * @param {() => number} [deps.now]  the best-effort end timer and the write limiter
 * @param {{ max: number, windowMs: number } | null} [deps.writeLimit]  per-person write
 *   budget (default `VOTES_WRITE_LIMIT`; null = off, the hub's `rateLimit: false`)
 */
export function createVotesRoutes({
  store,
  projectId,
  auth,
  poke = null,
  now = () => Date.now(),
  writeLimit = VOTES_WRITE_LIMIT,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  log = console,
}) {
  const limiter = writeLimit ? createWriteLimiter(writeLimit) : null;

  /** May `who` use `cap` on `canvas`? A non-peer credential (operator, cell secret) is project-level. */
  function holds(who, cap, canvas) {
    const access = who.access;
    if (!access) return cap === 'read' || !who.readOnly;
    // A project session keeps DDR-053's machine scope — the file door's `sees`
    // and `/present/<canvas>`'s rule: a vote outside it is a missing vote.
    if (access.role !== null && !matchesScope(who.scope ?? '*', canvas)) return false;
    if (!access.can(cap, canvas)) return false;
    // The read_only projection stays the floor for a project session's edits.
    if (!access.canvasOnly && who.readOnly && cap === 'edit') return false;
    return true;
  }

  function refuse(who, respondJson) {
    const body = who.access?.role === 'observer' ? OBSERVER_REFUSAL : READ_ONLY_REFUSAL;
    respondJson(403, { ...body });
    return true;
  }

  const noted = (r) => {
    if (r && Number.isSafeInteger(r.seq) && Array.isArray(r.touched) && r.touched.length > 0) {
      poke?.schedule(r.seq, r.touched);
    }
    return r;
  };

  // Best-effort end timer (§2.5): it only makes the poke prompt. Correctness
  // never depends on it — every store call ends lapsed votes first.
  const ends = new Set();
  let timer = null;
  function arm(endsAt) {
    if (Number.isSafeInteger(endsAt)) ends.add(endsAt);
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
    if (ends.size === 0) return;
    const next = Math.min(...ends);
    timer = setTimeoutImpl(fire, Math.max(0, next - now()) + 50);
    timer?.unref?.();
  }
  async function fire() {
    timer = null;
    const t = now();
    for (const e of [...ends]) if (e <= t) ends.delete(e);
    try {
      noted(await store.votesList({ project: projectId, after: Number.MAX_SAFE_INTEGER }));
    } catch (err) {
      log.error?.(`[votes] end timer: ${err.message}`);
    }
    arm(null);
  }

  function refusal(respondJson, r) {
    if (r.refused === 'not-found') respondJson(404, { ...NOT_FOUND });
    else respondJson(STATUS[r.refused] ?? 409, { code: r.refused });
    return true;
  }

  /** The vote, when this session may see it; otherwise null (answered as missing). */
  async function visibleVote(who, voteId) {
    const r = await store.votesGet({ project: projectId, voteId, actor: who.actor });
    noted(r);
    if (r.refused || !holds(who, 'read', r.vote.canvas)) return null;
    return r;
  }

  /** The canvases a canvas-only session may read; null = every canvas (a project session). */
  function readableCanvases(who) {
    const access = who.access;
    if (!access?.canvasOnly) return null;
    return access.grants.filter((g) => access.can('read', g.c)).map((g) => g.c);
  }

  /**
   * One request. Returns true when answered, false when the path is not a votes
   * route (or the store is not wired).
   */
  async function handle({ path, method, request, respondJson }) {
    let m = VOTES_COLLECTION_ROUTE.exec(path);
    let kind = 'collection';
    if (!m) [m, kind] = [VOTES_ONE_ROUTE.exec(path), 'one'];
    if (!m) [m, kind] = [VOTES_BALLOT_ROUTE.exec(path), 'ballot'];
    if (!m) [m, kind] = [VOTES_END_ROUTE.exec(path), 'end'];
    if (!m) return false;
    const [, project, voteId] = m;
    const who = auth(request);
    if (!who) {
      respondJson(401, { error: 'sign in to this project first', code: 'unauthenticated' });
      return true;
    }
    if (project !== projectId && project !== 'current') {
      respondJson(404, { error: 'no such project', code: 'unknown-project' });
      return true;
    }
    const isGet = method === 'GET' || method === 'HEAD';

    if (kind === 'collection' && isGet) {
      const query = new URL(request.url ?? path, 'http://x').searchParams;
      const after = Number.parseInt(query.get('after') ?? '', 10);
      const canvas = query.get('canvas');
      let canvases = readableCanvases(who);
      if (canvas !== null) {
        const c = asVoteCanvas(canvas);
        canvases = c && (canvases === null || canvases.includes(c)) ? [c] : [];
      }
      const r = noted(
        await store.votesList({
          project: projectId,
          ...(canvases ? { canvases } : {}),
          ...(Number.isSafeInteger(after) ? { after } : {}),
        })
      );
      if (r.refused) return refusal(respondJson, r);
      const votes = r.votes.filter((v) => holds(who, 'read', v.canvas));
      for (const v of votes) if (v.state === 'open') ends.add(v.endsAt);
      respondJson(200, { seq: r.seq, votes });
      return true;
    }

    if (kind === 'one' && isGet) {
      const r = await visibleVote(who, voteId);
      if (!r) return refusal(respondJson, { refused: 'not-found' });
      const mine = r.mine && holds(who, 'vote', r.vote.canvas) ? { mine: r.mine } : {};
      respondJson(200, { vote: r.vote, ...mine });
      return true;
    }

    if (method !== 'POST' || kind === 'one') {
      respondJson(405, { code: 'method-not-allowed' });
      return true;
    }
    // Before the body is read: a flood costs a request, never a transaction.
    if (limiter && !limiter.check(who.actor, now())) {
      respondJson(429, { ...RATE_LIMITED });
      return true;
    }

    const read = await readJson(request);
    if (read.tooLarge) {
      respondJson(413, { code: 'too-large' });
      return true;
    }
    const b = read.body;
    if (!b) {
      respondJson(400, { code: 'invalid', error: 'a JSON object body is required' });
      return true;
    }

    if (kind === 'collection') {
      const canvas = asVoteCanvas(b.canvas);
      if (!canvas) return refusal(respondJson, { refused: 'invalid' });
      if (!holds(who, 'edit', canvas)) return refuse(who, respondJson);
      const r = noted(
        await store.votesStart({
          project: projectId,
          canvas,
          targets: b.targets,
          title: b.title,
          perVoter: b.perVoter,
          durationS: b.durationS,
          expected: b.expected,
          actor: who.actor,
        })
      );
      if (r.refused) return refusal(respondJson, r);
      arm(r.vote.endsAt);
      respondJson(201, { vote: r.vote });
      return true;
    }

    const seen = await visibleVote(who, voteId);
    if (!seen) return refusal(respondJson, { refused: 'not-found' });
    const canvas = seen.vote.canvas;

    if (kind === 'ballot') {
      if (!holds(who, 'vote', canvas)) return refuse(who, respondJson);
      // The voter is the session's person — a `voter` in the body is ignored.
      const r = noted(
        await store.votesCast({ project: projectId, voteId, actor: who.actor, picks: b.picks })
      );
      if (r.refused) return refusal(respondJson, r);
      respondJson(200, { vote: r.vote, mine: r.mine });
      return true;
    }

    // kind === 'end'
    if (!holds(who, 'edit', canvas)) return refuse(who, respondJson);
    const r = noted(await store.votesEnd({ project: projectId, voteId, actor: who.actor }));
    if (r.refused) return refusal(respondJson, r);
    respondJson(200, { vote: r.vote });
    return true;
  }

  return {
    handle,
    close() {
      if (timer !== null) clearTimeoutImpl(timer);
      timer = null;
      ends.clear();
    },
  };
}

/** The row handler: the runtime comes in through `ctx.deps.votes` (server.mjs). */
async function votesHandler(ctx) {
  const votes = ctx.deps?.votes;
  if (!votes || typeof votes.handle !== 'function') return false;
  return votes.handle(ctx);
}

/**
 * The rows (one table, S9 Q12). `canvasDoor`: the handler judges each vote's
 * canvas. Starting answers per canvas too (the collection row's `filtered`
 * class is the GET's; the POST names its canvas in the body).
 */
export const VOTES_ROWS = Object.freeze([
  {
    pattern: VOTES_COLLECTION_ROUTE,
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'filtered',
    canvasDoor: true,
    handler: votesHandler,
  },
  {
    pattern: VOTES_ONE_ROUTE,
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
    handler: votesHandler,
  },
  {
    pattern: VOTES_BALLOT_ROUTE,
    cap: { safe: 'read', unsafe: 'vote' },
    scope: 'canvas',
    canvasDoor: true,
    handler: votesHandler,
  },
  {
    pattern: VOTES_END_ROUTE,
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'canvas',
    canvasDoor: true,
    handler: votesHandler,
  },
]);
