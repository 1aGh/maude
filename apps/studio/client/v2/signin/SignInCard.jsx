// client/v2/signin/SignInCard.jsx — the sign-in card: the welcome, folded into Home (02 Onboarding
// ob-first-launch · ob-signin-browser · ob-edge-offline · ob-edge-timeout · ob-adv-open; S6.8).
//
// Presentational and exported (S11.14's Settings › Connections and S9.20's "Move to cloud" reuse it): it
// holds no sign-in logic, only what to draw for a `mode` from signin-model.js `cardMode` and which
// callbacks to call. The words are the canvas's; the timeout line says "Nothing changed on this Mac."
//
//   idle     two doors, cloud first            offline  two doors, local first, the cloud one resting
//   waiting  "Waiting for your browser…"       timeout  one line, buttons live (Try again = the cloud door)
//            Cancel · Open the page again      failed   the same line with the cloud's own words
//            Signed in on another device? Use a code instead

import { useEffect, useRef } from 'react';

import { HIcon, HSpark } from '../../home/home-icons.jsx';
import { ADVANCED_FOOT, ADVANCED_ROWS } from './advanced-rows.js';
import { SIGNIN_WORDS as W } from './signin-model.js';

function Line({ kind, title, children, testid }) {
  return (
    <p
      className={`si-line${kind === 'warn' ? ' si-line--warn' : ''}`}
      role="status"
      data-testid={testid}
    >
      <span className="si-sw">
        <i aria-hidden="true" />
        {title}
      </span>
      <span>{children}</span>
    </p>
  );
}

/**
 * @param {{
 *   mode: 'idle'|'waiting'|'timeout'|'failed'|'offline',
 *   userCode?: string|null, showCode?: boolean, error?: string|null, note?: string|null,
 *   native?: boolean,
 *   onCloud: () => void, onLocal: () => void,
 *   onCancel?: () => void, onReopen?: () => void, onShowCode?: () => void,
 *   advancedOpen?: boolean, onToggleAdvanced?: () => void,
 *   onAdvanced?: (id: string) => void, advancedAvailable?: string[],
 * }} props
 */
export function SignInCard({
  mode,
  userCode = null,
  showCode = false,
  error = null,
  note = null,
  native = true,
  onCloud,
  onLocal,
  onCancel,
  onReopen,
  onShowCode,
  advancedOpen = false,
  onToggleAdvanced,
  onAdvanced,
  advancedAvailable = [],
}) {
  const offline = mode === 'offline';
  const waiting = mode === 'waiting';
  const toggle = useRef(null);

  // Escape closes the flyout and hands focus back to its button
  useEffect(() => {
    if (!advancedOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onToggleAdvanced?.();
      toggle.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [advancedOpen, onToggleAdvanced]);

  const cloud = (
    <button
      type="button"
      className={`btn btn--lg si-btn${offline ? ' si-btn-off' : ' btn--primary'}`}
      data-testid="signin-cloud"
      disabled={offline || !native}
      onClick={onCloud}
    >
      <HIcon name="cloud" size={16} />
      {W.cloud}
    </button>
  );
  const local = (
    <button
      type="button"
      className={`btn btn--lg si-btn${offline ? ' btn--primary' : ' si-btn-2'}`}
      data-testid="signin-local"
      disabled={!native}
      onClick={onLocal}
    >
      <HIcon name="laptop" size={16} />
      {W.local}
    </button>
  );

  return (
    <section className="si-door" aria-label="Sign in" data-testid="signin-card" data-state={mode}>
      <div className="si-hd">
        <span className="si-ic" aria-hidden="true">
          <HIcon name="cloud" size={18} />
        </span>
        <span className="si-txt">
          <strong>{W.title}</strong>
          <span>{W.sub}</span>
        </span>
      </div>

      {waiting ? (
        <>
          <div className="si-wait">
            <span className="si-wait-pill" role="status" data-testid="signin-waiting">
              <span className="si-sw si-sw--busy">
                <i aria-hidden="true" />
                {W.waiting}
              </span>
            </span>
            <button type="button" className="btn" data-testid="signin-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="si-link"
              data-testid="signin-reopen"
              onClick={onReopen}
              disabled={!userCode}
            >
              {W.again}
            </button>
          </div>
          {note ? (
            <p className="si-note" role="alert" data-testid="signin-note">
              {note}
            </p>
          ) : null}
          {showCode && userCode ? (
            <div className="si-code" data-testid="signin-code-box">
              <span>{W.codeLine}</span>
              <strong className="si-code-v" data-testid="signin-code">
                {userCode}
              </strong>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {mode === 'timeout' ? (
            <Line title={W.timeoutTitle} testid="signin-timeout">
              {W.timeoutBody}
            </Line>
          ) : null}
          {mode === 'failed' ? (
            <Line title="Couldn't start sign-in" testid="signin-failed">
              {error || W.unreachable}
            </Line>
          ) : null}
          {offline ? (
            <Line kind="warn" title={W.offlineTitle} testid="signin-offline">
              {W.offlineBody}
            </Line>
          ) : null}
          <div className="si-acts">
            {offline ? (
              <>
                {local}
                {cloud}
              </>
            ) : (
              <>
                {cloud}
                {local}
              </>
            )}
          </div>
        </>
      )}

      <div className="si-foot">
        {waiting ? (
          <span className="si-hint">
            {W.otherDevice}{' '}
            <button
              type="button"
              className="si-link"
              data-testid="signin-use-code"
              onClick={onShowCode}
              disabled={!userCode || showCode}
            >
              {W.useCode}
            </button>
          </span>
        ) : offline ? (
          <span className="si-hint">{W.offlineFoot}</span>
        ) : (
          <span className="si-hint">{W.hint}</span>
        )}
        {waiting ? null : (
          <button
            type="button"
            ref={toggle}
            className="si-adv"
            data-testid="signin-advanced"
            aria-expanded={advancedOpen}
            aria-controls="signin-advanced-menu"
            data-open={advancedOpen ? 'true' : undefined}
            onClick={onToggleAdvanced}
          >
            {W.advanced}
            <HIcon name="submenu" size={12} />
          </button>
        )}
      </div>

      {advancedOpen && !waiting ? (
        <div className="si-fly" id="signin-advanced-menu" data-testid="signin-advanced-menu">
          {ADVANCED_ROWS.map((r) => {
            const live = advancedAvailable.includes(r.id);
            return (
              <button
                type="button"
                className="row-item si-advrow"
                key={r.id}
                data-testid={`signin-adv-${r.id}`}
                aria-disabled={live ? undefined : 'true'}
                onClick={() => live && onAdvanced?.(r.id)}
              >
                <span className={`si-advrow-ic${r.icon === 'spark' ? ' si-advrow-ic--spark' : ''}`}>
                  {r.icon === 'spark' ? <HSpark size={14} /> : <HIcon name={r.icon} size={16} />}
                </span>
                <span className="si-advrow-txt">
                  <strong>{r.title}</strong>
                  <span>{r.desc}</span>
                </span>
                <span className="si-advrow-ch" aria-hidden="true">
                  <HIcon name="submenu" size={12} />
                </span>
              </button>
            );
          })}
          <p className="si-fly-foot">{ADVANCED_FOOT}</p>
        </div>
      ) : null}
    </section>
  );
}

/** The quiet "Sign in to cloud.maude.sh" in Home's top bar once the person has projects but no account. */
export function SignInQuiet({ onClick, disabled }) {
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm si-quiet"
      data-testid="home-signin-quiet"
      disabled={disabled}
      onClick={onClick}
    >
      <HIcon name="cloud" size={14} />
      {W.cloud}
    </button>
  );
}
