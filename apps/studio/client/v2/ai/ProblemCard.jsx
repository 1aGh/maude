// client/v2/ai/ProblemCard.jsx — S5.13 (03 `ai-choice-fail`, right): it says plainly when it cannot finish.
// What happened · what is safe · the one verb that fixes it (CONTRACT §4). A refusal that has no way out
// from here (a view-only role, a prompt the outbox could not keep) draws no button rather than a dead one.

import { StIcon } from '../../shell/icons.jsx';
import { problemModel } from './needs-you.js';

export default function ProblemCard({ error, onVerb }) {
  const problem = problemModel(error);
  if (!problem) return null;
  return (
    <div
      className="ai-nc ai-nc-prob"
      role="alert"
      data-testid="ai-problem-card"
      data-code={problem.code ?? 'turn'}
    >
      <p className="ai-nc-t">
        <span className="ai-nc-ic ai-nc-ic--prob" aria-hidden="true">
          <StIcon name="problem" size={14} />
        </span>
        <span className="ai-nc-tt" data-testid="ai-problem-title">
          {problem.title}
        </span>
      </p>
      {problem.detail ? <p className="ai-nc-d">{problem.detail}</p> : null}
      {problem.verb && onVerb ? (
        <span className="ai-nc-a">
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="ai-problem-verb"
            onClick={onVerb}
          >
            {problem.verb}
          </button>
        </span>
      ) : null}
    </div>
  );
}
