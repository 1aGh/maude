// client/v2/inspector/kinds/artboard-advanced-rows.jsx — S7.21: what a web page, a fixed size and a video keep under
// Advanced ("Every number, under Advanced." — 08).
//
//   Exact size     W × H, for a web page and a video (a fixed size shows them above; paper has its own, S7.23:
//                  artboard-print-advanced.jsx)
//   Clip content   on — an artboard always clips to its edge
//   Kind           the same four words as the chip; switching still writes the kind prop (S7.25 asks first when it
//                  converts something)
//   the facts      `kind web · width 1440px · height auto · min 900px · display flex · column`
//
// Rendered by ArtboardAdvanced (artboard-advanced.jsx); testids are the ones the rows had in the Artboard section.

import { Select, Toggle } from '../../../inspector-controls.jsx';
import { resolvePrintArtboard } from '../../../../print/units.ts';
import { Row } from '../sections/row.jsx';
import { advancedFacts } from './artboard-kinds-model.js';
import { KIND_OPTIONS } from './artboard-model.js';
import { SizePairRow, handlersOf, useArtboardWrites } from './artboard-rows.jsx';
import { useCompMedia } from '../../transcript/comp-media-store.js';
import { useVideoFacts } from './video-facts.js';
import { ArtboardSpacingRows } from './artboard.jsx';

/** Kinds whose rows live in artboard-{web,fixed,video,print}.jsx. Paper's exact numbers are its own Advanced rows
 *  (client/v2/kinds/advanced-rows.js, S7.23); here it keeps Clip content and Kind. */
const OWN_ROWS = new Set(['web', 'digital', 'video', 'print']);

export function ArtboardAdvancedRows({ el, ctx }) {
  const { f, id, can, resize, commitHeight } = useArtboardWrites(el, ctx);
  const h = handlersOf(ctx);
  const file = el?.file ?? ctx?.canvasFile ?? null;
  const video = useVideoFacts(file, f.kind === 'video' ? id : null);
  // S7.13 — a video that shares its cut says which comp it is (07 ve-formats: `linkedTo`, `framing per format`)
  const formats = useCompMedia(f.kind === 'video' ? file : null, id).media?.formats;
  const linkedTo = formats?.formats?.length > 1 ? formats.comp : null;
  if (!OWN_ROWS.has(f.kind)) return null;

  const setKind = (next) => {
    if (!id) return;
    let seedPrint = null;
    if (next === 'print' && !f.print) {
      const defaults = { paper: 'a4' };
      try {
        const r = resolvePrintArtboard(defaults);
        if (r) seedPrint = { defaults, widthPx: r.widthPx, heightPx: r.heightPx };
      } catch {
        /* keep null */
      }
    }
    // "Fixed size" is the implicit kind: it clears the prop instead of writing `kind="digital"`
    h.onSetArtboardKind?.(id, next === 'digital' ? null : next, seedPrint);
    // a web page hugs its height: switching to it frees a Fixed height in the same gesture
    if (next === 'web' && f.fixed) h.onSetArtboardHug?.(id, false, undefined);
  };

  return (
    <div className="insp-adv-kind" data-testid="insp-adv-kind">
      {f.kind !== 'digital' && f.kind !== 'print' ? (
        <SizePairRow f={f} can={can} resize={resize} commitHeight={commitHeight} />
      ) : null}
      {f.kind === 'web' ? <ArtboardSpacingRows el={el} ctx={ctx} /> : null}
      <Row k="Clip content" name="ab-clip">
        <span data-testid="insp-ctl-ab-clip">
          {/* An artboard always clips to its edge (DCArtboard); there is no prop to turn it off, so the switch shows
              the truth and does not pretend. */}
          <Toggle checked ariaLabel="Clip content" onChange={() => {}} />
        </span>
      </Row>
      <Row k="Kind" name="ab-kind">
        <Select
          value={f.kind}
          ariaLabel="Artboard kind"
          testId="insp-ab-kind"
          options={KIND_OPTIONS}
          onChange={setKind}
        />
      </Row>
      {(f.kind === 'print' ? [] : advancedFacts(f, { ...video, linkedTo })).map(([k, v]) => (
        <Row key={k} k={k} name={`ab-fact-${k}`}>
          <span className="insp-ro" data-testid={`insp-ab-fact-${k}`}>
            {v}
          </span>
        </Row>
      ))}
    </div>
  );
}
