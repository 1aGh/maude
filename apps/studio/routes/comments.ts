// The studio's comment door — `POST /_api/comments/op` (S9.7b; V2-1.11 §5.3 `comments` verb,
// S4-S9-votes-comments §3.1, S9-slices row S9.7).
//
// One op per call: `{ op: 'add' | 'reply' | 'resolve' | 'reopen' | 'edit-own' | 'delete-own', … }`,
// judged by comments/ops.ts — the same module the hub's `POST /api/comments` applies, so the two
// doors cannot drift on what an op means.
//
//   - The author is the SESSION (`deps.actor`: a cell's vouched member, a desktop's git identity).
//     `author` / `authorId` / `authorKind` / `from` in a body are never read. `as: 'ai'` marks the
//     text AI-written (`comments add --as-ai`): it can only take powers away (AI text mentions
//     nobody, C3), so the body may ask for it — like the hub door.
//   - `comment` capability (access/request.ts COMMENT_TABLE_WRITES): Can comment may, Can view
//     (observer) may not.
//   - MAIN ORIGIN ONLY, behind the table's CSRF + loopback-Host guard (`guardTableRoute`) — a
//     privileged write, in neither canvas allowlist.
//   - A canvas-only session acts on its granted canvases only. A reply / resolve / reopen names a
//     comment id and nothing else, so `target` resolves the thread's canvas ON THE SERVER and the
//     local gate judges on that (`RouteSpec.target`): a thread on B, an unknown id and a body that
//     names A beside B's id all answer the same 403 `not-in-scope` (U1 — B looks missing).

import { toDesignRel } from '../access/request.ts';
import type { OpActor } from '../comments/ops.ts';
import { type CommentOp, parseCommentOp } from '../comments/ops.ts';
import type { RouteSpec } from './table.ts';

export const COMMENT_OP_PATH = '/_api/comments/op';
/** A comment is ≤ 4000 chars plus an anchor and an excerpt; anything bigger is not an op. */
const MAX_BODY = 64 * 1024;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface CommentRouteDeps {
  /** the design root relative to the repo root (`.design`) */
  designRel: string;
  /** who is acting — from the request's session, never its body */
  actor(req: Request): Promise<OpActor>;
  /** the repo-relative canvas file a thread lives in, or null */
  fileOf(id: string): Promise<string | null>;
  /** apply one op to `file`'s threads (api.ts `commentOp`) */
  apply: (
    file: string,
    op: CommentOp,
    actor: OpActor
  ) => Promise<
    | { ok: true; comment: { id: string } | null }
    | { ok: false; status: number; code: string; error: string }
  >;
}

async function readBody(req: Request): Promise<Record<string, unknown> | 'too-large' | null> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) return 'too-large';
  const text = await req.text();
  if (text.length > MAX_BODY) return 'too-large';
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The canvas file an op acts on, repo-relative (`.design/ui/a.tsx`): an add's own `file`, else the
 * thread's. `null` = not a canvas under the design root, or no such thread; `undefined` = no op.
 */
async function fileOfOp(op: CommentOp, deps: CommentRouteDeps): Promise<string | null> {
  if (op.op === 'add') {
    const rel = toDesignRel(op.file, deps.designRel);
    return rel === null ? null : `${deps.designRel.replace(/^\/+|\/+$/g, '')}/${rel}`;
  }
  return deps.fileOf(op.id);
}

export function createCommentRoutes(deps: CommentRouteDeps): RouteSpec[] {
  return [
    {
      method: 'POST',
      path: '/_api/comments/op', // = COMMENT_OP_PATH (the route scrapers read the literal)
      origin: 'main',
      // A session without `edit` may call it; WHICH capability it needs (`comment`) is
      // access/request.ts COMMENT_TABLE_WRITES — never the table's default `session`.
      readOnly: 'allowed',
      // The local gate's target (access/request.ts gateTarget): the thread's canvas, designRoot-
      // relative. A body that is not an op names nothing; the handler answers it with 400.
      target: async (req) => {
        const body = await readBody(req.clone());
        const op = body && body !== 'too-large' ? parseCommentOp(body) : null;
        if (!op) return undefined;
        const file = await fileOfOp(op, deps);
        return file === null ? null : toDesignRel(file, deps.designRel);
      },
      handle: async (req) => {
        const body = await readBody(req);
        if (body === 'too-large')
          return json(413, { error: 'comment too large', code: 'capacity' });
        const op = body ? parseCommentOp(body) : null;
        if (!body || !op) return json(400, { error: 'not a comment op', code: 'invalid' });
        const file = await fileOfOp(op, deps);
        if (file === null) {
          return op.op === 'add'
            ? json(400, { error: 'body.file is not a canvas in this project', code: 'invalid' })
            : json(404, { error: 'No such comment.', code: 'not-found' });
        }
        const session = await deps.actor(req);
        const actor: OpActor = { ...session, ...(body.as === 'ai' ? { kind: 'ai' as const } : {}) };
        const result = await deps.apply(file, op.op === 'add' ? { ...op, file } : op, actor);
        if (!result.ok) return json(result.status, { error: result.error, code: result.code });
        // The hub door's answer shape. No "who was mentioned": the studio delivers no mention
        // (the hub does, to people who can open the canvas — S9.7).
        return json(200, {
          id: result.comment?.id ?? ('id' in op ? op.id : null),
          comment: result.comment,
        });
      },
    },
  ];
}
