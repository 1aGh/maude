// Comment ops — the one place a comment thread changes (S9.7, V2-1.7 §5.6 `POST /api/comments`).
//
// Pure: a list in, a list out. The studio (`api.ts`, through its lead patch) and the hub's comment
// door (`apps/hub/src/routes-v2/comments.mjs`) both apply ops here, so "what reply means" has one
// home and the two doors cannot drift.
//
// The AUTHOR is never the body's. `ctx.actor` is the verified session (the hub's token, the
// studio's vouched cell member or git identity); an `author` / `authorId` / `authorKind` in the op
// is ignored. What a session may do to a thread it did not start: reply, resolve, reopen. Editing or
// deleting someone else's comment is `not-yours` (403) — the door applies that, it is not hidden.
//
// Erasable TypeScript only (the hub imports it under Node).

import type { Comment, Reply } from '../api.ts';
import { readAnchors } from './anchors.ts';
import { addedMentions, mentionsOf } from './mentions.ts';

/** Same bound as a top-level comment and a reply today (`api.ts`). */
export const MAX_TEXT = 4000;
const FROM_KIND_RE = /^[a-z][a-z-]{0,31}$/;
const FROM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const ID_RE = /^[A-Za-z0-9_]{1,64}$/;

export const OP_NAMES = Object.freeze([
  'add',
  'reply',
  'resolve',
  'reopen',
  'edit-own',
  'delete-own',
] as const);
export type OpName = (typeof OP_NAMES)[number];

/** Who is acting — from the session, never from the body. */
export interface OpActor {
  /** the display name stamped as `author` */
  name: string;
  /** an opaque stable id (the hub's); absent on a desktop, where the name is the identity */
  id?: string;
  /** `ai` for `comments add --as-ai` / an AI reply; absent = a person */
  kind?: 'ai';
}

export interface OpContext {
  actor: OpActor;
  /** ISO time */
  now: string;
  newId(): string;
  newReplyId(): string;
  /**
   * S4-S9-votes-comments §3.1 — the sticky a conversion turns into this comment. TRUSTED: set
   * only by the conversion route (S4.7), which reads the sticky from the board. A `from` in an
   * op body is never read — the hub cannot check a sticky existed, so it would sign as anyone.
   */
  from?: unknown;
}

/** The `from` of a converted comment (S4-S9-votes-comments §3.1). */
export interface CommentFrom {
  kind: string;
  id: string;
  author: string;
  authorId?: string;
  convertedBy: string;
  at: string;
  spot?: { x: number; y: number; artboard?: string };
}

export interface AddPayload {
  file: string;
  text: string;
  selector?: string;
  index?: number;
  dom_path?: string[];
  tag?: string;
  classes?: string;
  bounds?: { x: number; y: number; w: number; h: number } | null;
  html_excerpt?: string;
  [anchor: string]: unknown;
}

export type CommentOp =
  | ({ op: 'add' } & AddPayload)
  | { op: 'reply'; id: string; body: string }
  | { op: 'resolve' | 'reopen' | 'delete-own'; id: string }
  | { op: 'edit-own'; id: string; text: string };

/** A stored record as these ops see it: today's Comment plus the Maude 2 authorship keys. */
export type CommentRecord = Comment & {
  authorId?: string;
  authorKind?: 'ai';
  [key: string]: unknown;
};

export type OpResult =
  | {
      ok: true;
      list: CommentRecord[];
      /** the thread the op touched (after it), null for a delete */
      comment: CommentRecord | null;
      /** tokens this op newly added — what the door may deliver (never for AI text) */
      mentioned: string[];
    }
  | {
      ok: false;
      status: 400 | 403 | 404;
      code: 'invalid' | 'not-yours' | 'not-found';
      error: string;
    };

const NOT_FOUND: OpResult = Object.freeze({
  ok: false,
  status: 404,
  code: 'not-found',
  error: 'No such comment.',
}) as OpResult;
const NOT_YOURS: OpResult = Object.freeze({
  ok: false,
  status: 403,
  code: 'not-yours',
  error: 'Only the person who wrote a comment can change or delete it.',
}) as OpResult;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : null;

function bounds(v: unknown): Comment['bounds'] {
  if (!isObject(v)) return null;
  const { x, y, w, h } = v;
  const nums = [x, y, w, h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

/** A trusted `from`, bounded; `convertedBy` is always the acting session (= `author`). */
export function sanitizeFrom(v: unknown, actor: OpActor, now: string): CommentFrom | undefined {
  if (!isObject(v)) return undefined;
  const { kind, id, author, authorId, at, spot } = v;
  if (typeof kind !== 'string' || !FROM_KIND_RE.test(kind)) return undefined;
  if (typeof id !== 'string' || !FROM_ID_RE.test(id)) return undefined;
  if (typeof author !== 'string' || author.length > 120) return undefined;
  const out: CommentFrom = { kind, id, author, convertedBy: actor.name, at: now };
  if (typeof authorId === 'string' && /^[A-Za-z0-9_:-]{1,80}$/.test(authorId))
    out.authorId = authorId;
  if (typeof at === 'string' && at.length <= 40) out.at = at;
  if (isObject(spot) && Number.isFinite(spot.x) && Number.isFinite(spot.y)) {
    out.spot = { x: spot.x as number, y: spot.y as number };
    if (
      typeof spot.artboard === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(spot.artboard)
    )
      out.spot.artboard = spot.artboard;
  }
  return out;
}

/** Validate an op body. `null` = not an op (400 `invalid`). Unknown fields are ignored. */
export function parseCommentOp(raw: unknown): CommentOp | null {
  if (!isObject(raw) || typeof raw.op !== 'string') return null;
  const op = raw.op as OpName;
  if (!(OP_NAMES as readonly string[]).includes(op)) return null;
  if (op === 'add') {
    const body = text(raw.text);
    if (typeof raw.file !== 'string' || !raw.file || raw.file.length > 1024 || !body) return null;
    return { ...raw, op, file: raw.file, text: body } as CommentOp;
  }
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  if (op === 'reply') {
    const body = text(raw.body);
    return body ? { op, id: raw.id, body } : null;
  }
  if (op === 'edit-own') {
    const body = text(raw.text);
    return body ? { op, id: raw.id, text: body } : null;
  }
  return { op, id: raw.id };
}

/** Did `actor` write `c`? The stamped id decides when both have one; a desktop record has a name. */
export function isOwnComment(c: { author?: unknown; authorId?: unknown }, actor: OpActor): boolean {
  if (typeof c.authorId === 'string' && c.authorId) return !!actor.id && c.authorId === actor.id;
  return typeof c.author === 'string' && c.author !== '' && c.author === actor.name;
}

const authorship = (actor: OpActor): Pick<CommentRecord, 'authorId' | 'authorKind'> => ({
  ...(actor.id ? { authorId: actor.id } : {}),
  ...(actor.kind === 'ai' ? { authorKind: 'ai' as const } : {}),
});

/** A new record from an add op: the shape `api.ts commentsAdd` writes, plus the Maude 2 keys. */
function recordFrom(p: AddPayload, ctx: OpContext): CommentRecord {
  const c: CommentRecord = {
    id: ctx.newId(),
    file: p.file,
    selector: typeof p.selector === 'string' ? p.selector.slice(0, 2000) : '',
    // No `index: undefined` key: the record must equal its own JSON round trip.
    ...(typeof p.index === 'number' && Number.isInteger(p.index) && p.index >= 0
      ? { index: p.index }
      : {}),
    dom_path: Array.isArray(p.dom_path)
      ? p.dom_path.filter((s) => typeof s === 'string').slice(0, 16)
      : [],
    tag: typeof p.tag === 'string' ? p.tag.slice(0, 64) : '',
    classes: typeof p.classes === 'string' ? p.classes.slice(0, 2000) : '',
    bounds: bounds(p.bounds),
    html_excerpt: typeof p.html_excerpt === 'string' ? p.html_excerpt.slice(0, 2000) : '',
    text: p.text,
    status: 'open',
    created: ctx.now,
    resolved_at: null,
    author: ctx.actor.name,
    ...authorship(ctx.actor),
    thread: [],
    mentions: [],
    ...readAnchors(p),
  };
  const from = sanitizeFrom(ctx.from, ctx.actor, ctx.now);
  if (from) c.from = from;
  c.mentions = mentionsOf(c);
  return c;
}

/**
 * Apply one op. Ops are id-TOTAL, like `api.ts commentsPatch` (issue #112): a list still holding
 * a duplicated id from an older peer has every copy changed, so resolve resolves.
 */
export function applyCommentOp(
  list: readonly CommentRecord[],
  op: CommentOp,
  ctx: OpContext
): OpResult {
  const next = list.map((c) => ({ ...c }));
  if (op.op === 'add') {
    const c = recordFrom(op, ctx);
    next.push(c);
    return { ok: true, list: next, comment: c, mentioned: c.mentions.slice() };
  }
  const hits = next.filter((c) => c.id === op.id);
  const first = hits[0];
  if (!first) return NOT_FOUND;
  if ((op.op === 'edit-own' || op.op === 'delete-own') && !isOwnComment(first, ctx.actor))
    return NOT_YOURS;
  if (op.op === 'delete-own') {
    return { ok: true, list: next.filter((c) => c.id !== op.id), comment: null, mentioned: [] };
  }
  const before = first.mentions ?? [];
  for (const c of hits) {
    if (op.op === 'reply') {
      const reply: Reply & { authorId?: string; authorKind?: 'ai' } = {
        id: ctx.newReplyId(),
        author: ctx.actor.name,
        ...authorship(ctx.actor),
        body: op.body,
        created: ctx.now,
      };
      c.thread = [...(Array.isArray(c.thread) ? c.thread : []), reply];
    } else if (op.op === 'resolve' || op.op === 'reopen') {
      c.status = op.op === 'resolve' ? 'resolved' : 'open';
      c.resolved_at = op.op === 'resolve' ? ctx.now : null;
    } else if (op.op === 'edit-own') {
      c.text = op.text;
    }
    c.mentions = mentionsOf(c);
  }
  const mentioned =
    ctx.actor.kind === 'ai' || op.op === 'resolve' || op.op === 'reopen'
      ? []
      : addedMentions(before, first.mentions);
  return { ok: true, list: next, comment: first, mentioned };
}
