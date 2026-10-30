// client/v2/ai/ChoiceCard.jsx — S5.13 (03 `ai-choice-fail`, left): AI asks a question when it cannot guess.
// Choices, not essays: the picks are rows and a row IS the answer; "Something else…" opens a field and Enter
// sends what was typed. 03 draws no Skip and no Send (S5.17b G7), so Esc is the way to decline — the same key
// every other card of the panel uses.
//
// This card draws the common shape — ONE single-select question. Everything else (several questions, a
// multi-select, free text, a credential-shaped ask) is the v1 form, ElicitationPrompt, whose masking and
// wizard are security-reviewed: `choiceModel` returns null for those and the caller renders it unchanged.
// The v1 hooks stay (`chat-elicit-prompt`, `chat-elicit-option-<id>-<i>`, `-other`, `chat-elicit-custom-<id>`);
// `chat-elicit-skip` / `chat-elicit-submit` remain on the v1 form this card falls back to.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { choiceAnswer, choiceModel, swatchOf } from './needs-you.js';

export { choiceModel };

/** The 18 px disc in front of a row: the colour the option names (a hex in its label or hint), else nothing. */
function Swatch({ option }) {
  const hex = swatchOf(option);
  return hex ? (
    <span
      className="ai-nc-sw"
      style={{ background: hex }}
      aria-hidden="true"
      data-testid="ai-choice-swatch"
    />
  ) : null;
}

/**
 * `settled` (S5.18 G6, 03 `picked`): the card AFTER it was answered — the same question and rows, read only, the
 * picked one marked. `picked` is the label the person chose (or what they typed under "Something else…").
 * `onRespond(answer, { picked })` — the second argument names the pick so the slot can keep the card.
 */
export default function ChoiceCard({
  request,
  onRespond,
  model: given,
  settled = false,
  picked = null,
}) {
  const ref = useRef(null);
  const model = useMemo(() => given ?? choiceModel(request), [given, request]);
  const [other, setOther] = useState(false); // the "Something else…" field is open
  const [text, setText] = useState('');

  useEffect(() => {
    setOther(false);
    setText('');
    if (!settled) ref.current?.focus();
  }, [request?.id, settled]);

  if (!model) return null;
  const sendCustom = () => {
    if (text.trim() === '') return;
    onRespond(choiceAnswer(model, { custom: text }), { picked: text.trim() });
  };
  if (settled) {
    const hit = model.options.some((o) => o.label === picked);
    return (
      // biome-ignore lint/a11y/useSemanticElements: an inline card of answer rows in the chat, not a form fieldset
      <div
        className="ai-nc ai-nc-choice ai-nc-choice--settled"
        role="group"
        aria-label="AI asked a question — answered"
        data-testid="ai-choice-settled"
      >
        <p className="ai-nc-t">
          <span className="ai-nc-ic ai-nc-ic--ask" aria-hidden="true">
            <StIcon name="help" size={14} />
          </span>
          <span className="ai-nc-tt">{model.question}</span>
        </p>
        <div className="ai-nc-opts">
          {model.options.map((o) => (
            <span
              key={o.value}
              className="ai-nc-opt"
              aria-current={o.label === picked ? 'true' : undefined}
            >
              <Swatch option={o} />
              <span className="ai-nc-opt-t">
                {o.label}
                {o.hint ? <span className="ai-nc-opt-h">{o.hint}</span> : null}
              </span>
            </span>
          ))}
          {model.otherFieldId ? (
            <span
              className="ai-nc-opt ai-nc-opt--other"
              aria-current={picked && !hit ? 'true' : undefined}
            >
              <span className="ai-nc-sw ai-nc-sw--none" aria-hidden="true">
                <StIcon name="pen" size={12} />
              </span>
              <span className="ai-nc-opt-t">{picked && !hit ? picked : 'Something else…'}</span>
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an inline card of answer buttons in the chat, not a form fieldset (it would bring its own border and legend)
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
        } else if (e.key === 'Enter' && other && e.target.tagName === 'INPUT') {
          e.preventDefault();
          sendCustom();
        }
      }}
    >
      <p className="ai-nc-t">
        <span className="ai-nc-ic ai-nc-ic--ask" aria-hidden="true">
          <StIcon name="help" size={14} />
        </span>
        <span className="ai-nc-tt" data-testid="ai-choice-question">
          {model.question}
        </span>
      </p>
      <div className="ai-nc-opts">
        {model.options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            className="ai-nc-opt"
            data-testid={`chat-elicit-option-${model.questionId}-${i}`}
            onClick={() => onRespond(choiceAnswer(model, { value: o.value }), { picked: o.label })}
          >
            <Swatch option={o} />
            <span className="ai-nc-opt-t">
              {o.label}
              {o.hint ? <span className="ai-nc-opt-h">{o.hint}</span> : null}
            </span>
          </button>
        ))}
        {model.otherFieldId ? (
          <button
            type="button"
            className="ai-nc-opt ai-nc-opt--other"
            aria-expanded={other}
            data-testid={`chat-elicit-option-${model.questionId}-other`}
            onClick={() => setOther(true)}
          >
            <span className="ai-nc-sw ai-nc-sw--none" aria-hidden="true">
              <StIcon name="pen" size={12} />
            </span>
            <span className="ai-nc-opt-t">Something else…</span>
          </button>
        ) : null}
      </div>
      {other ? (
        <input
          type="text"
          className="ai-nc-input"
          // biome-ignore lint/a11y/noAutofocus: the field appears only when the person picks "Something else…", so focus follows their own click
          autoFocus
          placeholder="Type your own answer, then press Enter"
          aria-label="Your own answer"
          value={text}
          data-testid={`chat-elicit-custom-${model.questionId}`}
          onChange={(e) => setText(e.target.value)}
        />
      ) : null}
    </div>
  );
}
