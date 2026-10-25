// client/v2/kinds/LayersKindFilter.jsx — S7.24b: the kind chips in the Layers header (08 · ak-mixed-fit,
// 05 · es-filter). The same chips and the same filter as the Canvases panel (kind-filter-store.js), counted over
// the ARTBOARDS of the open canvas:
//
//   All 21 · Fixed size 19 · Web page 0 · [Print 2] · Video 0
//   19 other artboards are dimmed. Show all
//
// The chips dim; they do not hide. The canvas does the dimming (`dim-artboards`, kind-dim-relay.js); this panel
// says how many are dimmed and gives the way out. A filter that matches no artboard of this canvas says which
// filter it is and clears in one click (the kit's block). Nothing renders for a canvas whose artboards the index
// does not know yet — there is nothing to filter.

import { useEffect, useMemo, useRef } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { Empty } from '../empty/empty.jsx';
import { KindChips } from './KindChips.jsx';
import { isFilterKind } from './kind-filter-model.js';
import {
  clearKindFilter,
  FOCUS_LAYERS_KIND_EVENT,
  takeFocusLayersKindRequest,
  useKindFilter,
} from './kind-filter-store.js';
import { artboardCounts, layersFoot, noArtboardsOfKind, SHOW_ALL } from './layers-kind-model.js';

/** @param {{ boards?: Array<{ id: string, kind?: string }>, canvasName?: string }} props */
export function LayersKindFilter({ boards, canvasName = '' }) {
  const [filter, , pick] = useKindFilter();
  const ref = useRef(null);
  const counts = useMemo(() => artboardCounts(boards), [boards]);
  const known = counts.all > 0;
  const kind = known && isFilterKind(filter) ? filter : 'all';

  // ⌘K "Filter layers by kind": the cursor goes to the chip that is on, or to All
  useEffect(() => {
    if (!known) return undefined;
    const focus = () => {
      if (!takeFocusLayersKindRequest()) return;
      const root = ref.current;
      (root?.querySelector('.kf-chip[data-on]') || root?.querySelector('.kf-chip'))?.focus();
    };
    focus();
    window.addEventListener(FOCUS_LAYERS_KIND_EVENT, focus);
    return () => window.removeEventListener(FOCUS_LAYERS_KIND_EVENT, focus);
  }, [known]);

  if (!known) return null;
  const foot = layersFoot({ boards, kind });
  const none = kind !== 'all' && counts[kind] === 0;
  const words = none ? noArtboardsOfKind({ kind, canvas: canvasName, boards }) : null;
  return (
    <div className="kf-layers" ref={ref} data-testid="layers-kind-filter">
      <KindChips
        counts={counts}
        on={kind}
        onPick={pick}
        label="Filter layers by kind"
        testid="layers-kind-chips"
        chipPrefix="layers-kind-chip"
      />
      {words ? (
        <Empty
          glyph={kind === 'print' ? 'print' : 'layers'}
          title={words.title}
          next={words.next}
          testid="layers-kind-none"
          className="es-e--inpanel"
          actions={
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="layers-kind-clear"
              onClick={clearKindFilter}
            >
              <StIcon name="x" size={12} />
              {words.action}
            </button>
          }
        />
      ) : null}
      {foot && !words ? (
        <p className="kf-foot" data-testid="layers-kind-foot">
          {foot}{' '}
          <button
            type="button"
            className="kf-foot-link"
            data-testid="layers-kind-show-all"
            onClick={clearKindFilter}
          >
            {SHOW_ALL}
          </button>
        </p>
      ) : null}
    </div>
  );
}
