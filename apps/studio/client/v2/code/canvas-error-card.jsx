// client/v2/code/canvas-error-card.jsx — S11.7 (06 `ad-edge-syntax`) + S6.12 (01 `cf-render-error`): the ONE
// card for a canvas that can't be drawn, whichever way it broke.
//
//   <CanvasErrorCard canvas kind: 'syntax' | 'render' error lastGood? onAskAi onOpenInEditor? onGoBack?
//                    onReload? />
//
// `syntax`  someone edited the code (an editor, git, the AI) and left it unfinished — S11 mounts it from
//           the viewport's load-failure slot; the error is read from the server (`useCanvasError`).
// `render`  the code compiles and then throws while drawing — S6.12 mounts it from the render signal and
//           passes `lastGood` ("Last good version · 6 Oct, 14:05") and `onGoBack` (`history.go-back`).
//
// Everyone gets the same three things up front — what happened, that nothing is lost, ONE way out. The
// technical part (the error, the exact line with a caret, Open in editor, Copy error, Last good version,
// Reload canvas) sits in the "Show details" fold, the only place mono appears.
//
// The error text is untrusted (it quotes a file anyone could have written): every string is drawn as a
// React text node and handed to the clipboard / the composer as plain text. "Ask AI to fix it" PRE-FILLS
// the AI chat composer through `onAskAi` and never sends.

import { useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { Check, Copy, Spark } from '../ai/icons.jsx';
import { projectRel } from '../shell/native-doors.js';
import { registerErrorCard } from './code-bus.js';
import {
  askAiText,
  canvasTitle,
  errorText,
  excerptOf,
  goBackToLastGood,
  useCanvasError,
  useCanvasSource,
  whereLabel,
} from './use-canvas-source.js';

const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14:05" (24 hour, local). */
export function clockLabel(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "6 Oct, 14:05" — CONTRACT §4's absolute time. */
export function whenLabel(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getDate()} ${MONTHS[d.getMonth()]}, ${clockLabel(at)}`;
}

/** The card's sentence under the title. */
export function cardBody({ kind, error, lastGood }) {
  const tail = 'Other canvases are fine; the last good version is in Version history.';
  if (kind === 'render') {
    const when = lastGood ? whenLabel(lastGood.at) : '';
    return when
      ? `The last change has a mistake the canvas can't show. Behind this card is the last good version, from ${when} — nothing is lost, and every version stays in Version history.`
      : "The last change has a mistake the canvas can't show. Nothing is lost; every version stays in Version history.";
  }
  if (error?.line) return `Its code stops halfway on line ${error.line}. ${tail}`;
  // the load gave up and the server knows of no mistake in the code: say that, not a guess about it
  if (!error)
    return "It didn't finish loading. Nothing is lost. Reload the canvas, or ask AI to look.";
  return `Its code has a mistake the canvas can't show. ${tail}`;
}

/** Copy `text` to the clipboard; resolves to whether it landed. */
async function writeClipboard(text, nav = globalThis.navigator) {
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A button that says "Copied" for a moment after it copied. */
function CopyButton({
  text,
  label,
  copiedLabel = 'Copied',
  testid,
  onCopy,
  className = 'btn btn--sm',
  iconOnly = false,
}) {
  const [done, setDone] = useState(false);
  const run = async () => {
    const ok = await (onCopy ?? writeClipboard)(text);
    if (ok === false) return;
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      type="button"
      className={iconOnly ? 'icon-btn k-icon-sm' : className}
      data-testid={testid}
      aria-label={iconOnly ? (done ? copiedLabel : label) : undefined}
      title={iconOnly ? label : undefined}
      onClick={run}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {iconOnly ? null : done ? copiedLabel : label}
    </button>
  );
}

/** Lines around the error, the bad one marked, a caret under the column. */
export function ErrorExcerpt({ excerpt }) {
  if (!excerpt) return null;
  return (
    <div className="v2-err-snip" data-testid="canvas-error-excerpt">
      {excerpt.rows.map((r) => [
        <span key={r.n} className={`v2-err-snip-row${r.bad ? ' is-bad' : ''}`}>
          <span className="v2-err-snip-n">{r.n}</span>
          <span className="v2-err-snip-t">{r.text}</span>
        </span>,
        r.caret !== null ? (
          <span key={`${r.n}^`} className="v2-err-snip-row is-caret" aria-hidden="true">
            <span className="v2-err-snip-n" />
            <span className="v2-err-snip-t">{r.caret}</span>
          </span>
        ) : null,
      ])}
    </div>
  );
}

export function CanvasErrorCard({
  canvas,
  kind = 'syntax',
  error = null,
  lines = null,
  lastGood = null,
  onAskAi,
  onOpenInEditor,
  onGoBack,
  onReload,
  onCopy,
  askAiAvailable = true,
  /** The fold starts open (a test / a caller that wants the details up front). */
  detailsOpen = false,
}) {
  const [open, setOpen] = useState(detailsOpen);
  const name = canvasTitle(canvas);
  const where = whereLabel(error);
  const excerpt = excerptOf(error, lines);
  const clock = lastGood ? clockLabel(lastGood.at) : '';
  const primaryBack = kind === 'render' && lastGood && onGoBack;
  // The registry's three card actions (canvas.copy-error · canvas.ask-ai-fix · canvas.last-good) reach the
  // card that is showing through the bus; a ref keeps the newest props without re-registering.
  const live = useRef({});
  live.current = { canvas, kind, error, lastGood, onAskAi, onGoBack, onCopy, askAiAvailable };
  useEffect(
    () =>
      registerErrorCard({
        copy: () => {
          const c = live.current;
          if (c.error) (c.onCopy ?? writeClipboard)(errorText(c.error));
        },
        'ask-ai': () => {
          const c = live.current;
          if (c.askAiAvailable && c.onAskAi)
            c.onAskAi(askAiText({ canvas: c.canvas, error: c.error, kind: c.kind }));
        },
        'last-good': () => {
          const c = live.current;
          c.onGoBack?.(c.lastGood);
        },
      }),
    []
  );
  return (
    <section
      className="v2-err"
      aria-labelledby="v2-err-title"
      data-testid="canvas-error-card"
      data-kind={kind}
    >
      <header className="v2-err-hd">
        <span className="v2-err-ic" aria-hidden="true">
          <StIcon name="problem" size={20} />
        </span>
        <h2 className="v2-err-t" id="v2-err-title" data-testid="canvas-error-title">
          {name} can't be drawn right now.
        </h2>
      </header>
      <p className="v2-err-d" data-testid="canvas-error-body">
        {cardBody({ kind, error, lastGood })}
      </p>
      {lastGood ? (
        <p className="v2-err-lg" data-testid="canvas-error-last-good-line">
          Last good version · {whenLabel(lastGood.at)}
        </p>
      ) : null}
      <div className="v2-err-acts">
        {primaryBack ? (
          <button
            type="button"
            className="btn btn--primary"
            data-testid="canvas-error-go-back"
            onClick={() => onGoBack(lastGood)}
          >
            {clock ? `Go back to ${clock}` : 'Go back'}
          </button>
        ) : null}
        {askAiAvailable && onAskAi ? (
          <button
            type="button"
            className="btn btn--sm btn--spark"
            data-testid="canvas-error-ask-ai"
            onClick={() => onAskAi(askAiText({ canvas, error, kind }))}
          >
            <Spark size={10} />
            Ask AI to fix it
          </button>
        ) : null}
      </div>
      <AdvancedFold panel="canvas-error" open={open} onToggle={() => setOpen((v) => !v)}>
        {error ? (
          <>
            <div className="v2-err-row">
              <span className="v2-err-k">Error</span>
              <span className="v2-err-v" data-testid="canvas-error-message">
                {error.message}
              </span>
            </div>
            {where ? (
              <div className="v2-err-row">
                <span className="v2-err-k">Where</span>
                <span className="v2-err-v" data-testid="canvas-error-where">
                  {where}
                </span>
                <CopyButton
                  text={where}
                  label="Copy"
                  testid="canvas-error-copy-where"
                  onCopy={onCopy}
                  iconOnly
                />
              </div>
            ) : null}
            <ErrorExcerpt excerpt={excerpt} />
          </>
        ) : (
          <p className="v2-err-none" data-testid="canvas-error-none">
            No details were reported. Reload the canvas, or ask AI to look.
          </p>
        )}
        <div className="v2-err-acts v2-err-acts--row">
          {onOpenInEditor ? (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="canvas-error-open-editor"
              onClick={() => onOpenInEditor()}
            >
              <StIcon name="pen" size={12} />
              Open in editor
            </button>
          ) : null}
          {error ? (
            <CopyButton
              text={errorText(error)}
              label="Copy error"
              testid="canvas-error-copy"
              onCopy={onCopy}
              className="btn btn--ghost btn--sm"
            />
          ) : null}
          {onGoBack && !primaryBack ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="canvas-error-last-good"
              onClick={() => onGoBack(lastGood)}
            >
              <StIcon name="reload" size={12} />
              Last good version
            </button>
          ) : null}
          {onReload ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="canvas-load-retry"
              onClick={() => onReload()}
            >
              Reload canvas
            </button>
          ) : null}
        </div>
      </AdvancedFold>
    </section>
  );
}

/**
 * The viewport's load-failure slot (S11.7): the canvas didn't finish loading, so ask the server what is
 * wrong with its code and draw the card. Nothing here assumes a mistake — with no error on record the card
 * says "It didn't finish loading" and keeps Reload canvas under the fold.
 *
 * `askAiAvailable` / `canEdit` are the shell's answers (AI chat is the desktop app's; Go back writes a
 * version, so it is for people who may edit); the server enforces both regardless.
 */
export function CanvasLoadFailure({
  canvas,
  designRel = '.design',
  doors = null,
  canEdit = true,
  askAiAvailable = false,
  onAskAi,
  onReload,
  onNotify,
  onCopy,
  fetchImpl,
}) {
  const err = useCanvasError({ canvas, fetchImpl });
  const error = err.status === 'ok' ? err.error : null;
  // Context lines come from the source — for people who may read it (Can view gets the one quoted line).
  const src = useCanvasSource({ canvas, enabled: !!error?.line, fetchImpl });
  const lines = src.status === 'ok' ? src.lines : null;

  const goBack = async () => {
    const r = await goBackToLastGood(canvas, { fetchImpl });
    onNotify?.(r.line, r.ok);
    if (r.ok) onReload?.();
  };
  const openInEditor = doors?.available
    ? async () => {
        const r = await doors.openInEditor(projectRel(designRel, canvas));
        if (!r.ok)
          onNotify?.(r.error ?? "Couldn't open the editor. The file is where it was.", false);
      }
    : undefined;

  if (err.status === 'loading') {
    return (
      <p className="v2-err v2-err--wait" role="status" data-testid="canvas-error-wait">
        Checking {canvasTitle(canvas)}…
      </p>
    );
  }
  return (
    <CanvasErrorCard
      canvas={canvas}
      kind="syntax"
      error={error}
      lines={lines}
      askAiAvailable={askAiAvailable}
      onAskAi={onAskAi}
      onOpenInEditor={openInEditor}
      onGoBack={canEdit ? goBack : undefined}
      onReload={onReload}
      onCopy={onCopy}
    />
  );
}
