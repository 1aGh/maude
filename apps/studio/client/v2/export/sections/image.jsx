// client/v2/export/sections/image.jsx — S8.2: a post → PNG or JPG (09 ex-social).
//
// Two formats, two sizes. The format row's third control is Other… (the sheet owns that menu and hands it
// in as `other`). A format that is not PNG/JPG (picked under Other…) shows as its own chip, so the row
// always says what will be exported. v1 re-emit: `export-format-png` / `export-format-jpg`.

import {
  ANNOTATIONS_LABEL,
  ANNOTATIONS_SUB,
  IMAGE_FORMATS,
  IMAGE_SIZES,
  OTHER_GROUPS,
  SOCIAL_SIZE_NOTE,
} from '../export-copy.js';
import { RASTER, effectiveScale } from '../use-export-spec.js';
import { Check, Row, Seg } from '../parts.jsx';

const labelOf = (format) =>
  OTHER_GROUPS.flatMap((g) => g.items).find((i) => i.format === format && i.needs !== 'print')
    ?.label ?? String(format).toUpperCase();

/** @param other the "Other…" button node, drawn after the formats */
export function ImageSection({
  state,
  setFormat,
  set,
  other,
  annotationsOff = false,
  annotationsNote,
}) {
  const raster = RASTER.has(state.format);
  const formats = IMAGE_FORMATS.map(([id, label]) => ({
    id,
    label,
    testid: `export-format-${id}`,
  }));
  return (
    <>
      <Row k="Format" testid="export-row-format">
        <Seg
          label="Format"
          options={
            raster
              ? formats
              : [
                  ...formats,
                  {
                    id: state.format,
                    label: labelOf(state.format),
                    testid: `export-format-${state.format}`,
                  },
                ]
          }
          value={state.format}
          onPick={setFormat}
        />
        {other}
      </Row>
      {raster ? (
        <Row k="Size" note={SOCIAL_SIZE_NOTE} testid="export-row-size">
          <Seg
            label="Size"
            testid="export-size"
            options={IMAGE_SIZES.map(([scale, label]) => ({
              id: String(scale),
              label,
              testid: `export-size-${scale}x`,
            }))}
            value={String(effectiveScale(state, 'digital'))}
            onPick={(id) => set({ scale: Number(id) })}
          />
        </Row>
      ) : null}
      <Row k="Annotations" note={annotationsNote} testid="export-row-annotations">
        <Check
          checked={state.annotations && !annotationsOff}
          disabled={annotationsOff}
          sub={ANNOTATIONS_SUB}
          testid="export-include-annotations"
          onChange={(annotations) => set({ annotations })}
        >
          {ANNOTATIONS_LABEL}
        </Check>
      </Row>
    </>
  );
}
