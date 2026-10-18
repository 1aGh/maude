// client/v2/export/sections/web.jsx — S8.2: a web page → the full page as an image, or a PDF (09 ex-web).
//
// "Image" takes the whole page, not just the visible area. Size is one choice across format and scale
// (PNG 1× · PNG 2× · JPG 2×). Code is not a file format: the line at the foot opens Handoff to
// production. v1 re-emit: `export-format-pdf` (the PDF segment); `export-format-png`/`-jpg` ride the
// Size choices so the old hooks still land on the right format.

import {
  ANNOTATIONS_LABEL,
  ANNOTATIONS_SUB,
  OTHER_GROUPS,
  WEB_AREA_NOTE,
  WEB_CODE_ACTION,
  WEB_CODE_LINE,
  WEB_FORMATS,
  WEB_SIZE_NOTE,
  WEB_SIZES,
} from '../export-copy.js';
import { RASTER, effectiveScale } from '../use-export-spec.js';
import { Check, Row, Seg } from '../parts.jsx';

const sizeId = (format, scale) => `${format}-${scale}`;
const labelOf = (format) =>
  OTHER_GROUPS.flatMap((g) => g.items).find((i) => i.format === format && !i.needs)?.label ??
  String(format).toUpperCase();

export function WebSection({ state, setFormat, set, other, onHandoff, annotationsOff = false }) {
  const image = RASTER.has(state.format);
  const pdf = state.format === 'pdf';
  const group = image ? 'image' : pdf ? 'pdf' : state.format;
  const scale = effectiveScale(state, 'web');
  const options = WEB_FORMATS.map(([id, label]) => ({
    id,
    label,
    testid: id === 'pdf' ? 'export-format-pdf' : 'export-format-web-image',
  }));
  if (!image && !pdf)
    options.push({
      id: state.format,
      label: labelOf(state.format),
      testid: `export-format-${state.format}`,
    });
  return (
    <>
      <Row k="Format" testid="export-row-format">
        <Seg
          label="Format"
          options={options}
          value={group}
          onPick={(id) => setFormat(id === 'image' ? 'png' : id)}
        />
        {other}
      </Row>
      {image ? (
        <>
          <Row k="Area" note={WEB_AREA_NOTE} testid="export-row-area">
            <span className="ex-val">Full page</span>
          </Row>
          <Row k="Size" note={WEB_SIZE_NOTE} testid="export-row-size">
            <Seg
              label="Size"
              testid="export-size"
              options={WEB_SIZES.map(([label, format, s]) => ({
                id: sizeId(format, s),
                label,
                testid: `export-size-${sizeId(format, s)}`,
              }))}
              value={sizeId(state.format, scale)}
              onPick={(id) => {
                const [format, s] = id.split('-');
                setFormat(format);
                set({ scale: Number(s) });
              }}
            />
          </Row>
        </>
      ) : null}
      <Row k="Annotations" testid="export-row-annotations">
        <Check
          checked={state.annotations}
          disabled={annotationsOff}
          sub={ANNOTATIONS_SUB}
          testid="export-include-annotations"
          onChange={(annotations) => set({ annotations })}
        >
          {ANNOTATIONS_LABEL}
        </Check>
      </Row>
      <div className="ex-code" data-testid="export-code-line">
        <span>{WEB_CODE_LINE}</span>
        <button
          type="button"
          className="ex-code-a"
          onClick={onHandoff}
          data-testid="export-code-action"
        >
          {WEB_CODE_ACTION}
        </button>
        <kbd className="ex-kbd">⇧⌘H</kbd>
      </div>
    </>
  );
}
