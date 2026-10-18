// The hub's comment door — `POST /api/comments` (S9.7; V2-1.7 §5.6, decision
// v2-1.7-hub-comment-door; V2-1.16 L10).
//
// WHY A DOOR AT ALL. Hocuspocus read-only is per connection: a Can comment
// (`viewer`) desktop's Y connection is read-only, so a comment it writes into
// the canvas doc's `comments` lane is dropped on the wire. The comment travels
// here instead, and the hub applies the op to that lane SERVER-SIDE — in a Y
// transaction on the live document (legacy save mode), or as a kernel proposal
// on the comments lane (accepted revisions, DDR-241: the kernel is the only
// writer, and the document is its replica).
//
// THE RULES THIS DOOR KEEPS:
//   - the author is the verified session (`match.owner || match.label`), never
//     a body field. What is stamped is a NAME (no address reaches the lane —
//     L17) plus an opaque per-hub id the ownership check compares;
//   - `comment` on the canvas (the row's capability; the gate refuses Can view
//     with its own copy). Ops on someone else's comment other than reply /
//     resolve / reopen → 403 `not-yours` (`apps/studio/comments/ops.ts`);
//   - U1: for a canvas-only session a document it cannot open answers exactly
//     as one that does not exist — the same 403 `not-in-scope`, the same body;
//   - mentions are parsed HERE from the op (never a client-stated list) and
//     `maude.mention` reaches only the mentioned person's own live connections,
//     and only people who can open this canvas — an unknown handle and one
//     without access are the same silence. AI-written comments never mention
//     (C3). A person with no live connection goes to `onUnreached` (S9.18
//     forwards it to the control plane for e-mail; a self-hosted hub drops it);
//   - V2-1.12 §5.4: comments are a format-gated write door — 426 for a writer
//     whose declared format is not the project's (v2 handlers run before the
//     server's own format gate, so this door asks itself).

import { createHmac, randomBytes } from 'node:crypto';

import { resolveAccess, seesDoc } from '../../../studio/access/scope.ts';
import { resolveMentions } from '../../../studio/comments/mentions.ts';
import { applyCommentOp, parseCommentOp } from '../../../studio/comments/ops.ts';
import {
  actorName,
  docSlugOf,
  grantedCanvasOfDoc,
  NOT_IN_SCOPE_REFUSAL,
  peerAccess,
} from '../access-docs.mjs';
import { OBSERVER_REFUSAL, presentedBearer, READ_ONLY_REFUSAL } from '../access-gate.mjs';
import { readLane } from '../project-transactions/lanes.mjs';

export const COMMENTS_PATH = '/api/comments';
/** The stateless message a mentioned person's connections receive. */
export const MENTION_MESSAGE = 'maude.mention';

/** An op is small; a 4000-char text plus anchors and a `from` fits many times over. */
const MAX_BODY_BYTES = 64 * 1024;
/** `apps/studio/sync/limits.ts MAX_COMMENTS_BYTES` — one canvas's whole thread list. */
const MAX_COMMENTS_BYTES = 1024 * 1024;
const DOC_NAME_RE = /^[A-Za-z0-9._/-]{1,256}$/;

const NOT_FOUND = Object.freeze({ error: 'No such canvas.', code: 'not-found' });

/** The slug part of a documentName (`ws/<w>/<b>/<slug>`, or a legacy flat name). */
function slugOfDoc(doc) {
  const parts = String(doc).split('/');
  return parts.length === 4 && parts[0] === 'ws' ? parts[3] : doc;
}

/** An opaque, per-hub, stable id for a person — never their address. */
export function authorIdOf(personKey, person) {
  const mac = createHmac('sha256', String(personKey || 'maude-comments'));
  return `h:${mac.update(String(person).toLowerCase()).digest('hex').slice(0, 24)}`;
}

async function readJsonBody(request, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) return { tooLarge: true };
    chunks.push(chunk);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : {};
  } catch {
    return {};
  }
}

/**
 * Which canvas file a comment record names. A canvas-only session gets the
 * granted canvas's own path; a project session may name it, but only a file
 * whose slug IS this document's — a comment in A's lane can never claim B.
 */
function fileFor({ op, canvas, doc, designRel }) {
  const prefix = `${String(designRel || '.design').replace(/^\/+|\/+$/g, '')}/`;
  if (typeof op.file === 'string' && op.file) {
    const rel = op.file.startsWith(prefix) ? op.file.slice(prefix.length) : op.file;
    if (docSlugOf(rel) !== slugOfDoc(doc)) return null;
    if (canvas && rel !== canvas) return null;
    return `${prefix}${rel}`;
  }
  return canvas ? `${prefix}${canvas}` : null;
}

/** Write one op's effect into a Y.Array of plain records — only the records it changed. */
function writeDelta(arr, before, op, result) {
  if (op.op === 'add') {
    arr.push([result.comment]);
    return;
  }
  const at = [];
  before.forEach((c, i) => {
    if (c && c.id === op.id) at.push(i);
  });
  for (const i of [...at].reverse()) arr.delete(i, 1);
  if (op.op === 'delete-own' || at.length === 0) return;
  arr.insert(
    Math.min(...at),
    result.list.filter((c) => c.id === op.id)
  );
}

/**
 * Apply `op` to `doc`'s comments lane as `actor`. Returns the ops.ts result,
 * or `{ ok:false, status, code, error }` for a door-level refusal.
 */
async function applyToDoc(d, { doc, op, actor, by }) {
  const opCtx = {
    actor,
    now: new Date(d.now?.() ?? Date.now()).toISOString(),
    newId: () => `c_${randomBytes(6).toString('hex')}`,
    newReplyId: () => `r_${randomBytes(6).toString('hex')}`,
  };
  const context = { comments: true, user: { name: actor.name } };
  const accepted = d.accepted?.() ?? null;
  let result = null;
  let tooLarge = false;
  if (accepted?.acceptedMode?.()) {
    // DDR-241: the kernel is the only writer. Read the replica, apply, propose.
    let base = '';
    await d.withDoc(doc, context, (ydoc) => {
      base = readLane(ydoc, 'comments');
    });
    const list = base === '' ? [] : JSON.parse(base);
    result = applyCommentOp(Array.isArray(list) ? list : [], op, opCtx);
    if (!result.ok) return result;
    const content = result.list.length ? JSON.stringify(result.list) : '';
    if (content.length > MAX_COMMENTS_BYTES) tooLarge = true;
    else {
      const bytes = JSON.stringify({
        protocol: 1,
        projectId: d.projectId,
        epoch: accepted.state?.epoch ?? 0,
        transactionId: `tx_cm_${randomBytes(12).toString('hex')}`,
        action: {
          kind: 'comment',
          label: 'Comment',
          operations: [{ op: 'lane.replace', doc, lane: 'comments', baseContent: base, content }],
        },
      });
      // The door has judged `comment` on this canvas and built the op itself:
      // it touches the comments lane of this one document and nothing else.
      const r = await accepted.kernel.submit(bytes, { actor: by, readOnly: false });
      if (r.body?.status !== 'accepted') {
        return {
          ok: false,
          status: r.status === 503 ? 503 : 409,
          code: r.body?.code ?? 'retryable',
          error: 'The comment was not saved. Try again.',
        };
      }
    }
  } else {
    await d.withDoc(doc, context, (ydoc) => {
      const arr = ydoc.getArray('comments');
      const before = arr.toArray();
      result = applyCommentOp(before, op, opCtx);
      if (!result.ok) return;
      if (JSON.stringify(result.list).length > MAX_COMMENTS_BYTES) {
        tooLarge = true;
        return;
      }
      writeDelta(arr, before, op, result);
    });
  }
  if (tooLarge) {
    return {
      ok: false,
      status: 413,
      code: 'capacity',
      error: 'This canvas has too many comments to add another.',
    };
  }
  return result;
}

/**
 * May this credential (a claim + a machine scope) open `doc`? The doc door's
 * read half — the one test both "who may be mentioned" and "which socket may
 * hear it" use. A context with no claim is the permissive dev hub (project-wide).
 */
function credentialSees(d, { access, scope }, doc) {
  if (d.matchesScope && !d.matchesScope(scope ?? '*', doc)) return false;
  return access ? seesDoc(resolveAccess(access), doc, docSlugOf) : true;
}

/** A live connection's person: their address when the token has one, else its label. */
const personOfUser = (user) => (user && typeof user === 'object' ? user.email || user.name : null);

/**
 * The people who can open `doc` — the only ones a mention may reach: everyone
 * connected whose own credential sees it, plus `d.people()` (people the hub
 * knows while they are away — S9.18 supplies them for the e-mail path).
 */
function peopleWithAccess(d, doc) {
  const out = new Map();
  const add = (id, name) => {
    if (typeof id === 'string' && id && !out.has(id))
      out.set(id, { id, name: name || actorName(id) });
  };
  for (const connection of d.connections?.() ?? []) {
    const user = connection?.context?.user;
    if (user && typeof user === 'object' && credentialSees(d, user, doc))
      add(personOfUser(user), user.displayName);
  }
  for (const p of d.people?.() ?? []) {
    if (p && credentialSees(d, p, doc)) add(p.id, p.name);
  }
  return [...out.values()];
}

/** Send `maude.mention` to each mentioned person's live connections that see `doc`. */
function deliverMentions(d, { doc, canvas, thread, from, people }) {
  const want = new Set(people.map((p) => p.id));
  const reached = new Set();
  const sockets = new Set();
  const payload = JSON.stringify({ type: MENTION_MESSAGE, thread, canvas, doc, from });
  for (const connection of d.connections?.() ?? []) {
    const user = connection?.context?.user;
    const who = personOfUser(user);
    if (!who || !want.has(who) || !credentialSees(d, user, doc)) continue;
    const key = connection.socketId ?? connection;
    if (sockets.has(key)) continue;
    sockets.add(key);
    try {
      connection.sendStateless(payload);
      reached.add(who);
    } catch {
      /* a gone socket must not keep the message from the rest */
    }
  }
  for (const p of people) {
    if (!reached.has(p.id)) d.onUnreached?.({ person: p.id, thread, canvas, doc, from });
  }
  return reached.size;
}

/**
 * `POST /api/comments` — the handler `runHubRoutes` calls after the access gate
 * (capability `comment`, `canvasDoor`: this handler judges the canvas itself).
 */
export async function handleCommentsRoute(ctx) {
  const { request, method, respondJson } = ctx;
  if (method !== 'POST') {
    respondJson(405, { error: 'method not allowed' });
    return true;
  }
  const d = ctx.deps?.comments;
  if (!d) {
    respondJson(503, { error: 'Comments are not available on this hub yet.', code: 'retryable' });
    return true;
  }
  const token = presentedBearer(request);
  let match = null;
  try {
    match = token ? ctx.verify(token) : null;
  } catch {
    match = null;
  }
  if (!match) {
    respondJson(401, { error: 'a project token is required to comment' });
    return true;
  }
  const { access } = peerAccess(match);
  const fmt = await d.formatRefusal?.(request);
  if (fmt) {
    respondJson(426, fmt);
    return true;
  }
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (read.tooLarge) {
    respondJson(413, { error: 'comment too large', code: 'capacity' });
    return true;
  }
  const body = read.value ?? {};
  const doc = typeof body.doc === 'string' && DOC_NAME_RE.test(body.doc) ? body.doc : null;

  // ---- scope first: an invisible document answers exactly as a missing one (U1).
  let canvas = null;
  if (access.role === null) {
    const granted = doc && access.canvasOnly ? grantedCanvasOfDoc(access, doc) : null;
    const visible =
      granted !== null &&
      (body.canvas === undefined || body.canvas === granted) &&
      (!d.matchesScope || d.matchesScope(match.scope ?? '*', doc)) &&
      seesDoc(access, doc, docSlugOf) &&
      (await d.docExists(doc));
    if (!visible) {
      respondJson(403, { ...NOT_IN_SCOPE_REFUSAL });
      return true;
    }
    canvas = granted;
  } else {
    if (!doc) {
      respondJson(400, { error: 'body.doc (the canvas document) is required', code: 'invalid' });
      return true;
    }
    const visible =
      (!d.matchesScope || d.matchesScope(match.scope ?? '*', doc)) &&
      seesDoc(access, doc, docSlugOf) &&
      (await d.docExists(doc));
    if (!visible) {
      respondJson(404, { ...NOT_FOUND });
      return true;
    }
    canvas =
      typeof body.canvas === 'string' && docSlugOf(body.canvas) === slugOfDoc(doc)
        ? body.canvas
        : null;
  }
  if (!access.can('comment', canvas)) {
    respondJson(403, access.roleFor(canvas) === 'observer' ? OBSERVER_REFUSAL : READ_ONLY_REFUSAL);
    return true;
  }

  // An add's `file` is the server's: this document's canvas, never another's.
  let file = null;
  if (body.op === 'add') {
    file = fileFor({ op: body, canvas, doc, designRel: d.designRel });
    if (!file) {
      respondJson(400, { error: 'body.file is not this canvas', code: 'invalid' });
      return true;
    }
  }
  const op = parseCommentOp(file ? { ...body, file } : body);
  if (!op) {
    respondJson(400, { error: 'not a comment op', code: 'invalid' });
    return true;
  }

  const by = match.owner || match.label;
  const name = (d.nameOf?.(by) ?? '') || actorName(by);
  const actor = {
    name: String(name).slice(0, 120),
    id: authorIdOf(d.personKey, by),
    ...(body.as === 'ai' ? { kind: 'ai' } : {}),
  };
  const result = await applyToDoc(d, { doc, op, actor, by });
  if (!result.ok) {
    respondJson(result.status, { error: result.error, code: result.code });
    return true;
  }
  const thread = result.comment?.id ?? op.id;
  if (actor.kind !== 'ai' && result.mentioned.length) {
    const people = resolveMentions(result.mentioned, peopleWithAccess(d, doc), { exclude: by });
    if (people.length) deliverMentions(d, { doc, canvas, thread, from: actor.name, people });
  }
  // The same answer whoever the text mentioned: who was reached is not the
  // writer's to learn (an unknown handle and a no-access one look alike).
  respondJson(200, { id: thread, comment: result.comment });
  return true;
}

/** The area's rows for the one table (`routes-v2/index.mjs`). */
export const COMMENT_ROWS = Object.freeze([
  Object.freeze({
    path: COMMENTS_PATH,
    cap: Object.freeze({ safe: 'read', unsafe: 'comment' }),
    scope: 'canvas',
    canvasDoor: true,
    handler: handleCommentsRoute,
  }),
]);
