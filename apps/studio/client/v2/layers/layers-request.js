// client/v2/layers/layers-request.js — 2.0.7 fix (decision `v2-207-layers-current`): which artboard's Layers tree
// the shell asks the open canvas for, and the asking.
//
// The tree used to be asked for only for the artboard nearest the viewport centre (`canvasActiveArtboard`), and the
// canvas posts one on a click inside it. A pick in Layers (`select-by-id`) asked for nothing, and in Pages the
// nearest-centre guess counts the artboards Pages hides — so the tree, and with it the marked row, stayed on (or
// moved to) another artboard. The tree is now asked for the artboard the person is on, the same one Layers marks.

import { useEffect, useRef } from 'react';
import { artboardInView } from '../left-panel/left-panel-model.js';

/**
 * The artboard whose tree Layers needs: the page in Pages, else the selection's artboard on this canvas
 * (`artboardInView`, what the Canvases panel marks), else the artboard nearest the viewport centre (`inView`) — so
 * Layers still shows a tree with nothing selected.
 * @param {{ selected?: any, activePath?: string|null, pagesAt?: string|null, inView?: string|null }} p
 * @returns {string|null}
 */
export function layersArtboardOf({ selected, activePath, pagesAt = null, inView = null }) {
  return artboardInView({ selected, activePath, pagesAt }) ?? (inView || null);
}

/**
 * Ask the open canvas for artboard `want`'s tree, `delay` ms after it settles (the in-view signal flickers in a
 * fast pan). With `have` — the artboard of the tree in hand — it asks only while that is another artboard's, so a
 * late tree for the previous artboard is answered by asking again instead of staying. `skip` turns it off.
 * @param {{ activePath?: string|null, want?: string|null, have?: string|null, post: (m: object) => void,
 *   delay?: number, skip?: boolean }} p
 */
export function useLayersTreeRequest({
  activePath,
  want,
  have = undefined,
  post,
  delay = 250,
  skip = false,
}) {
  const mismatch = have === undefined ? null : have !== want;
  const postRef = useRef(post);
  postRef.current = post;
  useEffect(() => {
    if (skip || !activePath || !want || mismatch === false) return undefined;
    const t = setTimeout(
      () => postRef.current?.({ dgn: 'request-layers', artboardId: want }),
      delay
    );
    return () => clearTimeout(t);
  }, [skip, activePath, want, mismatch, delay]);
}
