// client/v2/ai/Result.jsx — S5.9 (03 AI Chat `ai-done`): the finish, then Undo or Keep going.
//
// The AI's message above says what changed ("Done — Post 1:1 is greener: background, badge and button.
// The logo stays white."). This card is what sits under it: Undo FIRST (it takes the whole change back),
// then the way on — Keep going · Compare · Keep the copy — then "What AI did · N steps · T" folded, then
// follow-up chips. The verb set is the run's shape (run-model.js `resultVerbs`).
//
// Presentational: RunSurface.jsx owns the run, the network and the status. `headline` is only drawn when
// the reply has no words of its own (a cut-short run, or a turn that only used tools).

import { StepsChevron, CompareGlyph, RedoGlyph, UndoGlyph, CheckGlyph } from './run-icons.jsx';
import { Spark } from './icons.jsx';

const VERB = {
  Undo: { id: 'ai-result-undo', icon: <UndoGlyph /> },
  'Keep going': { id: 'ai-result-keep-going', icon: <Spark size={10} /> },
  Compare: { id: 'ai-result-compare', icon: <CompareGlyph /> },
  'Keep the copy': { id: 'ai-result-keep-copy', icon: <CheckGlyph /> },
};

/**
 * @param {object} p
 * @param {string} [p.headline]       drawn as the AI's line when the reply has none
 * @param {string[]} p.verbs          from `resultVerbs`
 * @param {(verb:string)=>void} p.onVerb
 * @param {'idle'|'busy'|'undone'|'kept'} [p.status]
 * @param {string} [p.note]           the one line when a verb did not happen
 * @param {string[]} [p.steps]        what the run did, one title each
 * @param {string} [p.stepsLabel]     "What AI did · 6 steps · 41 s"
 * @param {string[]} [p.followUps]
 * @param {(text:string)=>void} [p.onFollowUp]
 */
export function ResultCard({
  headline,
  verbs,
  onVerb,
  status = 'idle',
  note,
  steps = [],
  stepsLabel,
  followUps = [],
  onFollowUp,
}) {
  const busy = status === 'busy';
  return (
    <div className="ai-result" data-testid="ai-result" data-status={status}>
      {headline ? <p className="ai-result-line">{headline}</p> : null}
      {status === 'undone' ? (
        <span className="ai-result-acts">
          <span className="ai-result-state" data-testid="ai-result-state">
            Undone.
          </span>
          <button
            type="button"
            className="chip ai-act"
            data-testid="ai-result-redo"
            onClick={() => onVerb('Redo')}
          >
            <RedoGlyph />
            Redo
          </button>
        </span>
      ) : status === 'kept' ? (
        <span className="ai-result-acts">
          <span className="ai-result-state" data-testid="ai-result-state">
            Kept the copy.
          </span>
        </span>
      ) : verbs.length ? (
        <span className="ai-result-acts">
          {verbs.map((verb) => (
            <button
              key={verb}
              type="button"
              className="chip ai-act"
              data-testid={VERB[verb]?.id}
              data-verb={verb}
              disabled={busy && verb === 'Undo'}
              aria-busy={busy && verb === 'Undo' ? 'true' : undefined}
              onClick={() => onVerb(verb)}
            >
              {VERB[verb]?.icon}
              {verb}
            </button>
          ))}
        </span>
      ) : null}
      {note ? (
        <p className="ai-result-note" role="status" data-testid="ai-result-note">
          {note}
        </p>
      ) : null}
      {steps.length ? (
        <details className="ai-fold" data-testid="ai-steps">
          <summary className="ai-fold-sum">
            <span className="ai-fold-ch">
              <StepsChevron />
            </span>
            {stepsLabel}
          </summary>
          <ol className="ai-fold-list">
            {steps.map((title, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a step has no id; the list never reorders
              <li key={i}>{title}</li>
            ))}
          </ol>
        </details>
      ) : null}
      {followUps.length && status === 'idle' ? (
        <span className="ai-followups" data-testid="ai-followups">
          {followUps.map((text) => (
            <button
              key={text}
              type="button"
              className="chip ai-followup"
              data-testid="ai-followup-chip"
              onClick={() => onFollowUp?.(text)}
            >
              <Spark size={10} />
              {text}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}
