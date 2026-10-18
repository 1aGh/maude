// The hub's Trash door — S1.7 (S1-canvas-row-slots §4, V2-1.7 §5.6).
//
//   POST /api/trash/clear  { items?: string[] }  → { ok, cleared, skipped? }
//
// Clear-out is the PROJECT OWNER's (`delete`, PROJECT_ONLY). Two checks, one
// matrix: the row's `cap: { unsafe: 'delete' }` is the access gate's (S9), and
// `scope: 'project'` with NO `canvasDoor` makes it refuse every canvas-only
// session before this handler runs (fail closed); the handler then asks the
// kernel op `trash.clear` (S1.6), which re-checks the role per op. The project
// is the hub's own (one project per hub), so the path names none.

const MAX_BODY = 64 * 1024;

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) return { tooLarge: true };
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return { body: {} };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: null };
  }
}

const STATUS = { forbidden: 403, 'not-in-scope': 403, invalid: 400, retryable: 503 };

/** `deps.accepted()` → the accepted-revisions integration; `deps.auth(request)` → who. */
export async function handleTrashClear(ctx) {
  const { request, method, respondJson, deps } = ctx;
  if (method !== 'POST') {
    respondJson(405, { ok: false, code: 'method' });
    return true;
  }
  const accepted = deps?.accepted?.();
  const who = deps?.auth?.(request);
  if (!accepted?.clearTrash || !who) {
    respondJson(who ? 503 : 401, { ok: false, code: who ? 'unavailable' : 'unauthenticated' });
    return true;
  }
  if (who.access?.canvasOnly === true) {
    respondJson(403, { ok: false, error: 'not-in-scope', reason: 'not-in-scope' });
    return true;
  }
  if (!who.owner || who.readOnly) {
    respondJson(403, {
      ok: false,
      code: 'forbidden',
      error: 'only the project owner can clear out the trash',
    });
    return true;
  }
  const { body, tooLarge } = await readJson(request);
  if (tooLarge) {
    respondJson(413, { ok: false, code: 'too-large' });
    return true;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    respondJson(400, { ok: false, code: 'invalid' });
    return true;
  }
  const items = body.items;
  if (items !== undefined && !Array.isArray(items)) {
    respondJson(400, { ok: false, code: 'invalid' });
    return true;
  }
  const r = await accepted.clearTrash({ who, items });
  const answer = r?.body ?? {};
  if (answer.status === 'accepted') {
    respondJson(200, {
      ok: true,
      cleared: answer.cleared ?? [],
      ...(answer.skipped?.length ? { skipped: answer.skipped } : {}),
    });
  } else {
    respondJson(STATUS[answer.code] ?? 409, { ok: false, code: answer.code ?? 'refused' });
  }
  return true;
}

export const TRASH_ROWS = Object.freeze([
  {
    path: '/api/trash/clear',
    cap: Object.freeze({ safe: 'delete', unsafe: 'delete' }),
    scope: 'project',
    handler: handleTrashClear,
  },
]);
