// client/v2/inspector/kinds/artboard-fixed.jsx — S7.21: the Fixed size artboard's rows (08 ak-social).
//
//   Size            "Story 9:16 (still)" — a preset of the one catalogue (App + Social), or Custom
//   (W × H)         the exact pixels
//
// Fill is artboard.jsx's; Safe zones + Show on canvas are S7.22's section; Export is S8's (its default here is
// `exportDefaults('digital')` — "PNG · 1×"). Clip content and Kind sit under Advanced. A fixed size keeps its exact
// pixels and lets you place things anywhere, so there is no Height mode and no Add a width.

import { useState } from 'react';

import { planConvert } from '../../../../kinds/convert.ts';
import { intendSelection } from '../../../selection-scope.js';
import ConvertDialog from '../../kinds/ConvertDialog.jsx';
import { selectCopyPlan } from '../../kinds/convert-api.js';
import { registerSlot } from '../slots.js';
import { sourceWord } from './artboard-model.js';
import { SizePairRow, SizeSelectRow, useArtboardWrites } from './artboard-rows.jsx';

function FixedRows({ el, ctx }) {
  const { f, id, can, resize, commitHeight } = useArtboardWrites(el, ctx);
  // S7.25 — Change kind: a paper picked here opens the dialog; the plan is the server's own module, so it opens at once
  const [asking, setAsking] = useState(null);
  const ask = (paper) => {
    const plan =
      id && Number.isFinite(f.w) && Number.isFinite(f.h)
        ? planConvert(
            {
              id,
              label: el?.attrs?.['data-dc-label'] || id,
              widthPx: f.w,
              heightPx: f.h,
              background: f.bg || null,
              safeZones: el?.attrs?.['data-dc-safe-zones'] || null,
            },
            { paper }
          )
        : null;
    if (plan) setAsking({ plan, paper });
  };
  return (
    <>
      <SizeSelectRow k="Size" f={f} resize={resize} onConvert={ask} />
      <SizePairRow f={f} can={can} resize={resize} commitHeight={commitHeight} />
      {asking && ctx?.canvasFile ? (
        <ConvertDialog
          plan={asking.plan}
          paper={asking.paper}
          canvas={ctx.canvasFile}
          artboardId={id}
          sourceWord={sourceWord(f)}
          onUndo={() => ctx.onUndoRedo?.('undo')}
          onDone={(r) => {
            // 08 ak-convert-after: the A6 copy is selected, the post stays as it was
            const plan = selectCopyPlan(r);
            if (!plan) return;
            // the shell's own put-back after the canvas reloads must not return the selection to the post
            intendSelection(ctx.canvasFile, { from: id, to: r.copy });
            for (const d of plan.delays) {
              if (d === 0) ctx.onRunAction?.(plan.message);
              else setTimeout(() => ctx.onRunAction?.(plan.message), d);
            }
          }}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}

const kindOf = (selection) => {
  const el = Array.isArray(selection) ? selection[0] : selection;
  return el?.attrs?.['data-dc-kind'] || 'digital';
};

export const ARTBOARD_FIXED_SLOTS = Object.freeze([
  [
    'size',
    {
      id: 'size.artboard-fixed',
      order: 10,
      kinds: ['artboard'],
      title: 'Artboard',
      when: ({ selection }) => kindOf(selection) === 'digital',
      Body: FixedRows,
    },
  ],
]);

/** @returns {() => void} take the Fixed size rows back out of the registry */
export function registerArtboardFixedSlots() {
  const offs = ARTBOARD_FIXED_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offArtboardFixed = registerArtboardFixedSlots();
