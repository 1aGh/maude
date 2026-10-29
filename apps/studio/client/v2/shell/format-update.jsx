// client/v2/shell/format-update.jsx — Michal 2A: the v2 side of the format gate. A format-1 project opens
// view only; the person who may update it (local project, or the owner / hub admin of a linked one on a v2
// hub) gets ONE button, Update project, and a confirm that says 1.x peers will only be able to look. The
// click runs the existing engine through `POST /_api/project/migrate` (apply, from the Maude window) — it
// snapshots to `_history/_migrate/v2-<stamp>/` first. Nothing here migrates on its own: opening the project
// only ASKS (once per project per app session), and Cancel leaves the callout with the button.
// The owner of a project on a 1.x hub gets the team-server line and how to update the server; once the hub
// is v2 the same callout turns into Update project by itself (re-checked on focus / online / a timer).
// p8-update-to-accepted: the same callout, dialog and route also switch a linked project that still saves
// the old way to accepted revisions — in one Update with the format, or on its own (quieter: a format-2
// project is not view only, so it is never asked on opening). A cloud tab points the owner to the
// dashboard instead (format-update.js saveModeState).

import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeApp } from '../../github.js';
import { TeamProjectsDialog } from '../../panels/TeamProjects.jsx';
import { StIcon } from '../../shell/icons.jsx';
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import {
  applyResult,
  FAIL_COPY,
  failureActionLabel,
  isOlderGate,
  isSaveModeOffer,
  OLDER_COPY,
  olderGateState,
  RECHECK_KINDS,
  SAVE_COPY,
  saveModeState,
  teamServerCommand,
  updateDialogCopy,
} from './format-update.js';

const RECHECK_MS = 60_000;

/** A failure's action as this window can run it: the team-server sign-in is the desktop app's own
 *  (Tauri — the Sync details card offers it only there too); in a browser the words stay, no button. */
function reachable(action) {
  if ((action === 'sign-in' || action === 'sign-in-again') && !isNativeApp()) return null;
  return action;
}

async function migrate(body) {
  const r = await fetch('/_api/project/migrate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ direction: 'forward', ...body }),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* a non-JSON answer reads as a failed probe */
  }
  return { status: r.status, report: j };
}

/** Asked once per project per app session — a refusal of the dialog is respected until relaunch. */
function askedKey(cfg) {
  return `maude-format-asked:${cfg?.designRel ?? ''}:${cfg?.name ?? ''}`;
}
function alreadyAsked(cfg) {
  try {
    return sessionStorage.getItem(askedKey(cfg)) === '1';
  } catch {
    return false;
  }
}
function markAsked(cfg) {
  try {
    sessionStorage.setItem(askedKey(cfg), '1');
  } catch {
    /* private window: ask again next time */
  }
}

function Dialog({ testid, titleId, bodyId, title, children, onEscape }) {
  return (
    <div className="gi-modal fu-modal" role="presentation">
      <div className="gi-scrim" aria-hidden="true" onClick={onEscape} />
      <div
        className="gi-dialog fu-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid={testid}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onEscape();
          }
        }}
      >
        <h2 id={titleId} className="fu-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function OlderFormatCallout() {
  const {
    shellCore: { cfg, project },
  } = useShellStore();
  const older = isOlderGate(cfg);
  // the second trigger: a format-2 linked project that still saves the old way (a cloud tab needs no probe)
  const saveOffer = !older && isSaveModeOffer(cfg);
  const probes = older || (saveOffer && !cfg?.cloud);
  const [plan, setPlan] = useState(undefined);
  const [dialog, setDialog] = useState(null); // 'update' | 'team-server' | null
  const [busy, setBusy] = useState(false);
  // p8-update-fails-loud: { kind, line, action, hub } — the worded state after an apply that did not
  // go through, and its one action (failureActionLabel). Never a silent no-op.
  const [failure, setFailure] = useState(null);
  const [copied, setCopied] = useState(false);
  // the team server's sign-in (Sync details' own dialog), for the hub URL it holds; null = closed
  const [signInAt, setSignInAt] = useState(null);
  const confirmRef = useRef(null);
  const returnFocus = useRef(null);
  // one request at a time: a second click in the same tick (before `busy` renders) sends nothing
  const inFlight = useRef(false);

  const probe = useCallback(async () => {
    try {
      const { report } = await migrate({});
      setPlan(report && typeof report === 'object' ? report : { error: true });
    } catch {
      setPlan({ error: true });
    }
  }, []);

  // Probe (a dry run — reads only) whenever the project is older or still saves the old way; forget it
  // once neither holds.
  useEffect(() => {
    if (!probes) {
      setPlan(undefined);
      setDialog(null);
      return;
    }
    void probe();
  }, [probes, cfg?.formatVersion, cfg?.formatGate?.source, cfg?.saveMode, probe]);

  const state = older ? olderGateState({ cfg, plan }) : saveModeState({ cfg, plan });

  // The team server may come back, or be updated: re-check on its own while it is the reason.
  useEffect(() => {
    if (!state || !RECHECK_KINDS.has(state.kind)) return;
    const again = () => void probe();
    const t = setInterval(again, RECHECK_MS);
    window.addEventListener('online', again);
    window.addEventListener('focus', again);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', again);
      window.removeEventListener('focus', again);
    };
  }, [state?.kind, probe]);

  // Opening an older project ASKS once (V2-1.12 §5.9) — it never updates by itself.
  useEffect(() => {
    if (!older || state?.action !== 'update' || dialog || alreadyAsked(cfg)) return;
    markAsked(cfg);
    returnFocus.current = document.activeElement;
    setDialog('update');
  }, [state?.action]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dialog) confirmRef.current?.focus();
  }, [dialog]);

  const close = useCallback(() => {
    if (busy) return;
    setDialog(null);
    setFailure(null);
    setCopied(false);
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && typeof el.focus === 'function') el.focus();
  }, [busy]);

  const open = (which) => {
    returnFocus.current = document.activeElement;
    setFailure(null);
    setDialog(which);
  };

  const linkedHub = () => plan?.project?.linked?.hub ?? cfg?.linkedHub?.url ?? '';
  const signIn = (hub) => setSignInAt(hub || linkedHub());

  const apply = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    let out;
    try {
      const { status, report } = await migrate({ apply: true });
      out = applyResult({ status, report });
    } catch {
      out = applyResult({ thrown: true });
    }
    inFlight.current = false;
    setBusy(false);
    if (out.done) {
      setDialog(null);
      const action =
        out.action === 'sign-in-again'
          ? { label: FAIL_COPY.signInAgain, onClick: () => signIn(out.hub) }
          : undefined;
      shellToast(out.toast, true, action);
      // the server emits config-updated; /_config follows. Ask again too: a switch that did not
      // happen after the format moved keeps the (quiet) offer, one that did clears it.
      void probe();
      return;
    }
    setFailure(out);
    void probe();
  };

  /** The dialog's primary button: Update project, or the one action the failure offers. */
  const primary = () => {
    const a = failure?.action;
    if (!failure || a === 'retry') return void apply();
    if (a === 'sign-in' || a === 'sign-in-again') return signIn(failure.hub);
    if (a === 'team-server') open('team-server');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(teamServerCommand(cfg?.version));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!state) return null;
  const name = cfg?.cloud?.projectName || cfg?.name || project || 'this project';
  const quiet =
    state.kind === 'save-mode' ||
    state.kind === 'save-mode-cloud' ||
    state.kind === 'save-mode-sign-in';
  const words = updateDialogCopy({ older, plan, name });
  const primaryLabel = failure ? failureActionLabel(reachable(failure.action)) : words.action;
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="sh-callout sh-callout--info"
        data-testid="format-older-callout"
        data-kind={state.kind}
      >
        <span className="sh-callout-ic" aria-hidden="true">
          <StIcon name={quiet ? 'clock' : 'problem'} size={16} />
        </span>
        <span className="sh-callout-t">{state.line}</span>
        {reachable(state.action) &&
          (state.action === 'sign-in' || state.action === 'sign-in-again') && (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="format-older-sign-in"
              onClick={() => signIn(state.hub)}
            >
              {failureActionLabel(state.action)}
            </button>
          )}
        {state.action === 'update' && (
          <button
            type="button"
            className={quiet ? 'btn btn--sm' : 'btn btn--primary btn--sm'}
            data-testid="format-older-update"
            onClick={() => open('update')}
          >
            {OLDER_COPY.olderStatusAction}
          </button>
        )}
        {state.action === 'dashboard' && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="format-save-mode-dashboard"
            onClick={() => window.open(state.href, '_blank', 'noopener,noreferrer')}
          >
            {SAVE_COPY.cloudAction}
          </button>
        )}
        {state.action === 'team-server' && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="format-older-team-server"
            onClick={() => open('team-server')}
          >
            {OLDER_COPY.teamServerAction}
          </button>
        )}
      </div>
      {dialog === 'update' && (
        <Dialog
          testid="format-update-dialog"
          titleId="fu-update-title"
          bodyId="fu-update-body"
          title={words.title}
          onEscape={close}
        >
          <div id="fu-update-body">
            {words.body.map((line) => (
              <p key={line} className="fu-body">
                {line}
              </p>
            ))}
          </div>
          {failure && (
            <p
              className="fu-error"
              role="alert"
              data-testid="format-update-error"
              data-kind={failure.kind}
            >
              {failure.line}
            </p>
          )}
          <div className="fu-actions">
            <button
              type="button"
              className="btn"
              data-testid="format-update-cancel"
              disabled={busy}
              onClick={close}
            >
              {failure && !primaryLabel ? FAIL_COPY.close : 'Cancel'}
            </button>
            {(busy || primaryLabel) && (
              <button
                ref={confirmRef}
                type="button"
                className="btn btn--primary"
                data-testid="format-update-confirm"
                data-action={failure?.action ?? 'update'}
                disabled={busy}
                aria-busy={busy ? 'true' : undefined}
                onClick={primary}
              >
                {busy ? 'Updating…' : primaryLabel}
              </button>
            )}
          </div>
        </Dialog>
      )}
      {signInAt !== null && (
        <TeamProjectsDialog
          title={FAIL_COPY.signInAgain}
          initialServer={signInAt}
          onClose={() => {
            setSignInAt(null);
            setFailure(null);
            // signed in again (or not): ask the team server afresh
            void probe();
          }}
        />
      )}
      {dialog === 'team-server' && (
        <Dialog
          testid="format-team-server-dialog"
          titleId="fu-ts-title"
          bodyId="fu-ts-body"
          title={OLDER_COPY.teamServerTitle}
          onEscape={close}
        >
          <p id="fu-ts-body" className="fu-body">
            {OLDER_COPY.teamServerBody}
          </p>
          <code className="fu-command" data-testid="format-team-server-command">
            {teamServerCommand(cfg?.version)}
          </code>
          <div className="fu-actions">
            <button
              type="button"
              className="btn"
              data-testid="format-team-server-close"
              onClick={close}
            >
              {OLDER_COPY.teamServerClose}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="btn btn--primary"
              data-testid="format-team-server-copy"
              onClick={copy}
            >
              {copied ? 'Copied' : OLDER_COPY.teamServerCopy}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export default OlderFormatCallout;
