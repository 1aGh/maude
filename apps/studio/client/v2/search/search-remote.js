// client/v2/search/search-remote.js — V2-4.6: canvases + artboards for ⌘K, from the project index.
//
// `GET /_api/index?q=` (V2-2.17, main origin, no new route): the server's own matcher (accent fold,
// every word, typo tolerance). The query is sanitised first — the server splits on whitespace only, so
// the dash in "New artboard — A4" would be a word nothing contains.

import { sanitizeQuery } from './search-model.js';

/**
 * @param fetchImpl (url, { signal }) => Promise<Response> — injected so tests need no network
 * @returns the index's SearchResult, or null when nothing was asked / the server did not answer
 */
export async function searchIndex(query, { signal, fetchImpl = globalThis.fetch } = {}) {
  const q = sanitizeQuery(query);
  if (!q || !fetchImpl) return null;
  try {
    const r = await fetchImpl(`/_api/index?q=${encodeURIComponent(q)}`, {
      signal,
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data?.rows) ? data : null;
  } catch {
    return null; // aborted (a newer keystroke) or offline: local rows still answer
  }
}

/** Debounce for a typing person; the local rows answer instantly meanwhile. */
export const REMOTE_DEBOUNCE_MS = 90;
