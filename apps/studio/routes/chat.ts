// Chat-store routes — S5.7. The server half of the chat list's search, Move to trash,
// Restore, Clear out and Open in terminal (the resume session id).
//
// The LIST itself stays on the legacy key `GET /_api/acp/chats` (http.ts) — it grows the
// `?group=canvas` and `?trashed=1` query there, so every existing consumer keeps its shape.
//
// MAIN ORIGIN ONLY, and every write is refused in a read-only session: chats are per Mac
// (`_chat/`, DDR-115), the untrusted canvas iframe has no business reading their words, and a
// viewer's Mac is not where a trash decision gets made. The CSRF + loopback guard is
// `guardTableRoute`'s (http.ts), applied to every table spec.
//
// No spawn surface lives here (decision v2-S5-open-in-terminal-native): "Open in terminal" is a
// Tauri command; this file only tells the shell WHICH session to resume.

import { searchChats } from '../acp/chat-search.ts';
import { clearTrashedChats, readChatSessionId, restoreChat, trashChat } from '../acp/transcript.ts';
import type { OutboxStore } from '../outbox/store.ts';
import { FINAL_STATES } from '../outbox/types.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 8 * 1024;
const MAX_QUERY = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface ChatRouteDeps {
  designRoot: string;
  /** The outbox: a trashed chat's queued prompt is withdrawn (G22). */
  outbox?: Pick<OutboxStore, 'list' | 'cancel'>;
  /** Chat ids with a turn in flight — a running chat is not trashed. */
  isRunning?: (chatId: string) => boolean;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createChatRoutes(deps: ChatRouteDeps): RouteSpec[] {
  /** G22: withdraw every waiting `ai.prompt` of this chat. Returns how many. */
  const dropQueuedPrompts = (chatId: string): number => {
    if (!deps.outbox) return 0;
    let n = 0;
    for (const r of deps.outbox.list()) {
      if (r.kind !== 'ai.prompt') continue;
      const owner = r.payload.kind === 'ai.prompt' ? r.payload.chatId : r.target.chatId;
      if (owner !== chatId || FINAL_STATES.includes(r.state)) continue;
      if (deps.outbox.cancel(r.id).ok) n++;
    }
    return n;
  };

  return [
    {
      method: 'GET',
      path: '/_api/acp/chats/search',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, MAX_QUERY);
        return json(200, { q, hits: searchChats(deps.designRoot, q) });
      },
    },
    {
      method: 'GET',
      path: '/_api/acp/chat/session',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const id = new URL(req.url).searchParams.get('id') ?? '';
        if (!ID_RE.test(id)) return json(400, { error: 'bad-id' });
        return json(200, { sessionId: readChatSessionId(deps.designRoot, id) });
      },
    },
    {
      method: 'POST',
      path: '/_api/acp/chats/trash',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const body = await readBody(req);
        const id = body?.id;
        if (typeof id !== 'string' || !ID_RE.test(id)) return json(400, { error: 'bad-id' });
        if (deps.isRunning?.(id)) return json(409, { error: 'running' });
        const meta = trashChat(deps.designRoot, id);
        if (!meta) return json(404, { error: 'not-found' });
        return json(200, {
          ok: true,
          trashedAt: meta.trashedAt,
          droppedPrompts: dropQueuedPrompts(id),
        });
      },
    },
    {
      method: 'POST',
      path: '/_api/acp/chats/restore',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const body = await readBody(req);
        const id = body?.id;
        if (typeof id !== 'string' || !ID_RE.test(id)) return json(400, { error: 'bad-id' });
        if (!restoreChat(deps.designRoot, id)) return json(404, { error: 'not-in-trash' });
        return json(200, { ok: true });
      },
    },
    {
      method: 'POST',
      path: '/_api/acp/chats/clear',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const body = await readBody(req);
        if (!body) return json(400, { error: 'bad-body' });
        let ids: string[] | undefined;
        if (body.ids !== undefined) {
          if (
            !Array.isArray(body.ids) ||
            !body.ids.every((i) => typeof i === 'string' && ID_RE.test(i))
          )
            return json(400, { error: 'bad-ids' });
          ids = body.ids as string[];
        }
        return json(200, { ok: true, deleted: clearTrashedChats(deps.designRoot, ids) });
      },
    },
  ];
}
