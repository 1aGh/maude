// client/v2/export/advanced/image.jsx — S8.3: Advanced › Image (PNG · JPG).
//
// Exact scale or dpi (the old dialog's Resolution: 1×–3× and 150 · 300 · 600 dpi — nothing-deleted
// A-png-at-150-300-600-dpi), the colour profile, JPG quality and the background. A size picked here
// wins over the sheet's 1× / 2×.

import { Row, Seg } from '../parts.jsx';
import {
  BACKGROUND,
  COLOUR_NOTE,
  COLOUR_PROFILE,
  EXACT_DPI,
  EXACT_SCALE,
  IMAGE_TITLE,
  JPG_QUALITY,
  SIZE_BY,
  SIZE_NOTE,
} from './advanced-copy.js';
import { Note, NumberField, Select } from './fields.jsx';
import {
  BACKGROUNDS,
  COLOR_PROFILES,
  DPI_PRESETS,
  DPI_RANGE,
  JPG_DEFAULT,
  JPG_RANGE,
  SCALE_RANGE,
} from './model.js';

/**
 * @param adv       what the fold has touched (`state.adv`)
 * @param setAdv    (patch) => void
 * @param sheetScale  the 1× / 2× the sheet itself has picked (shown until an exact one is typed)
 * @param jpg       is a JPG part of this export?
 */
export function ImagePart({ adv, setAdv, sheetScale = 1, jpg = false }) {
  const by = adv.sizeBy === 'dpi' ? 'dpi' : 'scale';
  return (
    <section className="ex-advp" data-testid="export-adv-image" aria-label={IMAGE_TITLE}>
      <Row k={SIZE_BY}>
        <Seg
          label={SIZE_BY}
          testid="export-adv-size-by"
          options={[
            { id: 'scale', label: 'Scale', testid: 'export-adv-size-by-scale' },
            { id: 'dpi', label: 'dpi', testid: 'export-adv-size-by-dpi' },
          ]}
          value={by}
          onPick={(sizeBy) => setAdv({ sizeBy })}
        />
      </Row>
      {by === 'scale' ? (
        <Row k={EXACT_SCALE}>
          <NumberField
            label={EXACT_SCALE}
            testid="export-adv-scale"
            unit="×"
            range={SCALE_RANGE}
            value={adv.scale ?? sheetScale}
            onCommit={(scale) => setAdv({ sizeBy: 'scale', scale })}
          />
        </Row>
      ) : (
        <Row k={EXACT_DPI}>
          <Seg
            label={EXACT_DPI}
            testid="export-adv-dpi-presets"
            options={DPI_PRESETS.map((d) => ({
              id: String(d),
              label: String(d),
              testid: `export-adv-dpi-${d}`,
            }))}
            value={String(adv.dpi ?? '')}
            onPick={(d) => setAdv({ sizeBy: 'dpi', dpi: Number(d) })}
          />
          <NumberField
            label={EXACT_DPI}
            testid="export-adv-dpi"
            unit="dpi"
            integer
            range={DPI_RANGE}
            value={adv.dpi}
            onCommit={(dpi) => setAdv({ sizeBy: 'dpi', dpi })}
          />
        </Row>
      )}
      <Note>{SIZE_NOTE}</Note>
      <Row k={COLOUR_PROFILE}>
        <Seg
          label={COLOUR_PROFILE}
          testid="export-adv-color"
          options={COLOR_PROFILES.map(([id, label]) => ({
            id,
            label,
            testid: `export-adv-color-${id}`,
          }))}
          value={adv.colorProfile ?? 'srgb'}
          onPick={(colorProfile) => setAdv({ colorProfile })}
        />
      </Row>
      <Note>{COLOUR_NOTE}</Note>
      {jpg ? (
        <Row k={JPG_QUALITY}>
          <NumberField
            label={JPG_QUALITY}
            testid="export-adv-jpg-quality"
            unit="%"
            integer
            range={JPG_RANGE}
            value={adv.jpgQuality ?? JPG_DEFAULT}
            onCommit={(jpgQuality) => setAdv({ jpgQuality })}
          />
        </Row>
      ) : null}
      <Row k={BACKGROUND}>
        <Select
          label={BACKGROUND}
          testid="export-adv-background"
          value={adv.background ?? 'artboard'}
          options={BACKGROUNDS}
          onChange={(background) => setAdv({ background })}
        />
      </Row>
    </section>
  );
}
