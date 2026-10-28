// A comment from a session that may not edit the canvas goes to the hub's comment door,
// `POST /api/comments` (decision v2-1.7-hub-comment-door; V2-1.7 §5.6; hub side
// apps/hub/src/routes-v2/comments.mjs).
//
// WHY. A Can comment person (`viewer`, or a canvas grant without edit) holds a read-only
// Y connection, and the project's proposal door refuses their every proposal
// (`this account can view but not edit`). So the comment they wrote landed in their own
// file and stopped there: `[sync/tx] Edit comments: refused (403); kept aside`. Nobody
// else ever saw it (P8 G1a, md-comment-post). The door is the one hub write a commenter
// holds: it judges `comment` on the canvas, stamps the author from the verified session
// and applies the OP itself — as a kernel proposal in accepted mode, a Y transaction
// otherwise. The replica then brings the saved record back to this machine.
//
// What this keeps:
//   - only the op travels, never a list: the hub applies it to ITS lane, so a commenter
//     cannot rewrite someone else's thread (ops.ts `not-yours` runs on the hub);
//   - an editor keeps its own path (the room or a lane proposal) — `null` here;
//   - the canvas the hub is told is this document's own (designRoot-relative), and the
//     author is never sent: the hub ignores one, and so do we.
import type { CommentOp, CommentRecord, OpActor } from '../comments/ops.ts';

export type CommentDoorResult =
  | { ok: true; comment: CommentRecord | null }
  | { ok: false; status: number; code: string; error: string };

export interface CommentDoorOptions {
  hubUrl: string;
  token: () => string | null;
  /** the wire document of a canvas slug (`ws/<w>/<b>/<slug>` or a flat name) */
  docNameFor: (slug: string) => string;
  /** may this session edit `canvas` (designRoot-relative)? An editor keeps its own path. */
  canEdit: (canvas: string) => boolean;
  /** does this runtime carry the canvas? (a canvas it does not sync is not the hub's) */
  carries: (slug: string) => boolean;
  fetchImpl?: typeof fetch;
}

const NOT_SAVED = 'The comment was not saved. Check your connection and try again.';

export function createCommentDoor(o: CommentDoorOptions) {
  const base = o.hubUrl.replace(/\/+$/, '');
  return function commentDoor(
    slug: string,
    canvas: string,
    op: CommentOp,
    actor: OpActor
  ): Promise<CommentDoorResult> | null {
    if (!o.carries(slug) || o.canEdit(canvas)) return null;
    return (async (): Promise<CommentDoorResult> => {
      const token = o.token();
      const body = {
        ...op,
        // an add names its canvas designRoot-relative: the hub prefixes ITS design root
        // (`fileFor`), so a checkout whose root is named differently still lands on this doc
        ...(op.op === 'add' ? { file: canvas } : {}),
        doc: o.docNameFor(slug),
        canvas,
        ...(actor.kind === 'ai' ? { as: 'ai' } : {}),
      };
      for (const k of ['author', 'authorId', 'authorKind', 'from'])
        delete (body as Record<string, unknown>)[k];
      try {
        const res = await (o.fetchImpl ?? fetch)(`${base}/api/comments`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-maude-access': '2',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
        });
        const json = (await res.json().catch(() => null)) as {
          comment?: CommentRecord | null;
          code?: string;
          error?: string;
        } | null;
        if (res.status === 200) return { ok: true, comment: json?.comment ?? null };
        const code =
          typeof json?.code === 'string' && /^[a-z0-9-]{1,40}$/.test(json.code)
            ? json.code
            : 'retryable';
        return {
          ok: false,
          status: res.status >= 400 && res.status < 600 ? res.status : 502,
          code,
          // V2-8.9 round B Info — an AI caller hears only the hub's CODE, never its free text (that
          // would be hub-chosen words in the agent's context); a person still reads the hub's sentence.
          error:
            actor.kind === 'ai'
              ? `The comment was not saved (${code}).`
              : typeof json?.error === 'string'
                ? json.error.slice(0, 300)
                : NOT_SAVED,
        };
      } catch {
        return { ok: false, status: 503, code: 'retryable', error: NOT_SAVED };
      }
    })();
  };
}

export type CommentDoor = ReturnType<typeof createCommentDoor>;
