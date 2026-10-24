// client/v2/inspector/sections/safe-zones.jsx — S7.22: Safe zones (08 ak-safe-zones, the Fixed size and Video inspectors).
// "Where a platform's own interface covers the artboard." Two rows: the platform (None · Instagram story · Instagram
// Reels · Instagram profile grid · TikTok · YouTube Shorts · Facebook event cover) and Show on canvas.
//
// The platform is the artboard's `safeZones` JSX prop (registry `artboard.set-safe-zones`, edit-op through S2.1's dispatch
// route). Show on canvas is the person's own view state — shown unless they turned it off, per canvas — so it is not an
// edit and not an undo step. The bands are drawn by the canvas (safe-zones-overlay.tsx) and never exported.

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  SAFE_ZONE_OPTIONS,
  SAFE_ZONES_FOOT,
  safeZonePreset,
} from '../../../../kinds/safe-zones.ts';
import { Toggle } from '../../../inspector-controls.jsx';
import {
  readSafeZonesVisible,
  writeSafeZones,
  writeSafeZonesVisible,
} from '../safe-zones-write.js';
import { registerSlot } from '../slots.js';
import { useDismiss } from '../token-chip.jsx';
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

/**
 * V2-8.5 C4 (08 ak-safe-zones) — the platform is a select-shaped trigger that opens the board's FLOATING menu: a "Safe zones"
 * head, one row per platform with a check column, a rule, and the footnote ("Shown on the canvas only — never exported…").
 * The platform's own note is the row's tooltip; it no longer sits in the card.
 */
function ZonesMenu({ value, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);
  const current = SAFE_ZONE_OPTIONS.find((o) => o.value === value) ?? SAFE_ZONE_OPTIONS[0];
  return (
    <span className="insp-zones" ref={ref}>
      <button
        type="button"
        className="st-cp-nsel insp-zones-trigger"
        data-testid="insp-safe-zones"
        data-value={value}
        aria-label="Safe zones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{current.label}</span>
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div className="insp-menu insp-zmenu" role="menu" aria-label="Safe zones" data-testid="insp-safe-zones-menu">
          <span className="insp-zmenu-h">Safe zones</span>
          {SAFE_ZONE_OPTIONS.map((o) => (
            <button
              key={o.value || 'none'}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className="insp-menu-i insp-zmenu-i"
              data-testid={`insp-safe-zones-${o.value || 'none'}`}
              title={safeZonePreset(o.value)?.note}
              onClick={() => {
                setOpen(false);
                onPick(o.value);
              }}
            >
              <span className="insp-zmenu-ic" aria-hidden="true">
                {o.value === value ? <Check size={14} strokeWidth={1.75} /> : null}
              </span>
              <span className="insp-zmenu-lab">{o.label}</span>
            </button>
          ))}
          <span className="insp-zmenu-sep" aria-hidden="true" />
          <span className="insp-zmenu-foot" data-testid="insp-safe-zones-foot">
            {SAFE_ZONES_FOOT}
          </span>
        </div>
      ) : null}
    </span>
  );
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
        <ZonesMenu value={value} onPick={pick} />
      </Row>
      {value ? (
        <Row k="Show on canvas" name="safe-zones-show">
          <span data-testid="insp-safe-zones-show">
            <Toggle checked={shown} ariaLabel="Show safe zones on the canvas" onChange={toggle} />
          </span>
        </Row>
      ) : null}
      {said ? <Quiet testid="insp-safe-zones-said">{said}</Quiet> : null}
    </>
  );
}

export const offSafeZones = registerSlot('safe-zones', {
  id: 'safe-zones.artboard',
  order: 10,
  kinds: ['artboard'],
  when: ({ selection }) => KINDS_WITH_ZONES.has(artboardKindOf(first(selection))),
  Body: SafeZonesBody,
});
