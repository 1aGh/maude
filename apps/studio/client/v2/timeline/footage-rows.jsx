// client/v2/timeline/footage-rows.jsx — S7.16: what the clip Inspector says when the clip's file is not here (07 · ve-footage).
//
//   File     dron-areal-klesani-9s.mov
//   Status   Waiting for Jonas's Mac
//            Your edit is safe. It plays once the file arrives.
//
// Waiting is quiet: no error colour, no button — the file arrives by itself. Only a file NO device has (Missing) offers
// Relink…, through the same box and sheet the canvas's Missing frame opens (assets/missing-frame.jsx). A clip whose file
// is here draws nothing. Words: footage-state.js.

import { AssetAbsentBox } from '../assets/missing-frame.jsx';
import { Quiet, Row } from '../inspector/sections/row.jsx';
import { footageForSrc, footageInspector, useFootageAnswers } from './footage-state.js';

/** The footage of the selected clip (`t` = the Timeline's published selection), or null when its file is here. */
export function useClipFootage(t) {
  useFootageAnswers();
  return t?.seq?.mediaSrc ? footageForSrc(t.canvas, t.seq.mediaSrc) : null;
}

/** File · Status · the safe line, at the top of the clip's rows. */
export function FootageRows({ t }) {
  const footage = useClipFootage(t);
  if (!footage) return null;
  const view = footageInspector(t.seq.mediaSrc, footage);
  return (
    <div data-testid="insp-footage" data-state={footage.kind}>
      {view.rows.map(([k, v]) => (
        <Row k={k} name={`footage-${k.toLowerCase()}`} key={k}>
          <span className="insp-footage-v" data-testid={`insp-footage-${k.toLowerCase()}`}>
            {v}
          </span>
        </Row>
      ))}
      {view.note ? <Quiet testid="insp-footage-note">{view.note}</Quiet> : null}
      {footage.kind === 'missing' ? (
        <AssetAbsentBox el={{ src: t.seq.mediaSrc }} canvas={t.canvas} />
      ) : null}
    </div>
  );
}

/** The Advanced `status` fact of a clip that is not here (07: `status  waiting · on Jonas's Mac`). */
export function footageAdvanced(t, footage) {
  return footage ? footageInspector(t.seq.mediaSrc, footage).advanced : [];
}
