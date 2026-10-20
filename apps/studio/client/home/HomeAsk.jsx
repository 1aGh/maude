// client/home/HomeAsk.jsx — Home's question (S6.4, 01 cf-home-prompt · 05 es-home-* · 11 pn-home).
//
// "What shall we make?" in the rounded face at --type-3xl, one sentence, the target chip, the starters
// and "Start with an empty canvas ⌘N" — the way in without AI (`rule/a-way-in-without-ai`). ↵ sends; the
// sentence leaves as an INTENT parked in Rust, never in a URL (home-app.jsx `askIn`). Once the question has
// scrolled away it never shrinks: a slim bar keeps the same field, chip and empty-canvas door on top
// (11 pn-home). Offline the AI is not on offer ("AI is back when this Mac is online."), the empty canvas is.

import { useCallback, useEffect, useRef, useState } from 'react';

import { HIcon, HSpark } from './home-icons.jsx';
import { Starters } from './Starters.jsx';
import { TargetChip } from './TargetChip.jsx';

const PLACEHOLDER = 'A calm landing page, light and airy';

function useCondensed(ref) {
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      ([e]) => setCondensed(!e.isIntersecting && e.boundingClientRect.top < 0),
      {
        threshold: 0,
      }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return condensed;
}

/**
 * @param {{
 *   choices: object[], targetKey: string, onTarget: (key: string) => void,
 *   starters: object[], online: boolean, native: boolean, busy: boolean,
 *   onSend: (text: string) => Promise<unknown>|unknown, onEmpty: () => void,
 *   onBrand: (starter: object) => void, inputRef?: import('react').RefObject<HTMLTextAreaElement>,
 *   below?: import('react').ReactNode,
 * }} props
 */
export function HomeAsk({
  choices,
  targetKey,
  onTarget,
  starters,
  online,
  native,
  busy,
  onSend,
  onEmpty,
  onBrand,
  inputRef,
  below = null,
}) {
  const [prompt, setPrompt] = useState('');
  const own = useRef(null);
  const field = inputRef ?? own;
  const block = useRef(null);
  const condensed = useCondensed(block);
  const canSend = native && online && !busy && prompt.trim().length > 0;

  const send = useCallback(() => {
    const text = prompt.trim();
    if (!text || !native || !online || busy) return;
    onSend(text);
  }, [prompt, native, online, busy, onSend]);

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing) return;
    e.preventDefault();
    send();
  };

  // the field grows with a longer sentence (to four lines), never shrinks the question
  // biome-ignore lint/correctness/useExhaustiveDependencies: `prompt` is the trigger — the field is re-measured when its text changes
  useEffect(() => {
    const el = field.current;
    if (!el?.style) return;
    el.style.height = 'auto';
    if (el.scrollHeight) el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [prompt, field]);

  const pick = (s) => {
    if (s.intent) {
      onBrand(s);
      return;
    }
    setPrompt(s.prompt);
    field.current?.focus();
  };

  const sendButton = (testid) => (
    <button
      type="button"
      className={`home-ask-send${busy ? ' home-ask-send--busy' : ''}`}
      data-testid={testid}
      aria-label="Send"
      disabled={!canSend}
      onClick={send}
    >
      <HSpark size={14} />
    </button>
  );

  return (
    <div className="home-ask" data-slot="home-ask">
      <div className="home-question" ref={block}>
        <span className={`home-ask-spark${busy ? ' home-ask-spark--busy' : ''}`} aria-hidden="true">
          <HSpark size={48} />
        </span>
        <p className="home-question-t">What shall we make?</p>
        <p className="home-question-sub">
          Describe it in a sentence. AI puts a first draft on a new canvas — you take it from there.
        </p>
        <div className="island home-ask-card">
          <div className="home-ask-field">
            <textarea
              ref={field}
              rows={1}
              className="home-ask-input"
              data-testid="home-ask-input"
              aria-label="What shall we make?"
              placeholder={PLACEHOLDER}
              value={prompt}
              maxLength={4000}
              spellCheck
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {sendButton('home-ask-send')}
          </div>
          <div className="home-ask-foot">
            <TargetChip
              choices={choices}
              value={targetKey}
              onChange={onTarget}
              disabled={!native}
            />
            {online ? (
              <span className="home-ask-hint">
                <kbd className="kbd">↵</kbd> to send
              </span>
            ) : (
              <span
                className="home-ask-hint home-ask-hint--off"
                data-testid="home-ask-offline"
                role="status"
              >
                <HIcon name="offline" size={13} />
                AI is back when this Mac is online.
              </span>
            )}
          </div>
        </div>
        <Starters starters={starters} onPick={pick} />
        <button
          type="button"
          className="btn btn--ghost btn--sm home-empty-canvas"
          data-testid="home-empty-canvas"
          disabled={!native}
          onClick={onEmpty}
        >
          Start with an empty canvas <kbd className="kbd">⌘N</kbd>
        </button>
        {/* S6.8: the sign-in card and the What's New line (home-app passes them as `below`) */}
        <div className="home-below" data-slot="home-below">
          {below}
        </div>
      </div>

      {condensed ? (
        <div className="home-askbar-wrap">
          <div className="island home-askbar" data-testid="home-askbar">
            <span className="home-askbar-spark" aria-hidden="true">
              <HSpark size={16} />
            </span>
            <input
              className="home-askbar-input"
              data-testid="home-askbar-input"
              aria-label="Ask AI for a new canvas"
              placeholder="Ask AI for a new canvas…"
              value={prompt}
              maxLength={4000}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <TargetChip
              choices={choices}
              value={targetKey}
              onChange={onTarget}
              variant="bar"
              disabled={!native}
            />
            {sendButton('home-askbar-send')}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm home-empty-canvas"
            data-testid="home-askbar-empty"
            disabled={!native}
            onClick={onEmpty}
          >
            Start with an empty canvas <kbd className="kbd">⌘N</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}
