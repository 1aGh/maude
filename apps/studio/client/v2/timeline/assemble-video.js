// client/v2/timeline/assemble-video.js — Menu › File › Assemble video (DDR-150 P4 Task 12), the flow itself.
//
// Reads the ACTIVE canvas's annotation sidecar (main origin), gathers every dropped media-reference chip's src in
// document order and POSTs an assembled video comp (`kind: 'video-comp'`), then opens it. Every outcome the user
// should hear about is a toast through the injected `toast` (the shell's `shellToast`) — never `window.alert`, which
// froze the window behind a native dialog (p8-sweep-leftovers item 7).

export const NO_CLIPS_WORDS = 'Drop video/audio clips on the canvas first, then assemble them into a video.';

/** The media chips of an annotation sidecar, in document order. */
export function clipsFromAnnotations(svg) {
  const clips = [];
  if (!svg || typeof DOMParser === 'undefined') return clips;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  for (const g of doc.querySelectorAll('[data-tool="mediaref"]')) {
    const src = g.getAttribute('data-src');
    if (!src) continue;
    clips.push({ src, mediaKind: g.getAttribute('data-media-kind') === 'audio' ? 'audio' : 'video' });
  }
  return clips;
}

/**
 * @param {{ activePath: string, name: string, toast: (message: string, ok?: boolean, action?: any, extra?: object) => void,
 *   loadTree: () => Promise<unknown>, openTab: (file: string) => void, fetchImpl?: typeof fetch }} deps
 * @returns {Promise<'no-clips' | 'failed' | 'opened'>}
 */
export async function assembleVideoFlow({ activePath, name, toast, loadTree, openTab, fetchImpl = globalThis.fetch }) {
  try {
    const ar = await fetchImpl(`/_api/annotations?file=${encodeURIComponent(activePath)}`);
    const clips = clipsFromAnnotations(ar.ok ? await ar.text() : '');
    if (clips.length === 0) {
      toast(NO_CLIPS_WORDS, false, undefined, { kind: 'info' });
      return 'no-clips';
    }
    const r = await fetchImpl('/_api/canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind: 'video-comp', clips }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      toast(`Assemble failed: ${j.error || `error ${r.status}`}`);
      return 'failed';
    }
    await loadTree();
    openTab(j.file);
    return 'opened';
  } catch (e) {
    toast(`Assemble failed: ${e instanceof Error ? e.message : 'network error'}`);
    return 'failed';
  }
}
