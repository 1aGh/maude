// client/v2/link-server/LinkServerDialog.jsx — 2.1.1 T5: the one "Link your server" dialog (canvas 17,
// artboards 12–13). It replaced Settings' "Add a team server" (TeamProjects serverOnly) and Home's "Sign in
// to your own hub" (onboarding/HubSheet.jsx); the same view serves a project tab and Home — what its
// buttons DO is the injected `api` (link-server-api.js for a project tab, AdvancedSheets.jsx's for Home).
//
//   <LinkServerDialog api={…} project="Logo ideas" initialUrl="" onClose />
//
// The address is checked as it is typed (debounced; the app's own server makes one tokenless GET of the
// server's /health). "Sign in in your browser" wakes only once the server answered. The invite link and
// the sign-in key are secrets: masked fields, read once by `runLink`, never echoed into a line.
//
// B5 — in a project tab whose folder is the person's own (`api.where`), the sign-in links THIS folder to the
// server. A server that already holds work answers with counts first: the confirm step says what syncing
// would do (only here / only there / different) and nothing is linked until "Sync this folder".

import { useEffect, useId, useReducer, useRef } from 'react';

import { AdvModal, Sw } from '../onboarding/AdvSheet.jsx';
import {
  addressOf,
  advancedParts,
  canSubmit,
  checkLine,
  confirmLines,
  firstLead,
  stayLine,
  initialLink,
  LINK_WORDS as W,
  linkReducer,
  primaryLabel,
  runConfirm,
  runLink,
  whyNotSubmit,
} from './link-server-model.js';
import { reasonProps } from '../access/disabled-reason.js';

/** How long the address rests before it is checked. */
export const CHECK_DEBOUNCE_MS = 400;

const SW_OF_TONE = { busy: 'busy', ok: 'ok', bad: 'bad' };

/**
 * @param {{ api: object, project?: string|null, initialUrl?: string, onClose: () => void,
 *           debounceMs?: number, pollMs?: number }} props
 */
export function LinkServerDialog({
  api,
  project = null,
  initialUrl = '',
  onClose,
  debounceMs = CHECK_DEBOUNCE_MS,
  pollMs,
}) {
  const [s, dispatch] = useReducer(linkReducer, initialUrl, initialLink);
  const titleId = useId();
  const alive = useRef(true);
  const attempt = useRef(null); // { id, cancelled }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const a = attempt.current;
      attempt.current = null;
      if (a?.id && !a.cancelled) {
        a.cancelled = true;
        void api.signInCancel?.(a.id);
      }
    };
  }, [api]);

  // B5 — where this project lives: its own folder (linking means THIS folder), or not (the old behaviour).
  // Only with a project: Settings' "Add a team server…" (no project) keeps opening the server's project.
  useEffect(() => {
    if (!project || typeof api.where !== 'function') return;
    let live = true;
    api
      .where()
      .then((w) => {
        if (live && alive.current) dispatch({ type: 'here', folder: w?.folder ?? null });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, project]);

  // the check, as you type: one request per resting address; an older answer is dropped by `seq`
  const { phase: checkPhase, seq } = s.check;
  useEffect(() => {
    if (checkPhase !== 'checking') return undefined;
    const url = addressOf(s.url);
    const t = setTimeout(async () => {
      let answer;
      try {
        answer = await api.check(url);
      } catch {
        answer = { ok: false, reason: 'unreachable' };
      }
      if (alive.current) dispatch({ type: 'check-done', seq, answer });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [checkPhase, seq, s.url, api, debounceMs]);

  const submit = async () => {
    if (!canSubmit(s)) return;
    dispatch({ type: 'submit' });
    const mine = { id: null, cancelled: false };
    attempt.current = mine;
    let r;
    try {
      r = await runLink(s, api, {
        pollMs,
        onWaiting: (w) => {
          mine.id = w.id;
          if (alive.current) dispatch({ type: 'waiting', ...w });
        },
        isCancelled: () => mine.cancelled,
      });
    } catch {
      r = { ok: false, error: W.failed };
    }
    if (attempt.current === mine) attempt.current = null;
    if (!alive.current || r.cancelled) return;
    if (r.ok) {
      dispatch({ type: 'done' });
      onClose();
    } else if (r.needsConfirm) dispatch({ type: 'needs-confirm', confirm: r.needsConfirm });
    else dispatch({ type: 'failed', error: r.error });
  };

  const confirmSync = async () => {
    if (s.phase !== 'confirm') return;
    dispatch({ type: 'confirming' });
    let r;
    try {
      r = await runConfirm(s, api);
    } catch {
      r = { ok: false, error: W.failed };
    }
    if (!alive.current) return;
    if (r.ok) {
      dispatch({ type: 'done' });
      onClose();
    } else dispatch({ type: 'failed', error: r.error });
  };

  const abortWait = () => {
    const a = attempt.current;
    attempt.current = null;
    if (a) {
      a.cancelled = true;
      if (a.id) void api.signInCancel?.(a.id);
    }
    dispatch({ type: 'cancelled' });
  };

  const parts = advancedParts(api, s);
  const line = checkLine(s);
  const waiting = s.phase === 'waiting' && s.wait;
  const confirming = (s.phase === 'confirm' || s.phase === 'linking') && s.confirm;
  const busy = s.phase !== 'form';
  // "Sync <project> …" where the dialog links a folder: THIS project's own (B5) or a chosen one (Home);
  // elsewhere a sign-in opens the server's project in its own tab, and the words say so
  const syncsThis = !!project && (api.folders === true || s.folder.mode === 'this');
  const lead = syncsThis ? (
    <p>
      Sync <strong>{project}</strong> with a Maude server your team runs.
    </p>
  ) : (
    <p>{W.leadOwnTab}</p>
  );

  return (
    <AdvModal
      onCancel={waiting ? abortWait : s.phase === 'confirm' ? onClose : busy ? () => {} : onClose}
    >
      <div
        className="ob-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: '100%' }}
      >
        <form
          className="ai-conn-sheet ob-sheet ls-sheet"
          data-testid="link-server-dialog"
          data-phase={s.phase}
          data-check={s.check.phase}
          onSubmit={(e) => {
            e.preventDefault();
            if (confirming) void confirmSync();
            else void submit();
          }}
        >
          {confirming ? (
            <>
              <h2 className="ai-conn-t" id={titleId}>
                {s.confirm.empty ? W.firstTitle(s.confirm.host) : W.confirmTitle(s.confirm.host)}
              </h2>
              <div
                className="ai-conn-b ob-sheet-b"
                data-testid="link-server-confirm"
                data-empty={s.confirm.empty ? 'true' : undefined}
              >
                {s.confirm.empty ? (
                  // 2.1.1 T8 — the first link to a server that holds nothing: what goes up, and where
                  <>
                    <p data-testid="link-server-first-lead">
                      {firstLead(s.confirm.counts, s.confirm.host)}
                    </p>
                    {stayLine(s.confirm.counts, s.confirm.host) ? (
                      <p data-testid="link-server-count-stay">
                        {stayLine(s.confirm.counts, s.confirm.host).text}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p>{W.confirmLead(s.confirm.host)}</p>
                    <ul className="ls-counts">
                      {confirmLines(s.confirm.counts, s.confirm.host).map((l) => (
                        <li key={l.id} data-testid={`link-server-count-${l.id}`}>
                          {l.text}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="ob-fine">{W.confirmFine}</p>
              </div>
              <div className="ai-conn-a">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="link-server-confirm-cancel"
                  disabled={s.phase === 'linking'}
                  {...reasonProps(s.phase === 'linking', W.linking)}
                  onClick={onClose}
                >
                  {W.cancel}
                </button>
                <button
                  type="submit"
                  className="btn btn--sm btn--primary"
                  data-testid="link-server-confirm-sync"
                  disabled={s.phase === 'linking'}
                  {...reasonProps(s.phase === 'linking', W.linking)}
                >
                  {s.phase === 'linking' ? W.linking : W.confirmButton}
                </button>
              </div>
            </>
          ) : waiting ? (
            <>
              <h2 className="ai-conn-t" id={titleId}>
                {W.waitTitle}
              </h2>
              <div className="ai-conn-b ob-sheet-b">
                <p className="ls-wait" role="status" data-testid="link-server-waiting">
                  <Sw state="busy">{W.waitBody(s.wait.host)}</Sw>
                </p>
                <p className="ob-fine">{syncsThis ? W.waitThis(project) : W.waitOwnTab}</p>
              </div>
              <div className="ai-conn-a">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="link-server-cancel"
                  onClick={abortWait}
                >
                  {W.cancel}
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="link-server-reopen"
                  onClick={() => void api.openSignIn(s.wait.signInUrl)}
                >
                  {W.reopen}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="ai-conn-t" id={titleId}>
                {W.title}
              </h2>
              <div className="ai-conn-b ob-sheet-b">
                {lead}
                <span className="ob-field">
                  <label className="ob-field-label" htmlFor="link-server-url">
                    {W.addressLabel}
                  </label>
                  <input
                    id="link-server-url"
                    className="ob-input"
                    data-testid="link-server-url"
                    data-bad={line.tone === 'bad' ? 'true' : undefined}
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={W.placeholder}
                    // biome-ignore lint/a11y/noAutofocus: the dialog opens for this one field
                    autoFocus
                    disabled={busy}
                    aria-describedby="link-server-check"
                    value={s.url}
                    onChange={(e) => dispatch({ type: 'type', url: e.target.value })}
                  />
                  <span
                    id="link-server-check"
                    className="ls-check"
                    data-tone={line.tone}
                    data-testid="link-server-check"
                    role={line.tone === 'bad' ? 'alert' : 'status'}
                  >
                    {line.tone === 'hint' ? (
                      line.text
                    ) : (
                      <Sw state={SW_OF_TONE[line.tone]}>{line.text}</Sw>
                    )}
                  </span>
                </span>

                <button
                  type="submit"
                  className="btn btn--primary ls-full"
                  data-testid="link-server-signin"
                  disabled={!canSubmit(s)}
                  {...reasonProps(!canSubmit(s), whyNotSubmit(s))}
                >
                  {s.phase === 'starting' ? 'Opening…' : primaryLabel(s)}
                </button>

                {s.invite.open ? (
                  <span className="ob-field">
                    <label className="ob-field-label" htmlFor="link-server-invite">
                      {W.inviteLabel}
                    </label>
                    <input
                      id="link-server-invite"
                      className="ob-input"
                      data-testid="link-server-invite"
                      // a bearer secret: masked, never drawn back
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={W.invitePlaceholder}
                      disabled={busy}
                      value={s.invite.value}
                      onChange={(e) => dispatch({ type: 'invite', value: e.target.value })}
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost ls-full"
                    data-testid="link-server-invite-open"
                    disabled={busy}
                    {...reasonProps(busy, 'Opening the sign-in page…')}
                    onClick={() => dispatch({ type: 'invite-open' })}
                  >
                    {W.inviteToggle}
                  </button>
                )}

                {s.error ? (
                  <p className="ai-conn-err" role="alert" data-testid="link-server-error">
                    {s.error}
                  </p>
                ) : null}

                {parts.length ? (
                  <div className="ls-adv" data-open={s.advanced ? 'true' : 'false'}>
                    <button
                      type="button"
                      className="ls-adv-t"
                      aria-expanded={s.advanced}
                      aria-controls="link-server-adv"
                      data-testid="link-server-advanced"
                      onClick={() => dispatch({ type: 'advanced' })}
                    >
                      <span className="ls-chev" aria-hidden="true">
                        ›
                      </span>
                      <span className="ls-adv-l">{W.advanced}</span>
                      <span className="ls-adv-h">{parts.join(' · ')}</span>
                    </button>
                    {s.advanced ? (
                      <div id="link-server-adv" className="ls-adv-b">
                        {typeof api.linkKey === 'function' ? (
                          <span className="ob-field">
                            <label className="ob-field-label" htmlFor="link-server-key">
                              {W.keyLabel}
                            </label>
                            <input
                              id="link-server-key"
                              className="ob-input"
                              data-testid="link-server-key"
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={W.keyPlaceholder}
                              disabled={busy}
                              value={s.key}
                              onChange={(e) => dispatch({ type: 'key', value: e.target.value })}
                            />
                            <span className="ob-fine">{W.keyHint}</span>
                          </span>
                        ) : null}
                        {s.folder.mode === 'this' ? (
                          <fieldset className="ls-folder" disabled={busy}>
                            <legend className="ob-field-label">{W.folderLabel}</legend>
                            <span
                              className="ob-input ob-mono ls-path"
                              data-testid="link-server-folder-this"
                            >
                              {W.folderThis(s.folder.path)}
                            </span>
                          </fieldset>
                        ) : api.folders === true ? (
                          <fieldset className="ls-folder" disabled={busy}>
                            <legend className="ob-field-label">{W.folderLabel}</legend>
                            <label className="ls-radio">
                              <input
                                type="radio"
                                name="link-server-folder"
                                data-testid="link-server-folder-kept"
                                checked={s.folder.mode === 'kept'}
                                onChange={() => dispatch({ type: 'folder', mode: 'kept' })}
                              />
                              {W.folderKept} <span className="ob-fine">{W.folderKeptNote}</span>
                            </label>
                            <label className="ls-radio">
                              <input
                                type="radio"
                                name="link-server-folder"
                                data-testid="link-server-folder-mine"
                                checked={s.folder.mode === 'mine'}
                                onChange={() => dispatch({ type: 'folder', mode: 'mine' })}
                              />
                              {W.folderMine}
                            </label>
                            {s.folder.mode === 'mine' ? (
                              <span className="ob-row2">
                                <span
                                  className="ob-input ob-mono ls-path"
                                  data-testid="link-server-folder-path"
                                >
                                  {s.folder.path}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn--sm"
                                  data-testid="link-server-folder-choose"
                                  onClick={async () => {
                                    const p = await api.pickFolder?.().catch(() => null);
                                    if (p && alive.current)
                                      dispatch({ type: 'folder-path', path: p });
                                  }}
                                >
                                  {W.choose}
                                </button>
                              </span>
                            ) : null}
                          </fieldset>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="ai-conn-a">
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="link-server-cancel"
                  disabled={busy}
                  {...reasonProps(busy, 'Opening the sign-in page…')}
                  onClick={onClose}
                >
                  {W.cancel}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </AdvModal>
  );
}
