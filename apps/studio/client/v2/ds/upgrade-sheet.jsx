// client/v2/ds/upgrade-sheet.jsx — S10.15b: "Bring <system> up to the schema?" (13 · ds-multi-schema).
//
// One dialog, four faces (upgrade-model.js `viewOf`): the four lines before the AI runs (primary "✦ Bring it
// up" starts it), a quiet "AI is bringing it up" while it works, a progress bar while the stage is checked (the
// check is slow — about a second per artboard and theme — so it says how far it is and Cancel stops it), and
// the review: the same four lines from the proof, "N canvases can't be updated yet", and a primary button that
// applies the stage as one action, one undo step.
//
// Sheet only: the host (upgrade-host.jsx) fetches the status and does every write. `onAsk()` / `onApply()`
// resolve to `{ ok: true }` or `{ ok: false, message }`; `onCancel()` stops a proof / puts a stage back and closes;
// `onClose()` (esc) just closes — the work goes on and the sheet finds it again.

import { useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { Spark } from '../ai/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  canvasCount,
  convertedWords,
  progressFraction,
  UPGRADE_WORDS,
  upgradeLead,
  upgradeTitle,
} from './upgrade-model.js';
import { reasonProps } from '../access/disabled-reason.js';

function Lines({ lines }) {
  return (
    <div className="dsu-lines" data-testid="ds-upgrade-lines">
      {lines.map((l) => (
        <span key={l.kind} className="dsu-line" data-kind={l.kind} data-testid="ds-upgrade-line">
          <Spark size={12} />
          <b>{l.title}</b>
          <span>{l.detail}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * @param {{
 *   label: string,
 *   view: ReturnType<typeof import('./upgrade-model.js').viewOf>,
 *   canvases: number,
 *   onAsk: () => Promise<{ ok: boolean, message?: string }>,
 *   onApply: () => Promise<{ ok: boolean, message?: string }>,
 *   onCancel: () => void,
 *   onClose: () => void,
 * }} props
 */
export function DsUpgradeSheet({ label, view, canvases, onAsk, onApply, onCancel, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError('');
    let res;
    try {
      res = await fn();
    } catch {
      res = { ok: false, message: UPGRADE_WORDS.failed };
    }
    setBusy(false);
    if (res?.ok === false) setError(res.message || UPGRADE_WORDS.failed);
  };

  const kind = view.kind;
  const canApply = kind === 'review' && !view.blocker && !busy;
  const fraction = kind === 'proving' ? progressFraction(view.current, view.total) : 0;

  return (
    <div className="dsr-scrim" data-testid="ds-upgrade-scrim">
      <div
        ref={ref}
        className="island dsr-dialog dsu-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-upgrade-title"
        tabIndex={-1}
        data-testid="ds-upgrade"
        data-view={kind}
      >
        <h2 id="ds-upgrade-title" className="dsr-title" data-testid="ds-upgrade-title">
          {upgradeTitle(label)}
        </h2>
        <div className="dsr-body">
          {kind === 'converted' ? (
            <p className="dsu-lead" data-testid="ds-upgrade-converted">
              {convertedWords(label)}
            </p>
          ) : (
            <p className="dsu-lead" data-testid="ds-upgrade-lead">
              {upgradeLead(label)}
            </p>
          )}

          {kind === 'ask' || kind === 'review' ? <Lines lines={view.lines} /> : null}

          {kind === 'review' && view.refused ? (
            <p
              className="dsu-note"
              data-tone="warn"
              data-testid="ds-upgrade-refused"
              title={view.refused.paths.join('\n')}
            >
              <StIcon name="problem" size={14} />
              {view.refused.text}
            </p>
          ) : null}

          {kind === 'working' ? (
            <p className="dsu-working" role="status" data-testid="ds-upgrade-working">
              <Spark size={14} />
              <span>
                <b>{UPGRADE_WORDS.working}</b>
                <em>{view.step === 'staged' ? UPGRADE_WORDS.staged : UPGRADE_WORDS.waiting}</em>
              </span>
            </p>
          ) : null}

          {kind === 'proving' ? (
            <div className="dsu-proving" data-testid="ds-upgrade-proving">
              <p className="dsu-working" role="status">
                <Spark size={14} />
                <span>
                  <b>Checking that nothing changes</b>
                  <em data-testid="ds-upgrade-progress-words">
                    {view.total > 0
                      ? `${view.current} of ${canvasCount(view.total)} checked, in every theme`
                      : 'Starting two quiet copies of the project'}
                  </em>
                </span>
              </p>
              <div
                className="dsu-bar"
                role="progressbar"
                aria-label="Checking the canvases"
                aria-valuemin={0}
                aria-valuemax={view.total}
                aria-valuenow={view.current}
                data-testid="ds-upgrade-progress"
                data-current={view.current}
                data-total={view.total}
              >
                <span
                  className="dsu-bar-fill"
                  style={{ width: `${Math.round(fraction * 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          {kind === 'review' && view.blocker ? (
            <p className="dsu-note" data-tone="warn" role="alert" data-testid="ds-upgrade-blocker">
              <StIcon name="problem" size={14} />
              {view.blocker}
            </p>
          ) : null}

          {kind === 'ask' && !view.canAsk ? (
            <p className="dsu-note" data-tone="warn" data-testid="ds-upgrade-no-ai">
              <StIcon name="problem" size={14} />
              {UPGRADE_WORDS.noAI}
            </p>
          ) : null}

          {kind === 'ask' ? (
            <p className="dsr-fine" data-testid="ds-upgrade-fine">
              {`Nothing on the ${canvasCount(canvases)} changes how it looks. ${UPGRADE_WORDS.fine}`}
            </p>
          ) : null}
          {kind === 'review' ? (
            <p className="dsr-fine" data-testid="ds-upgrade-fine">
              {`Every artboard was checked in every theme: nothing on the ${canvasCount(view.updated)} changes how it looks. One undo step takes it back.`}
            </p>
          ) : null}

          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-upgrade-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            disabled={busy && kind !== 'proving'}
            data-testid="ds-upgrade-cancel"
            onClick={kind === 'converted' ? onClose : onCancel}
          >
            {kind === 'converted' ? 'Close' : UPGRADE_WORDS.cancel}
          </button>
          {kind === 'converted' ? null : kind === 'ask' ? (
            <button
              ref={primaryRef}
              type="button"
              className="btn btn--primary"
              disabled={busy || !view.canAsk}
              data-testid="ds-upgrade-go"
              onClick={() => run(onAsk)}
            >
              {UPGRADE_WORDS.ask}
            </button>
          ) : (
            <button
              ref={primaryRef}
              type="button"
              className="btn btn--primary"
              disabled={!canApply}
              {...reasonProps(kind === 'review' && !!view.blocker, view.blocker)}
              data-testid="ds-upgrade-go"
              onClick={() => run(onApply)}
            >
              {UPGRADE_WORDS.go}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
