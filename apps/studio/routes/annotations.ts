// Sticky ↔ comment — contract S4-S9-votes-comments §3 (S4.7, V2-1.5).
//
//   POST /_api/annotations/to-comment     { file, id }     → 200 { ok, commentId, actionId? | undoToken? }
//   POST /_api/comments/to-sticky         { commentId }    → 200 { ok, stickyId, actionId? | undoToken? }
//   POST /_api/annotations/convert-undo   { token }        → 200 { ok } · 409 stale | has-replies
//
// ONE conversion = ONE project action with two `lane.replace` ops — the board
// (`annotations`) and the thread list (`comments`) of the same canvas — so ⌘Z,
// the toast's Undo and the thread header's Undo are all `POST /_api/project/undo
// { actionId }` and the kernel restores both lanes together. A home with no op
// log (a legacy link, the local store turned off) gets an in-memory undo token
// instead (`convert-undo`, the S2.1 revert-fallback pattern).
//
// MAIN ORIGIN ONLY, CSRF + loopback (guardTableRoute), never canvas-safe: the
// untrusted canvas asks through the shell (dgn `annotation-to-comment`). Both
// conversions need `annotate` (an edit — `readOnly: 'refused'`), which Can
// comment and Can view do not hold.
//
// Authorship (§3.1): the comment's `author` is the CONVERTER (the session); the
// sticky's author travels in `from.author`, read from the board, never from the
// body — `from` enters the record only through the trusted `OpContext.from`.

import { randomBytes } from 'node:crypto';
import { keyBetween } from '../annotations/fractional-index.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { Comment, ConvertSnapshot, LaneChange, LanesOutcome, LanesProposer } from '../api.ts';
import {
  applyCommentOp,
  type CommentRecord,
  FROM_FILL_RE,
  fromSize,
  isOwnComment,
  type OpActor,
} from '../comments/ops.ts';
import type { UndoTarget } from '../sync/undo-target.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 8 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COMMENT_ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const ARTBOARD_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
/** How long a hub proposal is awaited before the answer says `queued` (the outbox keeps it). */
const ANSWER_WAIT_MS = 8_000;
/** In-memory undo tokens / conversion records, per server (contract §3.2). */
const MAX_REMEMBERED = 200;
/** A turned-back sticky's size when its `from` recorded none (a comment converted before A5). */
const STICKY_SIZE = 200;
const LABEL_TEXT = 40;

export const HAS_REPLIES_LINE = (who: string) => `${who} replied — resolve the thread instead.`;

/** What a home answers for one two-lane proposal (`SyncRuntime.proposeLanes`, the local home). */
export interface LanesRuntime {
  proposeLanes?(
    slug: string,
    lanes: LaneChange[],
    o: { kind: string; label: string; writeId?: string }
  ): Promise<{ status: 'accepted' | 'rejected'; code?: string; actionId?: string }> | null;
  acceptedMode?(): boolean;
}

export interface AnnotationRouteDeps {
  api: {
    fileSlug(file: string): string;
    loadAllComments(): Promise<Record<string, Comment[]>>;
    convertLanes: import('../api.ts').Api['convertLanes'];
    restoreConversion(s: ConvertSnapshot): Promise<{ ok: boolean; reason?: string }>;
  };
  /** `ctx.syncControl.current()` — the hub runtime, the local home, or null. */
  control: () => LanesRuntime | null | undefined;
  /** The acting person: the proxy-vouched member in a cell, `git config user.name` on a desktop. */
  person: (req: Request) => Promise<OpActor>;
  /** S9.9 — the per-request canvas scope; a Response refuses (`not-in-scope`, as missing). */
  scope?: (req: Request, file: string) => Response | null;
  now?: () => Date;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get('content-length')) > MAX_BODY)
    return json(413, { ok: false, reason: 'too-large' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return json(400, { ok: false, reason: 'body must be a JSON object' });
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** `Turned “<first 40 chars>” into a comment` (contract §3.2). */
export function toCommentLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = flat.length > LABEL_TEXT ? `${flat.slice(0, LABEL_TEXT).trimEnd()}…` : flat;
  return `Turned “${cut}” into a comment`;
}
export const TO_STICKY_LABEL = 'Turned a comment back into a sticky';

type Host = { artboard?: string; world?: { x: number; y: number } };

/** Where a sticky's arrow points: its bound `ab:` / `el:` host (§3.3), else nothing. */
function arrowHost(board: AnnotationElement[], stickyId: string): Host | null {
  for (const el of board) {
    if (el.type !== 'arrow') continue;
    const a = el as AnnotationElement & {
      start?: { el?: string };
      end?: { el?: string };
      startHost?: { ref?: string; box?: { x: number; y: number; w: number; h: number } };
      endHost?: { ref?: string; box?: { x: number; y: number; w: number; h: number } };
    };
    const host =
      a.start?.el === stickyId ? a.endHost : a.end?.el === stickyId ? a.startHost : undefined;
    if (!host || typeof host.ref !== 'string') continue;
    const m = /^(?:ab:([^/#]+)|el:([^/#]+)\/)/.exec(host.ref);
    const artboard = m?.[1] ?? m?.[2];
    const box = host.box;
    const world =
      box && [box.x, box.y, box.w, box.h].every(Number.isFinite)
        ? { x: box.x + box.w / 2, y: box.y + box.h / 2 }
        : undefined;
    if (!artboard && !world) continue;
    return {
      ...(artboard && ARTBOARD_RE.test(artboard) ? { artboard } : {}),
      ...(world ? { world } : {}),
    };
  }
  return null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A foreign reply on any of `ids` — the person who wrote it, else null. */
function foreignReplier(list: readonly Comment[], ids: readonly string[], me: OpActor) {
  for (const c of list) {
    if (!ids.includes(c.id)) continue;
    for (const r of c.thread ?? []) if (!isOwnComment(r, me)) return r.author || 'Someone';
  }
  return null;
}

interface Remembered {
  file: string;
  /** the comments this action ADDED (to-comment) — the undo guard's subject */
  added: string[];
}

export function createAnnotationRoutes(deps: AnnotationRouteDeps) {
  const now = deps.now ?? (() => new Date());
  /** actionId → what it added (the undo guard; per server, like the ⌘Z stack). */
  const actions = new Map<string, Remembered>();
  /** undo token → the snapshot (no-home homes only). */
  const tokens = new Map<string, ConvertSnapshot & { added: string[] }>();
  const remember = <V>(m: Map<string, V>, k: string, v: V) => {
    m.set(k, v);
    while (m.size > MAX_REMEMBERED) m.delete(m.keys().next().value as string);
  };

  function proposerFor(file: string, label: string): LanesProposer | null {
    const rt = deps.control();
    if (!rt?.proposeLanes) return null;
    const slug = deps.api.fileSlug(file);
    const accepted = rt.acceptedMode?.() === true;
    // Ask once: a home that answers null (not in that mode, canvas not carried) is no home.
    const probe = rt.proposeLanes.bind(rt);
    return {
      accepted,
      send: (lanes) => {
        const p = probe(slug, lanes, { kind: 'edit', label });
        if (!p) return Promise.resolve({ status: 'rejected', code: 'no-home' } as LanesOutcome);
        if (!accepted) return p;
        return Promise.race([
          p,
          new Promise<LanesOutcome>((resolve) =>
            setTimeout(() => resolve({ status: 'accepted', queued: true }), ANSWER_WAIT_MS)
          ),
        ]);
      },
    };
  }

  /** The answer both conversions give: an action id (⌘Z) or, with no op log, a token. */
  function answerOf(
    r: { actionId?: string; queued?: boolean; snapshot: ConvertSnapshot },
    added: string[],
    extra: Record<string, unknown>
  ) {
    if (r.actionId) remember(actions, r.actionId, { file: r.snapshot.file, added });
    if (r.actionId || r.queued) {
      return json(200, {
        ok: true,
        ...extra,
        ...(r.actionId ? { actionId: r.actionId } : {}),
        ...(r.queued ? { queued: true } : {}),
      });
    }
    const undoToken = `cv_${randomBytes(12).toString('hex')}`;
    remember(tokens, undoToken, { ...r.snapshot, added });
    return json(200, { ok: true, ...extra, undoToken });
  }

  /**
   * The undo guard S5.5's `POST /_api/project/undo` runs before the runtime
   * (§3.2 "All or nothing"): a conversion whose thread someone else has replied
   * to since is refused, so the kernel never restores the sticky while keeping
   * the thread. The undoing person's own replies go with the thread.
   */
  async function undoGuard(target: UndoTarget, req: Request): Promise<Response | null> {
    const ids =
      'actionId' in target ? [target.actionId] : 'actionIds' in target ? target.actionIds : [];
    const hits = ids.map((id) => actions.get(id)).filter((x): x is Remembered => !!x);
    if (!hits.length) return null;
    const me = await deps.person(req);
    const all = await deps.api.loadAllComments();
    for (const h of hits) {
      const list = Object.values(all).flat();
      const who = foreignReplier(list, h.added, me);
      if (who)
        return json(409, {
          ok: false,
          reason: 'has-replies',
          line: HAS_REPLIES_LINE(firstName(who)),
        });
    }
    return null;
  }

  const toComment: RouteSpec = {
    method: 'POST',
    path: '/_api/annotations/to-comment',
    origin: 'main',
    readOnly: 'refused',
    handle: async (req) => {
      const body = await readBody(req);
      if (body instanceof Response) return body;
      const { file, id } = body;
      if (typeof file !== 'string' || !file || file.length > 1024 || file.includes('\0'))
        return json(400, { ok: false, reason: 'file is required' });
      if (typeof id !== 'string' || !ID_RE.test(id))
        return json(400, { ok: false, reason: 'id is required' });
      const refused = deps.scope?.(req, file);
      if (refused) return refused;
      const actor = await deps.person(req);
      const at = now().toISOString();
      let label = toCommentLabel('');
      const r = await deps.api.convertLanes<{ commentId: string }>(
        file,
        ({ board, comments }) => {
          const el = board.find((e) => e.id === id);
          if (!el) return { ok: false, status: 404, body: { ok: false, reason: 'gone' } };
          if (el.type !== 'sticky')
            return { ok: false, status: 409, body: { ok: false, reason: 'not-a-sticky' } };
          const text = typeof el.text === 'string' ? el.text.trim() : '';
          if (!text) return { ok: false, status: 409, body: { ok: false, reason: 'empty' } };
          label = toCommentLabel(text);
          const x = num(el.x) ?? 0;
          const y = num(el.y) ?? 0;
          const w = num(el.w) ?? 0;
          const h = num(el.h) ?? 0;
          const author = (el.author ?? {}) as { name?: unknown; id?: unknown };
          const parentArtboard =
            typeof el.parentArtboard === 'string' && ARTBOARD_RE.test(el.parentArtboard)
              ? el.parentArtboard
              : undefined;
          const host = arrowHost(board, id);
          const added = applyCommentOp(
            comments as CommentRecord[],
            {
              op: 'add',
              file,
              text,
              world: host?.world ?? { x: x + w / 2, y: y + h / 2 },
              ...((host?.artboard ?? parentArtboard)
                ? { artboard: host?.artboard ?? parentArtboard }
                : {}),
            },
            {
              actor,
              now: at,
              newId: () => `c_${randomBytes(6).toString('hex')}`,
              newReplyId: () => `r_${randomBytes(6).toString('hex')}`,
              // TRUSTED: read from the board, never from the body (§3.1).
              from: {
                kind: 'sticky',
                id,
                author: typeof author.name === 'string' ? author.name.slice(0, 120) : '',
                ...(typeof author.id === 'string' ? { authorId: author.id } : {}),
                at,
                spot: { x, y, ...(parentArtboard ? { artboard: parentArtboard } : {}) },
                // its look, so "Turn back" gives the same sticky back (sanitizeFrom bounds both)
                ...(typeof el.fill === 'string' ? { fill: el.fill } : {}),
                ...(w > 0 ? { w } : {}),
                ...(h > 0 ? { h } : {}),
              },
            }
          );
          if (!added.ok || !added.comment)
            return { ok: false, status: 409, body: { ok: false, reason: 'invalid' } };
          return {
            ok: true,
            ops: [{ op: 'delete', id }],
            comments: added.list as Comment[],
            result: { commentId: added.comment.id },
          };
        },
        // The label needs the sticky's text, read inside the change: resolved lazily.
        lazyProposer(() => proposerFor(file, label))
      );
      if (!r.ok) return json(r.status, r.body);
      return answerOf(r, [r.result.commentId], { commentId: r.result.commentId });
    },
  };

  const toSticky: RouteSpec = {
    method: 'POST',
    path: '/_api/comments/to-sticky',
    origin: 'main',
    readOnly: 'refused',
    handle: async (req) => {
      const body = await readBody(req);
      if (body instanceof Response) return body;
      const { commentId } = body;
      if (typeof commentId !== 'string' || !COMMENT_ID_RE.test(commentId))
        return json(400, { ok: false, reason: 'commentId is required' });
      const all = await deps.api.loadAllComments();
      const found = Object.values(all)
        .flat()
        .find((c) => c.id === commentId);
      if (!found?.file) return json(404, { ok: false, reason: 'gone' });
      const file = found.file;
      const refused = deps.scope?.(req, file);
      if (refused) return refused;
      const actor = await deps.person(req);
      const r = await deps.api.convertLanes<{ stickyId: string }>(
        file,
        ({ board, comments }) => {
          const c = comments.find((x) => x.id === commentId) as CommentRecord | undefined;
          if (!c) return { ok: false, status: 404, body: { ok: false, reason: 'gone' } };
          const from = c.from as
            | {
                kind?: unknown;
                id?: unknown;
                author?: unknown;
                authorId?: unknown;
                spot?: unknown;
                fill?: unknown;
                w?: unknown;
                h?: unknown;
              }
            | undefined;
          if (!from || from.kind !== 'sticky')
            return { ok: false, status: 409, body: { ok: false, reason: 'not-converted' } };
          const who = foreignReplier([c], [commentId], actor);
          if (who)
            return {
              ok: false,
              status: 409,
              body: { ok: false, reason: 'has-replies', line: HAS_REPLIES_LINE(firstName(who)) },
            };
          const taken = new Set(board.map((e) => e.id));
          const stickyId =
            typeof from.id === 'string' && ID_RE.test(from.id) && !taken.has(from.id)
              ? from.id
              : `s_${randomBytes(6).toString('hex')}`;
          const spot = (from.spot ?? {}) as { x?: unknown; y?: unknown; artboard?: unknown };
          const world = (c as { world?: { x: number; y: number } }).world;
          // The sticky's own size and paper when the conversion recorded them (sanitizeFrom bounded
          // both on the way in); a pre-A5 `from` carries neither and gets today's default sticky.
          const sw = fromSize(from.w) ?? STICKY_SIZE;
          const sh = fromSize(from.h) ?? STICKY_SIZE;
          const fill =
            typeof from.fill === 'string' && FROM_FILL_RE.test(from.fill) ? from.fill : undefined;
          const x = num(spot.x) ?? (world ? world.x - sw / 2 : 0);
          const y = num(spot.y) ?? (world ? world.y - sh / 2 : 0);
          const top = board
            .filter((e) => e.parent === undefined || e.parent === null)
            .map((e) => e.index)
            .filter((k): k is string => typeof k === 'string')
            .sort()
            .at(-1);
          const authorName = typeof from.author === 'string' ? from.author.slice(0, 64) : '';
          const sticky: AnnotationElement = {
            id: stickyId,
            type: 'sticky',
            index: keyBetween(top ?? null, null),
            x,
            y,
            w: sw,
            h: sh,
            ...(fill ? { fill } : {}),
            text: c.text,
            ...(authorName
              ? {
                  author: {
                    kind: 'human',
                    name: authorName,
                    ...(typeof from.authorId === 'string' && from.authorId.length <= 64
                      ? { id: from.authorId }
                      : {}),
                  },
                }
              : {}),
            ...(typeof spot.artboard === 'string' && ARTBOARD_RE.test(spot.artboard)
              ? { parentArtboard: spot.artboard }
              : {}),
          } as AnnotationElement;
          return {
            ok: true,
            ops: [{ op: 'put', el: sticky }],
            comments: comments.filter((x) => x.id !== commentId),
            result: { stickyId },
          };
        },
        lazyProposer(() => proposerFor(file, TO_STICKY_LABEL))
      );
      if (!r.ok) return json(r.status, r.body);
      return answerOf(r, [], { stickyId: r.result.stickyId });
    },
  };

  const convertUndo: RouteSpec = {
    method: 'POST',
    path: '/_api/annotations/convert-undo',
    origin: 'main',
    readOnly: 'refused',
    handle: async (req) => {
      const body = await readBody(req);
      if (body instanceof Response) return body;
      const token = body.token;
      const s = typeof token === 'string' ? tokens.get(token) : undefined;
      if (!s) return json(409, { ok: false, reason: 'stale' });
      const refused = deps.scope?.(req, s.file);
      if (refused) return refused;
      if (s.added.length) {
        const me = await deps.person(req);
        const all = await deps.api.loadAllComments();
        const who = foreignReplier(Object.values(all).flat(), s.added, me);
        if (who)
          return json(409, {
            ok: false,
            reason: 'has-replies',
            line: HAS_REPLIES_LINE(firstName(who)),
          });
      }
      const r = await deps.api.restoreConversion(s);
      if (!r.ok) return json(409, { ok: false, reason: r.reason ?? 'stale' });
      tokens.delete(token as string);
      return json(200, { ok: true });
    },
  };

  return { specs: [toComment, toSticky, convertUndo], undoGuard };
}

/**
 * A proposer whose label is known only once the change ran (the sticky's text):
 * `accepted` must be known BEFORE the change (it picks how the disk is written),
 * so the home is resolved twice — once for the mode, once to send.
 */
function lazyProposer(make: () => LanesProposer | null): LanesProposer | null {
  const first = make();
  if (!first) return null;
  return { accepted: first.accepted, send: (lanes) => (make() ?? first).send(lanes) };
}
