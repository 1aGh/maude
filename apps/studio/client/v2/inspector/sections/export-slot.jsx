// client/v2/inspector/sections/export-slot.jsx — S2.5: the Export section's slot (14 Editing, ed-inspector §10).
// "This object as PNG or SVG — artboards export the same way, plus ⇧⌘E."
//
// S8 fills this section (sizes with +/−, formats, Copy as PNG ⇧⌘C). Until it does, the slot shows the DEFAULT presets
// per kind (C21: 08's buttons are the default presets) as plain words and points at the sheet. It is registered under
// `export.presets`; S8 registers its own entry and calls `offExportSlot()` for the placeholder, or sits beside it with a
// lower `order`.

import { exportDefaults } from '../../../../kinds/export-defaults.ts';
import { registerSlot } from '../slots.js';
import { Quiet, Row } from './row.jsx';

/** The default presets for what is selected: the words of the buttons 08 and the video inspector carry. */
export function exportPresets({ el, selection, kind }) {
  if (kind === 'multi' || kind === 'multi-artboard')
    return [`${Array.isArray(selection) ? selection.length : 1} files…`];
  if (kind === 'artboard') return [exportDefaults(el?.attrs?.['data-dc-kind']).word];
  return ['PNG · 2×', 'SVG'];
}

export function ExportSlotBody({ el, selection, kind }) {
  const presets = exportPresets({ el, selection, kind });
  return (
    <>
      <Row k="Presets" name="export-presets">
        <span className="insp-export-presets" data-testid="insp-export-presets">
          {presets.map((p) => (
            <span key={p} className="insp-export-chip" data-testid="insp-export-preset">
              {p}
            </span>
          ))}
        </span>
      </Row>
      <Quiet testid="insp-export-more">Export… — every option ⇧⌘E</Quiet>
    </>
  );
}

/**
 * 07 VideoInspector: a video artboard's card has Export as ONE row with an MP4 button (kinds/artboard-video.jsx),
 * not a section with presets — so the generic section stands aside for it.
 */
const first = (selection) => (Array.isArray(selection) ? selection[0] : selection);
export const isVideoArtboard = (selection) => {
  const el = first(selection);
  return (
    !!el?.attrs &&
    el.attrs['data-dc-kind'] === 'video' &&
    /^\[data-dc-screen=/.test(el.selector || '')
  );
};

export const EXPORT_SLOT_ENTRY = Object.freeze({
  id: 'export.presets',
  order: 100,
  when: ({ selection }) => !isVideoArtboard(selection),
  Body: ExportSlotBody,
});

export const offExportSlot = registerSlot('export', EXPORT_SLOT_ENTRY);
