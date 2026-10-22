// client/v2/inspector/sections/warnings.jsx — S7.25: the one warning style, in the inspector (08 ak-warnings, ak-convert-after).
//
// "A warning is a mark beside the artboard's label and a row at the top of its inspector, with one verb." The canvas measures
// the artboard itself (artboard-warn-mark.tsx) and stamps what it found on the artboard as `data-dc-warnings`, which the selection
// payload already carries — so the rows here need no request of their own. Shown, never blocking, never a dialog; a verb
// that cannot run says why in one line under the row. "Made from" (the Print artboard Change kind made) sits with the other
// rows, below the kind's own.
//
// The write behind a verb is warning-fix.js; its registry action is `warning.fix`.

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { runWarningFix } from '../warning-fix.js';
import { registerBlock } from '../blocks.js';
import { registerSlot } from '../slots.js';
import { Quiet, Row } from './row.jsx';

const ARTBOARD = ['artboard'];

/** The warnings an artboard's selection payload carries, tolerant of anything unreadable. */
export function warningsOf(el) {
  const raw = el?.attrs?.['data-dc-warnings'];
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.filter((w) => w && typeof w.id === 'string' && typeof w.text === 'string' && w.verb)
      : [];
  } catch {
    return [];
  }
}

function printOf(el) {
  try {
    return el?.attrs?.['data-dc-print'] ? JSON.parse(el.attrs['data-dc-print']) : null;
  } catch {
    return null;
  }
}

export function WarningRows({ el, ctx }) {
  const list = warningsOf(el);
  const [said, setSaid] = useState({});
  const [busy, setBusy] = useState('');
  const artboardId =
    el?.artboardId || /^\[data-dc-screen="([^"]+)"\]$/.exec(el?.selector || '')?.[1] || null;
  if (list.length === 0) return null;
  const run = async (w) => {
    setBusy(w.id);
    setSaid((s) => ({ ...s, [w.id]: '' }));
    const r = await runWarningFix(w, {
      canvas: ctx?.canvasFile,
      artboardId,
      print: printOf(el),
      ctx,
    });
    setBusy('');
    if (!r.ok) setSaid((s) => ({ ...s, [w.id]: r.message || 'Not changed; try again.' }));
  };
  return (
    <>
      {list.map((w) => (
        <div
          key={w.id}
          className="insp-warn"
          data-testid={`insp-warning-${w.code}`}
          data-warning={w.id}
        >
          <span className="insp-warn-ic">
            <AlertTriangle size={14} aria-hidden="true" />
          </span>
          <span className="insp-warn-t">{w.text}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm insp-warn-a"
            data-testid={`insp-warning-fix-${w.code}`}
            disabled={busy === w.id}
            onClick={() => run(w)}
          >
            {w.verb}
          </button>
          {said[w.id] ? (
            <span className="insp-warn-said" role="status">
              {said[w.id]}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

/** "Made from  Oznámení události · 4:5" — only on an artboard Change kind made. */
export function MadeFromRow({ el }) {
  const label = el?.attrs?.['data-dc-made-from'];
  if (!label) return null;
  return (
    <>
      <Row k="Made from" name="made-from">
        <span data-testid="insp-made-from">{label}</span>
      </Row>
      <Quiet testid="insp-made-from-note">A copy. The original is unchanged.</Quiet>
    </>
  );
}

export const WARNING_SLOTS = Object.freeze([
  ['size', { id: 'size.artboard-made-from', order: 60, kinds: ARTBOARD, Body: MadeFromRow }],
]);

/**
 * V2-8.5 C2 (08 ak-warnings) — the warning is the FIRST row of the inspector, above every section: "a mark beside the
 * label, one row at the top of the inspector, one verb". It is a block, not a row of the Artboard section it used to
 * sit under (below the head and the system line).
 */
export const WARNING_BLOCK = Object.freeze({
  id: 'artboard.warnings',
  kinds: ARTBOARD,
  at: 'top',
  order: 1,
  Body: WarningRows,
});

/** @returns {() => void} take the warning rows back out of the registry */
export function registerWarningSlots() {
  const offs = [
    ...WARNING_SLOTS.map(([section, entry]) => registerSlot(section, entry)),
    registerBlock(WARNING_BLOCK),
  ];
  return () => {
    for (const off of offs) off();
  };
}

export const offWarnings = registerWarningSlots();
