// client/v2/inspector/sections/safe-zones.jsx — S7.22: Safe zones (08 ak-safe-zones, the Fixed size and Video inspectors).
// "Where a platform's own interface covers the artboard." Two rows: the platform (None · Instagram story · Instagram
// Reels · Instagram profile grid · TikTok · YouTube Shorts · Facebook event cover) and Show on canvas.
//
// The platform is the artboard's `safeZones` JSX prop (registry `artboard.set-safe-zones`, edit-op through S2.1's dispatch
// route). Show on canvas is the person's own view state — shown unless they turned it off, per canvas — so it is not an
// edit and not an undo step. The bands are drawn by the canvas (safe-zones-overlay.tsx) and never exported.

import { useEffect, useState } from 'react';

import {
  SAFE_ZONE_OPTIONS,
  SAFE_ZONES_FOOT,
  safeZonePreset,
} from '../../../../kinds/safe-zones.ts';
import { Select, Toggle } from '../../../inspector-controls.jsx';
import {
  readSafeZonesVisible,
  writeSafeZones,
  writeSafeZonesVisible,
} from '../safe-zones-write.js';
import { registerSlot } from '../slots.js';
import { videoHasFormats } from '../formats-ui.js';
import { Quiet, Row } from './row.jsx';

/** Safe zones are for what is made for a screen of someone else's app: a fixed size or a video. */
const KINDS_WITH_ZONES = new Set(['digital', 'video']);

const first = (selection) => (Array.isArray(selection) ? selection[0] : selection);

/** The kind a payload says its artboard is (`data-dc-kind`, always stamped by DCArtboard). */
export function artboardKindOf(el) {
  return el?.attrs?.['data-dc-kind'] || 'digital';
}

/** The artboard's current preset id ('' = None), read back from `data-dc-safe-zones`. */
export function safeZonesOf(el) {
  const v = el?.attrs?.['data-dc-safe-zones'];
  return safeZonePreset(v) ? v : '';
}

export function SafeZonesBody({ el, ctx }) {
  const canvas = ctx?.canvasFile;
  const id =
    el?.artboardId || /^\[data-dc-screen="([^"]+)"\]$/.exec(el?.selector || '')?.[1] || null;
  const preset = safeZonesOf(el);
  // An artboard has no element id, so the frame's `editable` is false for it; the server judges the role (403).
  const can = !!id && !!canvas;
  const [shown, setShown] = useState(true);
  const [said, setSaid] = useState('');
  const [optimistic, setOptimistic] = useState(null);

  useEffect(() => {
    let live = true;
    if (canvas)
      readSafeZonesVisible(canvas).then((v) => {
        if (live) setShown(v);
      });
    return () => {
      live = false;
    };
  }, [canvas]);
  // the canvas read-back is the truth again as soon as it arrives
  useEffect(() => setOptimistic(null), [preset]);

  const value = optimistic ?? preset;
  const pick = async (next) => {
    if (!can) return;
    setOptimistic(next);
    setSaid('');
    const r = await writeSafeZones({ canvas, artboardId: id, preset: next || null });
    if (!r.ok) {
      setOptimistic(null);
      setSaid(r.message);
    }
  };
  const toggle = async (next) => {
    setShown(next);
    if (!(await writeSafeZonesVisible(canvas, next))) setShown(!next);
  };

  return (
    <>
      <Row k="Safe zones" name="safe-zones">
        <Select
          value={value}
          options={SAFE_ZONE_OPTIONS}
          ariaLabel="Safe zones"
          testId="insp-safe-zones"
          onChange={pick}
        />
      </Row>
      {value ? (
        <Row k="Show on canvas" name="safe-zones-show">
          <span data-testid="insp-safe-zones-show">
            <Toggle checked={shown} ariaLabel="Show safe zones on the canvas" onChange={toggle} />
          </span>
        </Row>
      ) : null}
      {said ? <Quiet testid="insp-safe-zones-said">{said}</Quiet> : null}
      {value ? <Quiet testid="insp-safe-zones-note">{safeZonePreset(value)?.note}</Quiet> : null}
      {/* V2-8.5 C2 (copy · ak-social): the platforms' footnote belongs to a chosen platform, not to "None" */}
      {value ? <Quiet testid="insp-safe-zones-foot">{SAFE_ZONES_FOOT}</Quiet> : null}
    </>
  );
}

export const offSafeZones = registerSlot('safe-zones', {
  id: 'safe-zones.artboard',
  order: 10,
  kinds: ['artboard'],
  // 07 VideoInspector: a lone video's card has no Safe zones (ve-select); they sit with the Formats once it has others
  when: ({ selection, ctx }) => {
    const kind = artboardKindOf(first(selection));
    return KINDS_WITH_ZONES.has(kind) && (kind !== 'video' || videoHasFormats(selection, ctx));
  },
  Body: SafeZonesBody,
});
