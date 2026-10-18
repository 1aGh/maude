// client/v2/ai/ChoiceCard.jsx — S5.13 (03 `ai-choice-fail`, left): AI asks a question when it cannot guess.
// Choices, not essays: the picks are rows (a radio each), "Something else…" opens a field, Send answers.
//
// This card draws the common shape — ONE single-select question. Everything else (several questions, a
// multi-select, free text, a credential-shaped ask) is the v1 form, ElicitationPrompt, whose masking and
// wizard are security-reviewed: `choiceModel` returns null for those and the caller renders it unchanged.
// The v1 hooks stay (`chat-elicit-prompt`, `chat-elicit-option-<id>-<i>` with its radio inside, `-other`,
// `chat-elicit-custom-<id>`, `chat-elicit-submit`, `chat-elicit-skip`): the desktop e2e picks an option and Sends.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Spark } from './icons.jsx';
import { choiceAnswer, choiceModel } from './needs-you.js';

export { choiceModel };

export default function ChoiceCard({ request, onRespond, model: given }) {
  const ref = useRef(null);
  const name = useId();
  const model = useMemo(() => given ?? choiceModel(request), [given, request]);
  const [picked, setPicked] = useState(null); // an option value, or 'other'
  const [text, setText] = useState('');

  useEffect(() => {
    setPicked(null);
    setText('');
    ref.current?.focus();
  }, [request.id]);

  if (!model) return null;
  const other = picked === 'other';
  const canSend = other ? text.trim() !== '' : picked !== null;
  const send = () => {
    if (!canSend) return;
    onRespond(
      other ? choiceAnswer(model, { custom: text }) : choiceAnswer(model, { value: picked })
    );
  };

  return (
    <div
      className="ai-nc ai-nc-choice"
      role="group"
      aria-label="AI asks a question"
      tabIndex={-1}
      ref={ref}
      data-testid="chat-elicit-prompt"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onRespond({ action: 'cancel' });
        } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && canSend) {
          e.preventDefault();
          send();
        }
      }}
    >
      <p className="ai-nc-t">
        <span className="ai-nc-ic ai-nc-ic--ask" aria-hidden="true">
          <Spark size={12} />
        </span>
        <span className="ai-nc-tt" data-testid="ai-choice-question">
          {model.question}
        </span>
      </p>
      <div className="ai-nc-opts" role="radiogroup" aria-label="Choices">
        {model.options.map((o, i) => (
          <label
            key={o.value}
            className="ai-nc-opt"
            aria-current={picked === o.value ? 'true' : undefined}
            data-testid={`chat-elicit-option-${model.questionId}-${i}`}
          >
            <input
              type="radio"
              name={name}
              checked={picked === o.value}
              onChange={() => setPicked(o.value)}
            />
            <span className="ai-nc-opt-t">
              {o.label}
              {o.hint ? <span className="ai-nc-opt-h">{o.hint}</span> : null}
            </span>
          </label>
        ))}
        {model.otherFieldId ? (
          <label
            className="ai-nc-opt ai-nc-opt--other"
            aria-current={other ? 'true' : undefined}
            data-testid={`chat-elicit-option-${model.questionId}-other`}
          >
            <input type="radio" name={name} checked={other} onChange={() => setPicked('other')} />
            <span className="ai-nc-opt-t">Something else…</span>
          </label>
        ) : null}
      </div>
      {other ? (
        <input
          type="text"
          className="ai-nc-input"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          placeholder="Type your own answer…"
          aria-label="Your own answer"
          value={text}
          data-testid={`chat-elicit-custom-${model.questionId}`}
          onChange={(e) => setText(e.target.value)}
        />
      ) : null}
      <span className="ai-nc-a">
        <button
          type="button"
          className="btn btn--sm"
          data-testid="chat-elicit-skip"
          onClick={() => onRespond({ action: 'decline' })}
        >
          Skip
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!canSend}
          data-testid="chat-elicit-submit"
          onClick={send}
        >
          Send
        </button>
      </span>
    </div>
  );
}
