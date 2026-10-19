// Formal votes — the studio's door (S4.14, Gate 0 A18, contract S4-S9-votes-comments §1, §2.4, §4).
//
//   GET  /_api/votes?file=<canvas>                       read   the canvas's votes + YOUR picks
//   POST /_api/votes/start  { file, targets, title?, perVoter?, durationS?, expected? }   edit
//   POST /_api/votes/ballot { file, id, picks }          vote   cast / replace / withdraw ({}) yours
//   POST /_api/votes/end    { file, id, labels?, place? } edit  end it; the result section is written
//
// Where a vote lives (`deps.home()`, §1):
//   - `local` (no hub): the board — a `vote` element plus one `ballot` element per voter
//     (annotations/votes-local.ts). Your own picks are answered to you; everyone else's stay out of
//     every answer until the vote has ended (the sheet says the files themselves can show them).
//   - `hub` (linked, `/health` advertises `votes-v1`): this route is a PROXY to the hub's
//     `/api/projects/:p/v1/votes*` with the project's bearer. The hub holds the ballots and the
//     timer; the board gets only the `vote` element at the start and its counts + the result
//     section at the end. A ballot never touches the board, a file, or another session's answer.
//   - `off` (linked to a hub without `votes-v1`, or a home that can't keep ballots secret): every
//     write is 409 `votes-off` with the line; the sheet shows it and offers nothing.
//
// The voter is the SESSION's person (`deps.person`), never a body field. MAIN ORIGIN ONLY, CSRF +
// loopback (guardTableRoute), in neither canvas allowlist: the untrusted canvas asks through the
// shell (dgn `vote-cast`) and hears back only the projection (dgn `vote-state`). Capabilities
// (access/request.ts): GET = read, `ballot` = `vote` (Can comment and up; Can view refused), `start` /
// `end` = edit (`readOnly: 'refused'`). A canvas-only session gets `not-in-scope` for a canvas it
// does not hold — the same answer as a missing route (no oracle).

import { toDesignRel } from '../access/request.ts';
import type { Op } from '../annotations/ops.ts';
import { parseBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  boardVotes,
  castOps,
  cloudEndOps,
  cloudVoteElement,
  endOps,
  lapsedOps,
  type Picks,
  type ResultHints,
  resultOps,
  startOps,
  VOTE_ID_RE,
  type VoteRow,
} from '../annotations/votes-local.ts';
import type { RouteSpec } from './table.ts';

export const VOTES_PATH = '/_api/votes';
export const VOTES_START_PATH = '/_api/votes/start';
export const VOTES_BALLOT_PATH = '/_api/votes/ballot';
export const VOTES_END_PATH = '/_api/votes/end';

/** §1 — the sheet's words. */
export const LOCAL_SECRECY_LINE = "Anyone who can open this project's files can see the votes.";
export const OFF_LINE =
  "This team server can't keep votes secret yet — ask whoever runs it to update.";
const UNREACHABLE_LINE = "Can't reach the team server. Your vote is kept there — try again.";

const MAX_BODY = 16 * 1024;

export type VoteHome =
  | { kind: 'local' }
  | { kind: 'hub'; hubUrl: string; token: () => string | null; projectId?: string }
  | { kind: 'off' };

export interface VoteRouteDeps {
  designRel: string;
  /** Where this project's votes live (§1). Decided per request: a link can change under us. */
  home(): Promise<VoteHome> | VoteHome;
  /** The voter / starter: the session's person, never the body. */
  person(req: Request): Promise<string>;
  readBoard(
    file: string
  ): Promise<{ ok: true; text: string | null } | { ok: false; error: string }>;
  applyOps(file: string, ops: Op[]): Promise<{ ok: boolean; error?: string }>;
  /** S9.9 — a canvas-only session acts on the canvases it holds; a Response refuses (as missing). */
  scope?: (req: Request, file: string) => Response | null;
  /**
   * sec-a C1(c) — the result's names: target (`ab:<id>`) → the artboard's label, read by the SERVER
   * from the canvas source (designRoot-relative `canvas`). Never the body's labels: those come off
   * the untrusted canvas (`vote-board`). Absent → the result names each target by its id.
   */
  labels?: (canvas: string) => Promise<Record<string, string>> | Record<string, string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const LINES: Record<string, string> = {
  invalid: "That ballot doesn't fit this vote.",
  'vote-open': 'A vote is already open on this canvas.',
  capacity: 'Too many votes are open in this project.',
  ended: 'This vote has ended.',
  'not-found': 'No such vote.',
  'votes-off': OFF_LINE,
  unreachable: UNREACHABLE_LINE,
  forbidden: "You can't do that in this project.",
  'rate-limited': 'Too many vote changes at once. Try again in a minute.',
};
const STATUS: Record<string, number> = {
  invalid: 400,
  'vote-open': 409,
  capacity: 429,
  ended: 409,
  'not-found': 404,
  'votes-off': 409,
  unreachable: 503,
  forbidden: 403,
  'rate-limited': 429,
};
const refuse = (code: string) =>
  json(STATUS[code] ?? 400, { ok: false, code, line: LINES[code] ?? LINES.invalid });

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get('content-length')) > MAX_BODY)
    return json(413, { ok: false, code: 'too-large' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, code: 'too-large' });
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return json(400, { ok: false, code: 'invalid', line: 'Not a vote request.' });
}

const validFile = (f: unknown): f is string =>
  typeof f === 'string' && f.length > 0 && f.length <= 1024 && !f.includes('\0');

/**
 * The place from the shell (sanitized, optional) + the labels the SERVER read (sec-a C1(c)): a body
 * `labels` map is ignored — the shell takes it off the untrusted canvas, and the result text is the
 * one line people read as the outcome.
 */
function hintsOf(body: Record<string, unknown>, labels: Record<string, string> = {}): ResultHints {
  const hints: ResultHints = {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels).slice(0, 64))
    if (typeof v === 'string' && k.length <= 200) out[k] = v.slice(0, 120);
  hints.labels = out;
  const p = body.place as { x?: unknown; y?: unknown } | undefined;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
    hints.place = { x: p.x as number, y: p.y as number };
  return hints;
}

/** A hub row reduced to the VoteRow fields — the proxy forwards nothing else. */
function asRow(v: unknown): VoteRow | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !VOTE_ID_RE.test(r.id) || typeof r.canvas !== 'string')
    return null;
  const row: VoteRow = {
    id: r.id,
    canvas: r.canvas,
    targets: Array.isArray(r.targets)
      ? r.targets.filter((t): t is string => typeof t === 'string')
      : [],
    title: typeof r.title === 'string' ? r.title : '',
    perVoter: typeof r.perVoter === 'number' ? r.perVoter : 3,
    state: r.state === 'ended' ? 'ended' : 'open',
    startedBy: typeof r.startedBy === 'string' ? r.startedBy : '',
    startedAt: Number(r.startedAt) || 0,
    endsAt: Number(r.endsAt) || 0,
    done: Array.isArray(r.done) ? r.done.filter((t): t is string => typeof t === 'string') : [],
  };
  if (typeof r.expected === 'number') row.expected = r.expected;
  if (row.state === 'ended') {
    row.endedAt = Number(r.endedAt) || row.endsAt;
    row.tallies =
      r.tallies && typeof r.tallies === 'object'
        ? { ...(r.tallies as Record<string, number>) }
        : {};
    row.voters = typeof r.voters === 'number' ? r.voters : 0;
  }
  return row;
}

const asPicksOut = (m: unknown): Picks =>
  m && typeof m === 'object' && !Array.isArray(m) ? { ...(m as Picks) } : {};

/** An open local vote whose time is up reads as ended (counts revealed), before any write. */
function virtualEnd(
  elements: AnnotationElement[],
  canvas: string,
  now: number
): AnnotationElement[] {
  const ops = lapsedOps(elements, canvas, now).filter((o) => o.op === 'patch');
  if (!ops.length) return elements;
  return elements.map((e) => {
    const p = ops.find((o) => o.op === 'patch' && o.id === e.id);
    return p && p.op === 'patch' ? ({ ...e, ...p.set } as AnnotationElement) : e;
  });
}

export function createVoteRoutes(deps: VoteRouteDeps): RouteSpec[] {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function elementsOf(file: string): Promise<AnnotationElement[] | null> {
    const r = await deps.readBoard(file);
    if (!r.ok) return null;
    return r.text ? parseBoard(r.text).elements : [];
  }

  async function hub(
    h: Extract<VoteHome, { kind: 'hub' }>,
    method: 'GET' | 'POST',
    route: string,
    body?: unknown
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const token = h.token();
    const base = h.hubUrl.replace(/\/+$/, '');
    try {
      const res = await fetchImpl(
        `${base}/api/projects/${encodeURIComponent(h.projectId ?? 'current')}/v1/${route}`,
        {
          method,
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(5_000),
        }
      );
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { status: res.status, json: j && typeof j === 'object' ? j : null };
    } catch {
      return { status: 0, json: null };
    }
  }
  /** A hub refusal as our answer: its code when it is one we name, else `unreachable`. */
  const hubRefusal = (r: { status: number; json: Record<string, unknown> | null }) => {
    const code =
      typeof r.json?.code === 'string'
        ? r.json.code
        : typeof r.json?.refused === 'string'
          ? r.json.refused
          : '';
    if (code && code in STATUS) return refuse(code);
    if (r.status === 404) return refuse('not-found');
    if (r.status === 403) return refuse('forbidden');
    return refuse('unreachable');
  };

  /** Parse { file, … } and judge scope; answers the canvas both as the repo file and designRoot-rel. */
  async function begin(
    req: Request
  ): Promise<{ body: Record<string, unknown>; file: string; canvas: string } | Response> {
    const body = await readBody(req);
    if (body instanceof Response) return body;
    if (!validFile(body.file))
      return json(400, { ok: false, code: 'invalid', line: 'Which canvas?' });
    const canvas = toDesignRel(body.file, deps.designRel);
    if (canvas === null) return json(400, { ok: false, code: 'invalid', line: 'Which canvas?' });
    const refused = deps.scope?.(req, body.file);
    if (refused) return refused;
    return { body, file: body.file, canvas };
  }

  /** The hub row for `id`, only when it is THIS canvas's vote (else: as missing, U1). */
  async function hubRow(h: Extract<VoteHome, { kind: 'hub' }>, id: string, canvas: string) {
    const r = await hub(h, 'GET', `votes/${encodeURIComponent(id)}`);
    const row = r.status === 200 ? asRow(r.json?.vote) : null;
    if (!row || row.canvas !== canvas) return { row: null, mine: null, r };
    return { row, mine: r.json?.mine === undefined ? null : asPicksOut(r.json.mine), r };
  }

  return [
    {
      method: 'GET',
      path: '/_api/votes', // = VOTES_PATH (the route scrapers read the literal)
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const file = new URL(req.url).searchParams.get('file');
        if (!validFile(file))
          return json(400, { ok: false, code: 'invalid', line: 'Which canvas?' });
        const canvas = toDesignRel(file, deps.designRel);
        if (canvas === null)
          return json(400, { ok: false, code: 'invalid', line: 'Which canvas?' });
        const refused = deps.scope?.(req, file);
        if (refused) return refused;
        const home = await deps.home();
        const me = await deps.person(req);
        if (home.kind === 'off')
          return json(200, { ok: true, mode: 'off', line: OFF_LINE, votes: [], mine: {}, me });
        if (home.kind === 'local') {
          const els = await elementsOf(file);
          if (!els)
            return json(503, {
              ok: false,
              code: 'unreadable',
              line: "This canvas's notes can't be read.",
            });
          const { votes, mine } = boardVotes(virtualEnd(els, canvas, now()), canvas, me);
          return json(200, { ok: true, mode: 'local', line: LOCAL_SECRECY_LINE, votes, mine, me });
        }
        const list = await hub(home, 'GET', `votes?canvas=${encodeURIComponent(canvas)}`);
        if (list.status !== 200 || !Array.isArray(list.json?.votes)) return hubRefusal(list);
        const votes = (list.json.votes as unknown[])
          .map(asRow)
          .filter((v): v is VoteRow => v !== null && v.canvas === canvas);
        const mine: Record<string, Picks> = {};
        // `mine` is per vote, from the hub, for THIS session's person — one GET per open vote (≤ 1 per canvas).
        for (const v of votes) {
          if (v.state !== 'open') continue;
          const one = await hubRow(home, v.id, canvas);
          if (one.mine) mine[v.id] = one.mine;
        }
        return json(200, { ok: true, mode: 'hub', votes, mine, me });
      },
    },
    {
      method: 'POST',
      path: '/_api/votes/start', // = VOTES_START_PATH
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const b = await begin(req);
        if (b instanceof Response) return b;
        const home = await deps.home();
        if (home.kind === 'off') return refuse('votes-off');
        const me = await deps.person(req);
        if (home.kind === 'local') {
          const els = await elementsOf(b.file);
          if (!els) return refuse('unreachable');
          const t = now();
          const lapsed = lapsedOps(els, b.canvas, t);
          const after = lapsed.length ? virtualEnd(els, b.canvas, t) : els;
          const s = startOps(after, b.body, me, t);
          if ('refused' in s) return refuse(s.refused);
          const w = await deps.applyOps(b.file, [...lapsed, ...s.ops]);
          if (!w.ok) return refuse('unreachable');
          const { votes } = boardVotes([...after, s.vote], b.canvas, me);
          return json(201, { ok: true, vote: votes.find((v) => v.id === s.vote.id) });
        }
        const { targets, title, perVoter, durationS, expected } = b.body;
        const r = await hub(home, 'POST', 'votes', {
          canvas: b.canvas,
          targets,
          ...(title !== undefined ? { title } : {}),
          ...(perVoter !== undefined ? { perVoter } : {}),
          ...(durationS !== undefined ? { durationS } : {}),
          ...(expected !== undefined ? { expected } : {}),
        });
        const row = r.status === 201 ? asRow(r.json?.vote) : null;
        if (!row) return hubRefusal(r);
        // The board learns the vote (targets, times) — never a ballot.
        const els = (await elementsOf(b.file)) ?? [];
        await deps.applyOps(b.file, [{ op: 'put', el: cloudVoteElement(row, els) }]);
        return json(201, { ok: true, vote: row });
      },
    },
    {
      method: 'POST',
      path: '/_api/votes/ballot', // = VOTES_BALLOT_PATH
      origin: 'main',
      // A read-only session may call it; WHICH capability it needs (`vote`) is
      // access/request.ts VOTE_TABLE_WRITES — never the table's default `session`.
      readOnly: 'allowed',
      handle: async (req) => {
        const b = await begin(req);
        if (b instanceof Response) return b;
        const id = b.body.id;
        if (typeof id !== 'string' || !VOTE_ID_RE.test(id)) return refuse('not-found');
        const home = await deps.home();
        if (home.kind === 'off') return refuse('votes-off');
        const me = await deps.person(req);
        if (home.kind === 'local') {
          const els = await elementsOf(b.file);
          if (!els) return refuse('unreachable');
          const c = castOps(els, id, me, b.body.picks, now());
          if ('refused' in c) return refuse(c.refused);
          if (c.ops.length) {
            const w = await deps.applyOps(b.file, c.ops);
            if (!w.ok) return refuse('unreachable');
          }
          const fresh = (await elementsOf(b.file)) ?? els;
          const { votes } = boardVotes(fresh, b.canvas, me);
          return json(200, { ok: true, vote: votes.find((v) => v.id === id), mine: c.mine });
        }
        // The vote must be THIS canvas's (the hub judges the session's closure; we judge `file`).
        const one = await hubRow(home, id, b.canvas);
        if (!one.row)
          return one.r.status === 200 || one.r.status === 404
            ? refuse('not-found')
            : hubRefusal(one.r);
        const r = await hub(home, 'POST', `votes/${encodeURIComponent(id)}/ballot`, {
          picks: b.body.picks,
        });
        const row = r.status === 200 ? asRow(r.json?.vote) : null;
        if (!row) return hubRefusal(r);
        return json(200, { ok: true, vote: row, mine: asPicksOut(r.json?.mine) });
      },
    },
    {
      method: 'POST',
      path: '/_api/votes/end', // = VOTES_END_PATH
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const b = await begin(req);
        if (b instanceof Response) return b;
        const id = b.body.id;
        if (typeof id !== 'string' || !VOTE_ID_RE.test(id)) return refuse('not-found');
        const home = await deps.home();
        if (home.kind === 'off') return refuse('votes-off');
        const hints = hintsOf(b.body, (await deps.labels?.(b.canvas)) ?? {});
        const me = await deps.person(req);
        if (home.kind === 'local') {
          const els = await elementsOf(b.file);
          if (!els) return refuse('unreachable');
          const e = endOps(els, id, b.canvas, now(), hints);
          if ('refused' in e) {
            if (e.refused !== 'ended') return refuse(e.refused);
            // Already ended (the timer, or another editor): the result section, once.
            const { votes } = boardVotes(els, b.canvas, me);
            const row = votes.find((v) => v.id === id);
            if (!row) return refuse('not-found');
            const ops = resultOps(els, row, hints);
            if (ops.length) await deps.applyOps(b.file, ops);
            return json(200, { ok: true, vote: row });
          }
          const w = await deps.applyOps(b.file, e.ops);
          if (!w.ok) return refuse('unreachable');
          return json(200, { ok: true, vote: e.row });
        }
        const one = await hubRow(home, id, b.canvas);
        if (!one.row)
          return one.r.status === 200 || one.r.status === 404
            ? refuse('not-found')
            : hubRefusal(one.r);
        let row = one.row;
        if (row.state !== 'ended') {
          const r = await hub(home, 'POST', `votes/${encodeURIComponent(id)}/end`);
          const ended = r.status === 200 ? asRow(r.json?.vote) : null;
          if (ended) row = ended;
          else if (r.status === 409) {
            const again = await hubRow(home, id, b.canvas);
            if (!again.row) return hubRefusal(r);
            row = again.row;
          } else return hubRefusal(r);
        }
        // Counts revealed at once: the board's vote element + the result section, written once.
        const els = (await elementsOf(b.file)) ?? [];
        const ops = cloudEndOps(els, row, hints);
        if (ops.length) await deps.applyOps(b.file, ops);
        return json(200, { ok: true, vote: row });
      },
    },
  ];
}

/**
 * §1 — where this project's votes live, decided fail-closed:
 *   not linked (and not a cell)            → `local` (board ballots, the sheet's secrecy line)
 *   a cell                                 → `off` until the cell has a hub path for votes (S4.14
 *                                            Continue); board ballots there would sync to everyone
 *   linked, `/health` has `votes-v1`       → `hub`
 *   linked, the hub can't be reached       → `hub` (calls answer `unreachable`) — never local
 *   linked, the hub answers without it     → `off` (an older team server)
 * The `/health` answer is kept for a minute.
 */
export function createVoteHomeResolver(o: {
  linked: () => { hubUrl: string; token: () => string | null; projectId?: string } | null;
  workspace: () => boolean;
  health: (hubUrl: string) => Promise<{ capabilities: string[] | null }>;
  now?: () => number;
}): () => Promise<VoteHome> {
  const now = o.now ?? (() => Date.now());
  let cache: { url: string; at: number; caps: string[] | null } | null = null;
  return async () => {
    if (o.workspace()) return { kind: 'off' };
    const link = o.linked();
    if (!link) return { kind: 'local' };
    if (!cache || cache.url !== link.hubUrl || now() - cache.at > 60_000 || cache.caps === null) {
      const { capabilities } = await o.health(link.hubUrl);
      cache = { url: link.hubUrl, at: now(), caps: capabilities };
    }
    if (cache.caps === null || cache.caps.includes('votes-v1')) return { kind: 'hub', ...link };
    return { kind: 'off' };
  };
}
