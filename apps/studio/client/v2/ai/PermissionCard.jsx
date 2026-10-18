// client/v2/ai/PermissionCard.jsx — S5.13 (03 `ai-permission`): AI asks before it does something Claude Code
// asks about, and the question waits INLINE in the chat — never a modal, never a timeout while you are here
// (D7). The title verb is the button verb. "Always for this canvas" is the agent's own `allow_always` option
// and is not drawn when the agent did not offer one (D4: Maude keeps no grant store of its own).
//
// Lifted from panels/PermissionPrompt.jsx. The v1 hooks stay (`chat-permission-prompt`, `chat-perm-outside`,
// `chat-perm-paths`, `chat-perm-queue`, and `.btn--danger` on the decline button): the desktop e2e reads them,
// and a testid is an API. The decline button keeps the class but is drawn quiet (ai.css `.ai-nc-decline`).
// Kept from the v1 card: Enter answers with the once-only default (never the
// standing option unless the box is ticked), Esc declines, the out-of-project copy comes from the server's
// resolved paths (sanitised for display), +N more waiting is visible. The card takes focus once per request.

import { useEffect, useMemo, useRef, useState } from 'react';
import { permissionAnswer, permissionDecline, permissionModel } from './needs-you.js';
import { Check, Spark } from './icons.jsx';

function optionClass(kind) {
  if (kind === 'reject_once' || kind === 'reject_always') return 'btn btn--sm btn--danger';
  if (kind === 'allow_once') return 'btn btn--sm btn--primary';
  return 'btn btn--sm';
}

export default function PermissionCard({ request, onRespond, queueLength = 1 }) {
  const ref = useRef(null);
  const model = useMemo(() => permissionModel(request), [request]);
  const [always, setAlways] = useState(false);
  const alwaysRef = useRef(always);
  alwaysRef.current = always;

  useEffect(() => {
    setAlways(false);
  }, [request.id]);

  // Focus the card once per request, answer Enter / Esc from the card itself.
  useEffect(() => {
    ref.current?.focus();
    const el = ref.current;
    const onKey = (e) => {
      if (e.key === 'Enter' && e.target === el) {
        const id = permissionAnswer(model, alwaysRef.current);
        if (id) {
          e.preventDefault();
          onRespond(id);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onRespond(permissionDecline(model));
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const { outside } = model;

  return (
    // biome-ignore lint/a11y/useSemanticElements: an inline card of answer buttons in the chat, not a form fieldset
    <div
      className={`ai-nc ai-nc-perm${outside ? ' ai-nc-perm--outside' : ''}`}
      // A group, not a dialog: it sits in the chat and the rest of the app stays usable (never modal).
      role="group"
      aria-label={outside ? 'AI asks — a file outside this project' : 'AI asks first'}
      tabIndex={-1}
      ref={ref}
      data-testid="chat-permission-prompt"
      data-shape={model.shape}
    >
      <p className="ai-nc-t">
        <span className="ai-nc-ic ai-nc-ic--ask" aria-hidden="true">
          <Spark size={12} />
        </span>
        <span className="ai-nc-tt" data-testid="ai-permission-title">
          {model.title}
        </span>
        {queueLength > 1 ? (
          <span className="ai-nc-more" data-testid="chat-perm-queue">
            +{queueLength - 1} more waiting
          </span>
        ) : null}
      </p>

      {outside ? (
        <div className="ai-nc-d" data-testid="chat-perm-outside">
          <p>{outside.lead}</p>
          {outside.paths.length > 0 ? (
            <ul className="ai-nc-paths" data-testid="chat-perm-paths">
              {outside.paths.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {outside.scopeRoot ? (
            <p className="ai-nc-fine">
              {outside.inProjectDenied
                ? 'Git hooks and Claude settings can execute code later, so Maude asks even though they live inside this project.'
                : `This project is ${outside.scopeRoot}. Edits inside it never ask.`}
            </p>
          ) : null}
          <p className="ai-nc-fine">{outside.note}</p>
        </div>
      ) : model.detail ? (
        <p className="ai-nc-d" data-testid="ai-permission-detail">
          {model.detail}
        </p>
      ) : null}

      {model.shape === 'simple' ? (
        <span className="ai-nc-a">
          {model.always && !outside ? (
            <label className="ai-nc-check" data-testid="ai-permission-always">
              <input
                type="checkbox"
                checked={always}
                onChange={(e) => setAlways(e.target.checked)}
              />
              <span className="ai-nc-box" aria-hidden="true">
                {always ? <Check size={10} /> : null}
              </span>
              Always for this canvas
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn--sm btn--danger ai-nc-decline"
            data-testid="ai-permission-decline"
            onClick={() => onRespond(permissionDecline(model))}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            data-testid="ai-permission-allow"
            onClick={() => onRespond(permissionAnswer(model, always))}
          >
            {model.verb}
          </button>
        </span>
      ) : (
        // ExitPlanMode and any other multi-way set: every option the agent offered, as its own button.
        <span className="ai-nc-a ai-nc-a--options">
          {model.options.map((o) => (
            <button
              key={o.optionId}
              type="button"
              className={optionClass(o.kind)}
              data-testid="ai-permission-option"
              onClick={() => onRespond(o.optionId)}
            >
              {o.name}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
