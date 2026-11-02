// client/v2/assets/details-advanced.jsx — Asset details › Advanced (S8.21; 12 · ia-advanced).
//
// Mono, paths and commands live ONLY here (CONTRACT §5): where the file is stored, where it came from on this Mac, the edit
// files beside it, the cut-out, how a canvas refers to it, and the command that imports it the same way from a terminal.
// Closed by default; open or closed is remembered per Mac like every Advanced fold (`assets.details`).

import { useState } from 'react';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { copyText } from '../left-panel/canvas-file-menu.js';
import { advancedHint, advancedRows } from './details-model.js';

export const DETAILS_FOLD = 'assets.details';

const CLASSES = Object.freeze({
  root: 'lp-dt-adv',
  btn: 'lp-dt-adv-btn',
  ch: 'lp-dt-adv-ch',
  hint: 'lp-dt-adv-hint',
  body: 'lp-dt-adv-body',
});

function CopyChip({ text, testid }) {
  const [said, setSaid] = useState(false);
  return (
    <button
      type="button"
      className="lp-dt-copy"
      data-testid={testid}
      onClick={async () => {
        if (await copyText(text)) {
          setSaid(true);
          setTimeout(() => setSaid(false), 1500);
        }
      }}
    >
      {said ? 'Copied' : 'Copy'}
    </button>
  );
}

export function DetailsAdvanced({ details }) {
  const rows = advancedRows(details);
  if (!rows.length) return null;
  const command = details.advanced?.command;
  return (
    <AdvancedFold
      panel={DETAILS_FOLD}
      hint={advancedHint(details)}
      classes={CLASSES}
      testid="assets-details-advanced"
    >
      {rows.map((r) => (
        <div key={r.id} className="lp-dt-arow" data-testid={`assets-details-adv-${r.id}`}>
          <span className="lp-dt-ak">{r.k}</span>
          <span className="lp-dt-av">
            {r.values.map((v) => (
              <span key={v}>{v}</span>
            ))}
          </span>
          {r.copy ? (
            <CopyChip text={r.values.join('\n')} testid={`assets-details-copy-${r.id}`} />
          ) : null}
        </div>
      ))}
      {command ? (
        <div className="lp-dt-cmd" data-testid="assets-details-command">
          <span className="lp-dt-cmd-h">Import the same way from Terminal</span>
          <span className="lp-dt-cmd-l">
            <span className="lp-dt-av">{command}</span>
            <CopyChip text={command} testid="assets-details-copy-command" />
          </span>
        </div>
      ) : null}
    </AdvancedFold>
  );
}
