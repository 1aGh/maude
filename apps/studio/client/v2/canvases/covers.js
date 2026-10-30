// client/v2/canvases/covers.js — P8 C5 (01 / 02 / 05 / 11): the Canvases panel's rows carry a picture of their
// canvas (`/_api/thumb/<key>`, the index row's `cover`). A cover exists only once the thumbnail service has
// rendered it, and nothing started that pass — every row was a blank box. The panel asks once per page load;
// the service queues every canvas's cover at background priority (never in front of a visible request) and
// each finished one reaches the rows through the index (`index-changed`), so the pictures arrive one by one.

let asked = false;

/** POST /_api/thumbs/want { keys: [], background: true } — at most once per page load; a refusal is silent. */
export function askForCovers(fetchImpl) {
  if (asked) return false;
  asked = true;
  const f = fetchImpl ?? globalThis.fetch;
  if (typeof f !== 'function') return false;
  try {
    Promise.resolve(
      f('/_api/thumbs/want', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [], background: true }),
      })
    ).catch(() => {});
  } catch {
    /* no network, no pictures — the rows keep their small page */
  }
  return true;
}

/** Tests: forget that this page asked. */
export function resetCoversAsked() {
  asked = false;
}
