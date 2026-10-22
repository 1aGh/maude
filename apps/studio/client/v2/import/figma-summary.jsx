// client/v2/import/figma-summary.jsx — S8.17: the import summary (canvas 12 · ia-figma-arrived, ia-figjam).
//
// "Imported 6 frames from Uniformy-2027": one row per thing that came across and one per compromise, so the
// summary names every one (C24). Advanced holds the node ids and reason codes — code-owned strings, the same
// accounting the verb prints (DDR-216 D7/D10). Nothing here is text the Figma file said.

import { useState } from 'react';
import { reasonLines } from './figma-model.js';

const MARK = { ok: '✓', warn: '!', skip: '–' };

/**
 * @param {{ title: string, rows: Array<{tone:string,text:string}>, dispositions?: Array<object>, testid?: string,
 *   showTitle?: boolean }} props `showTitle` false: the card sits under a header that already says it (the
 *   title stays as its accessible name)
 */
export default function FigmaSummary({
  title,
  rows,
  dispositions = [],
  testid = 'figma-import-summary',
  showTitle = true,
}) {
  const [adv, setAdv] = useState(false);
  const lines = reasonLines(dispositions);
  return (
    <section className="fi-sum" data-testid={testid} aria-label={title}>
      {showTitle ? <strong className="fi-sum-t">{title}</strong> : null}
      <ul className="fi-sum-rows">
        {rows.map((r) => (
          <li key={r.text} className="fi-sum-row" data-tone={r.tone}>
            <span className={`fi-sum-m fi-sum-m--${r.tone}`} aria-hidden="true">
              {MARK[r.tone] ?? '·'}
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      {lines.length > 0 ? (
        <div className="fi-sum-adv">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-expanded={adv}
            onClick={() => setAdv(!adv)}
            data-testid="figma-summary-advanced"
          >
            Advanced · node ids · reason codes
          </button>
          {adv ? (
            <ul className="fi-sum-codes ia-mono" data-testid="figma-summary-codes">
              {lines.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a node can carry the same reason twice
                <li key={`${i}-${l}`}>{l}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
