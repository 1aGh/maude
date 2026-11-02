// client/v2/history/git-io.js — S11.10: the requests Version history › Advanced makes. `/_api/git/*` is
// unchanged; this is the one place the fold spells a route (the buttons name their registry action in
// git-model.js `GIT_ACTIONS`, and test/v2-git-advanced.test.tsx holds the two together).

/** GET → JSON, or null when the studio cannot be reached. */
export async function getJson(url, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(url);
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * POST JSON → `{ ok, status, json }`. A network-bound POST (Fetch, adding to main) gets an abort timeout so a
 * wedged server can't leave the fold spinning: the caller says "timed out" in plain words.
 */
export async function postJson(url, body, { timeoutMs, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl?.signal,
    });
    let json = null;
    try {
      json = await r.json();
    } catch {
      /* no body */
    }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, status: 0, json: null, timedOut: true };
    return { ok: false, status: 0, json: null, error: String(e?.message || e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The local branches (disk only — instant). null = not a repo / unreachable. */
export async function loadBranches(fetchImpl) {
  const j = await getJson('/_api/git/branches', fetchImpl);
  return Array.isArray(j?.branches) ? j.branches : null;
}

/**
 * The canvas at a version, as text (`GET /_api/project/source`, the `export` class: an editor has it, Can view
 * does not). null = not available (legacy hub, refused, gone).
 */
export async function loadSourceAt({ path, at, lane = 'html', fetchImpl }) {
  const qs = `path=${encodeURIComponent(path)}&at=${encodeURIComponent(at)}&lane=${lane}`;
  const j = await getJson(`/_api/project/source?${qs}`, fetchImpl);
  return j?.ok && typeof j.source === 'string' ? j.source : null;
}
