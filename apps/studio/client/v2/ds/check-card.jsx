// client/v2/ds/check-card.jsx — S10.19: "Check the system" (13 · ds-advanced, the right-hand card).
//
//   Check the system                                              ran 1 min ago
//   ✓ Contrast        41 of 42 text pairs pass, Light and Dark
//   ! Quiet on Well   Dark: 4.2:1 — large text only                       [Show]
//   ✓ Complete        7 sections, both modes, reduced motion
//   ✓ Schema          Follows the schema — switches cleanly with any system that does
//   critic panel: a11y · completeness · keeper                    [Ask AI to review]
//
// Every row is computed on the server (ds/check-system.ts) from the system's files: this file draws what it is
// given. Labels in a row are the system's own text — shown, never obeyed. "Show" walks to the token on the Design
// system canvas; "Ask AI to review" fills the AI chat's composer and never sends.

import { Spark } from '../ai/icons.jsx';
import { StIcon } from '../../shell/icons.jsx';
import { ADVANCED_WORDS, checkRows, ranWords } from './advanced-model.js';

/**
 * @param {{ check: any, now?: number, onShow?: (css: string) => void, onAskAi?: () => void }} props
 */
export function CheckCard({ check, now, onShow, onAskAi }) {
  const rows = checkRows(check);
  if (!rows.length) return null;
  return (
    <section
      className="dsa-card dsa-check"
      data-testid="ds-check-card"
      aria-label={ADVANCED_WORDS.check}
    >
      <p className="dsa-card-title">
        {ADVANCED_WORDS.check}
        <span className="dsa-quiet" data-testid="ds-check-ran">
          {ranWords(check, now)}
        </span>
      </p>
      {rows.map((r, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the rows are a fixed answer, in order
          key={i}
          className="dsa-chk"
          data-testid={`ds-check-row-${i}`}
          data-ok={r.ok ? 'true' : 'false'}
          data-kind={r.id}
        >
          <span className={`dsa-chk-ic dsa-chk-ic--${r.ok ? 'ok' : 'warn'}`} aria-hidden="true">
            <StIcon name={r.ok ? 'check' : 'problem'} size={14} />
          </span>
          <b>{r.title}</b>
          <span className="dsa-chk-t">{r.text}</span>
          {r.show && onShow ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              data-testid={`ds-check-show-${i}`}
              onClick={() => onShow(r.show)}
            >
              {ADVANCED_WORDS.show}
            </button>
          ) : null}
        </span>
      ))}
      <span className="dsa-chk dsa-chk--adv">
        <span className="dsa-mono">{ADVANCED_WORDS.panel}</span>
        {onAskAi ? (
          <button
            type="button"
            className="btn btn--sm btn--spark"
            data-testid="ds-check-ask-ai"
            onClick={onAskAi}
          >
            <Spark size={10} />
            {ADVANCED_WORDS.askAi}
          </button>
        ) : null}
      </span>
    </section>
  );
}
