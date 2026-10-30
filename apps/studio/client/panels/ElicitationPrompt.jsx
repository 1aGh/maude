// The inline form-elicitation card (feature-acp-ask-user-question) — renders
// whatever `requestedSchema.properties` the agent actually sent, generically
// (works for both AskUserQuestion's `question_N`/`question_N_custom` fields
// and any other well-formed elicitation form an MCP server sends over the SAME
// wire mechanism — see the plan's Research section). Same card-slot/focus-trap
// shape as PermissionPrompt.jsx, but a different renderer: PermissionPrompt
// renders a flat `options[]`; this renders a JSON-Schema-driven form.
//
// Multiple questions render as a one-at-a-time wizard (Back/Next), not
// stacked vertically — dogfooding found a wall of stacked question groups
// hard to scan; the CLI's own AskUserQuestion picker is one question at a
// time too.

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildElicitationContent,
  looksLikeSecretRequest,
  parseElicitationSchema,
} from './acp-elicitation.js';

// The exact literal `askUserQuestionsToCreateRequest` falls back to as the
// card `message` whenever an AskUserQuestion call carries more than one
// question (confirmed on disk against the installed adapter source) — never
// meaningful content, just "there's more than one question below."
const GENERIC_MULTI_QUESTION_MESSAGE = 'Please answer the following questions.';

function isAnswered(q, answers) {
  const custom = q.customFieldId ? answers[q.customFieldId] : undefined;
  if (typeof custom === 'string' && custom.trim() !== '') return true;
  if (q.kind === 'multi') return Array.isArray(answers[q.id]) && answers[q.id].length > 0;
  return typeof answers[q.id] === 'string' && answers[q.id] !== '';
}

function Question({
  q,
  answers,
  setAnswer,
  customOpen,
  onChooseOption,
  onChooseOther,
  onToggleCustom,
  groupName,
  cardSecretShaped,
}) {
  // SECURITY (ethical-hacker finding) — Maude only ever declares the `form`
  // elicitation capability, never `url` (DDR-180's Open decisions), which
  // makes this free-text box the ONLY channel any connected MCP server can
  // ever use to ask for a real credential — the MCP spec's own guidance is
  // that url-mode exists specifically so a genuine secret request never has
  // to pass through here at all. This doesn't block anything; it just makes a
  // credential-shaped ask LOOK like one (masked input + a visible warning),
  // the same pause a real password field gives a user, instead of rendering
  // identically to "which color do you like?".
  const secretShaped = cardSecretShaped || q.secretShaped;
  // `title` (AskUserQuestion's `header` — a short ≤12-char chip like "Barva")
  // and `description` (the full question text, only carried per-field once a
  // call has more than one question — a single-question call puts the full
  // text in the card's own `message` instead) are BOTH real, independent
  // pieces of the schema — a single `title || description` fallback was
  // silently dropping the actual question text whenever a header existed
  // (dogfooding finding: legends showed only short chips like "Barva"/
  // "Projekty"/"Styl" with no visible question). Show both when present.
  return (
    <fieldset className="chat-elicit-question" data-testid={`chat-elicit-question-${q.id}`}>
      {q.title || q.description ? (
        <legend className="chat-elicit-question-hd">
          {q.title ? <span className="chat-elicit-question-chip">{q.title}</span> : null}
          {q.description || null}
        </legend>
      ) : null}
      {q.kind === 'single' ? (
        <div className="chat-elicit-options">
          {q.options.map((o, i) => (
            <label
              key={o.value}
              className="chat-elicit-option"
              data-testid={`chat-elicit-option-${q.id}-${i}`}
            >
              <input
                type="radio"
                name={groupName}
                checked={!customOpen && answers[q.id] === o.value}
                onChange={() => onChooseOption(o.value)}
              />
              <span className="chat-elicit-option-body">
                <span>
                  {o.label}
                  {o.description ? (
                    <span className="chat-elicit-option-desc"> — {o.description}</span>
                  ) : null}
                </span>
                {o.preview ? <pre className="chat-elicit-option-preview">{o.preview}</pre> : null}
              </span>
            </label>
          ))}
          {/* "Other" rides IN the radio group, not a separate hidden toggle
              link below it — dogfooding found the link easy to miss entirely
              (image: a muted collapsed box read as inert, not clickable) AND
              found the OLD design (link + still-checked radio) actively
              confusing: the picked radio stayed visually selected while
              typing, implying both would be sent when only the custom text
              was. A real radio, in the SAME mutually-exclusive group, makes
              the actual either/or truth (one field, one answer — a real
              adapter constraint, not a UI choice) visible for free: picking
              a real option or "Other" naturally un-picks the other. */}
          {q.customFieldId ? (
            <label
              className="chat-elicit-option chat-elicit-option--other"
              data-testid={`chat-elicit-option-${q.id}-other`}
            >
              <input type="radio" name={groupName} checked={customOpen} onChange={onChooseOther} />
              <span className="chat-elicit-option-body">
                <span>Other — type your own answer</span>
              </span>
            </label>
          ) : null}
          {q.customFieldId && customOpen ? (
            <input
              type={secretShaped ? 'password' : 'text'}
              className="chat-elicit-text chat-elicit-custom chat-elicit-custom--inline"
              placeholder="Type your own answer…"
              autoFocus
              value={answers[q.customFieldId] || ''}
              onChange={(e) => setAnswer(q.customFieldId, e.target.value)}
              data-testid={`chat-elicit-custom-${q.id}`}
            />
          ) : null}
        </div>
      ) : null}
      {q.kind === 'multi' ? (
        <div className="chat-elicit-options">
          {q.options.map((o, i) => {
            const selected = Array.isArray(answers[q.id]) ? answers[q.id] : [];
            return (
              <label
                key={o.value}
                className="chat-elicit-option"
                data-testid={`chat-elicit-option-${q.id}-${i}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={(e) =>
                    setAnswer(
                      q.id,
                      e.target.checked
                        ? [...selected, o.value]
                        : selected.filter((v) => v !== o.value)
                    )
                  }
                />
                <span className="chat-elicit-option-body">
                  <span>
                    {o.label}
                    {o.description ? (
                      <span className="chat-elicit-option-desc"> — {o.description}</span>
                    ) : null}
                  </span>
                  {o.preview ? <pre className="chat-elicit-option-preview">{o.preview}</pre> : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      {q.kind === 'text' ? (
        <input
          type={secretShaped ? 'password' : 'text'}
          className="chat-elicit-text"
          value={answers[q.id] || ''}
          onChange={(e) => setAnswer(q.id, e.target.value)}
          data-testid={`chat-elicit-text-${q.id}`}
        />
      ) : null}
      {/* Multi-select keeps the collapsed-toggle shape (checkboxes aren't
          mutually exclusive, so there's no natural "Other" radio to fold
          into) — but it genuinely COMBINES rather than overrides (see
          buildElicitationContent), so the note explains that instead of
          warning about a replacement that isn't happening here. */}
      {q.kind === 'multi' && q.customFieldId ? (
        customOpen ? (
          <div className="chat-elicit-custom-wrap">
            <input
              type={secretShaped ? 'password' : 'text'}
              className="chat-elicit-text chat-elicit-custom"
              placeholder="Type your own answer…"
              autoFocus
              value={answers[q.customFieldId] || ''}
              onChange={(e) => setAnswer(q.customFieldId, e.target.value)}
            />
            <p className="chat-elicit-custom-note">Added to your selections above.</p>
          </div>
        ) : (
          <button type="button" className="chat-elicit-custom-toggle" onClick={onToggleCustom}>
            Add your own answer to your selections?
          </button>
        )
      ) : null}
      {secretShaped ? (
        <p className="chat-elicit-secret-warning" data-testid="chat-elicit-secret-warning">
          This looks like it's asking for a password, key, or other credential — Maude never needs
          your real ones here.
        </p>
      ) : null}
    </fieldset>
  );
}

export default function ElicitationPrompt({ request, onRespond }) {
  const cardRef = useRef(null);
  const questions = useMemo(() => parseElicitationSchema(request.requestedSchema), [request]);
  const [answers, setAnswers] = useState({});
  const [customOpenIds, setCustomOpenIds] = useState(() => new Set());
  const [step, setStep] = useState(0);
  const isWizard = questions.length > 1;

  useEffect(() => {
    setAnswers({});
    setCustomOpenIds(new Set());
    setStep(0);
  }, [request.id]);

  // Focus the card ONCE per request, on mount only — NOT on every answer
  // change. Dogfooding found every keystroke in a free-text field lost focus:
  // this used to live in the same effect as the keydown listener below, whose
  // deps included `answers`, so it re-ran (and re-called `.focus()` on the
  // outer card div) on every character typed, yanking focus off the input
  // mid-type. Splitting it out fixes that — the keydown listener still needs
  // fresh `canSubmit`/`answers` closures, but re-adding a listener doesn't
  // need to also steal focus.
  useEffect(() => {
    cardRef.current?.focus();
  }, [request.id]);

  const setAnswer = (id, value) => setAnswers((prev) => ({ ...prev, [id]: value }));
  const openCustom = (id) => setCustomOpenIds((prev) => new Set(prev).add(id));
  const closeCustom = (id) =>
    setCustomOpenIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  // Multi-select's collapsed toggle: closing it must also clear whatever was
  // typed — otherwise the text stays in `answers` invisibly and still gets
  // folded into the submitted content even though the field is hidden again
  // (the same class of stale-state bug `onChooseOption` below exists to close
  // for single-select).
  const toggleCustom = (id) => {
    if (customOpenIds.has(id)) {
      setAnswer(id, '');
      closeCustom(id);
    } else {
      openCustom(id);
    }
  };
  // Single-select's "Other" now rides in the radio group (see Question) —
  // picking a real option must clear any stale custom text so it can never
  // silently win at submit time (buildElicitationContent only checks
  // "is there non-empty custom text", not "is Other currently selected").
  // Picking "Other" clears the real pick the same way, for the same reason —
  // harmless since buildElicitationContent ignores `answers[q.id]` once
  // custom is non-empty, but keeps the two paths symmetric and correct even
  // before the user has typed anything into Other yet.
  const chooseOption = (q, value) => {
    setAnswers((prev) => ({
      ...prev,
      [q.id]: value,
      ...(q.customFieldId ? { [q.customFieldId]: '' } : {}),
    }));
    if (q.customFieldId) closeCustom(q.customFieldId);
  };
  const chooseOther = (q) => {
    setAnswer(q.id, '');
    openCustom(q.customFieldId);
  };

  const canSubmit = questions.filter((q) => q.required).every((q) => isAnswered(q, answers));
  const currentQuestion = isWizard ? questions[step] : null;
  const canAdvance =
    !currentQuestion || !currentQuestion.required || isAnswered(currentQuestion, answers);
  const isLastStep = !isWizard || step === questions.length - 1;

  const submit = () => {
    if (!canSubmit) return;
    onRespond({ action: 'accept', content: buildElicitationContent(questions, answers) });
  };
  const skip = () => onRespond({ action: 'decline' });
  const cancel = () => onRespond({ action: 'cancel' });
  const back = () => setStep((s) => Math.max(0, s - 1));
  const next = () => {
    if (!canAdvance) return;
    setStep((s) => Math.min(questions.length - 1, s + 1));
  };

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') {
        e.preventDefault();
        if (isLastStep) submit();
        else next();
      }
    }
    const el = cardRef.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, canSubmit, canAdvance, isLastStep, answers, step]);

  // SECURITY (ethical-hacker + security-auditor finding) — this same card
  // renders BOTH the built-in AskUserQuestion tool's questions AND any
  // connected MCP server's form elicitation (see DDR-180); the wire protocol
  // carries no field that reliably distinguishes which. Never brand this as
  // "from Claude" — that would misattribute an MCP-server-authored form
  // (potentially phishing-shaped free text) as trusted first-party chrome.
  // `toolCallId`, when present, ties this to a specific tool call the
  // transcript already rendered a card for just above — the honest,
  // independently-verifiable signal, instead of an unearned brand claim.
  const attribution = request.toolCallId
    ? 'Requested by the tool call above'
    : 'Requested by a connected tool (not tied to a visible step)';

  const visibleQuestions = isWizard ? (currentQuestion ? [currentQuestion] : []) : questions;
  // The card's own top-level `message` can itself read as a credential ask
  // (e.g. a single-question call whose only text is "Enter your API key") —
  // checked separately from each question's own title/description since a
  // single-question AskUserQuestion call puts the real text in `message`,
  // not in the per-field schema (see the showTopMessage comment below).
  const cardSecretShaped = looksLikeSecretRequest(request.message);

  // A multi-question AskUserQuestion call's top-level `message` is always the
  // SAME generic boilerplate string ("Please answer the following
  // questions." — askUserQuestionsToCreateRequest's literal fallback,
  // confirmed on disk); the real per-question text already renders inside
  // each step. Showing both stacked one above the other read as cluttered
  // ("vypadá dost ošklivě" dogfooding feedback) — skip the boilerplate line
  // and let the step counter carry that slot instead. A genuinely custom
  // top-level message (single-question calls, or a non-AskUserQuestion MCP
  // form) still gets its own prominent header line.
  const showTopMessage =
    !!request.message && (!isWizard || request.message !== GENERIC_MULTI_QUESTION_MESSAGE);

  return (
    <div
      className="chat-elicit"
      role="alertdialog"
      aria-label="Input requested"
      tabIndex={-1}
      ref={cardRef}
      data-testid="chat-elicit-prompt"
    >
      <div className="chat-elicit-hd">
        {showTopMessage ? <b>{request.message}</b> : null}
        <div className="chat-elicit-meta">
          {isWizard ? (
            <span data-testid="chat-elicit-step">
              Question {step + 1} of {questions.length}
            </span>
          ) : null}
          <span className="chat-elicit-attribution">{attribution}</span>
        </div>
      </div>
      {visibleQuestions.map((q) => (
        <Question
          key={q.id}
          q={q}
          answers={answers}
          setAnswer={setAnswer}
          customOpen={customOpenIds.has(q.customFieldId)}
          onChooseOption={(value) => chooseOption(q, value)}
          onChooseOther={() => chooseOther(q)}
          onToggleCustom={() => toggleCustom(q.customFieldId)}
          groupName={`elicit-${request.id}-${q.id}`}
          cardSecretShaped={cardSecretShaped}
        />
      ))}
      <div className="chat-elicit-actions">
        {isWizard && step > 0 ? (
          <button type="button" className="btn" onClick={back} data-testid="chat-elicit-back">
            Back
          </button>
        ) : null}
        {isLastStep ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSubmit}
            onClick={submit}
            data-testid="chat-elicit-submit"
          >
            Submit
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canAdvance}
            onClick={next}
            data-testid="chat-elicit-next"
          >
            Next
          </button>
        )}
        <span className="chat-elicit-actions-spacer" />
        <button
          type="button"
          className="btn"
          onClick={skip}
          title="Let Claude continue without an answer"
          data-testid="chat-elicit-skip"
        >
          Skip
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={cancel}
          title="Stop this question — the action it was part of is aborted too"
          data-testid="chat-elicit-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
