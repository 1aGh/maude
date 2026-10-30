// client/v2/help/add-guides.js — S6.15 (Q10): Help › Help and guides › "Add the guide canvases to this
// project" (`help.add-guides`). A new project starts empty; this is the one door to the two guides
// (How to use Maude, How to make video). It is `POST /_api/help/add-guides` — Can edit and up, refused
// below that by the server whatever the UI shows — and the same function runs for the Help dialog's
// button and the ⌘K row, so there is one set of words.

export const ADD_GUIDES_ROUTE = '/_api/help/add-guides';

export const GUIDES_WORDS = Object.freeze({
  label: 'Add the guide canvases to this project',
  adding: 'Adding the guides…',
  added: 'Added the guides to this project.',
  alreadyThere: 'The guides are already in this project.',
  readOnly: 'Your role can’t add canvases to this project.',
  failed: 'Couldn’t add the guides.',
});

/** What a person reads after the route answers (`added` = guides written, `skipped` = already there). */
export function guidesLine({ added = [], skipped = [] } = {}) {
  if (added.length === 0 && skipped.length > 0) return GUIDES_WORDS.alreadyThere;
  if (added.length === 0) return GUIDES_WORDS.failed;
  if (skipped.length === 0) return GUIDES_WORDS.added;
  return `Added ${added.join(' and ')}. ${skipped.join(' and ')} ${skipped.length > 1 ? 'were' : 'was'} already here.`;
}

/**
 * Ask the studio to add the guides. Never throws: `{ ok, words, added, skipped }`, where `words` is the
 * line to show (toast or inline). A 403 is the role words; anything else is "Couldn’t add the guides."
 */
export async function addGuides(fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(ADD_GUIDES_ROUTE, { method: 'POST' });
    if (r.status === 403)
      return { ok: false, words: GUIDES_WORDS.readOnly, added: [], skipped: [] };
    if (!r.ok) return { ok: false, words: GUIDES_WORDS.failed, added: [], skipped: [] };
    const body = await r.json();
    const added = Array.isArray(body?.added) ? body.added : [];
    const skipped = Array.isArray(body?.skipped) ? body.skipped : [];
    return { ok: true, words: guidesLine({ added, skipped }), added, skipped };
  } catch {
    return { ok: false, words: GUIDES_WORDS.failed, added: [], skipped: [] };
  }
}
