// client/v2/shell/format-update.jsx — Michal 2A: the v2 side of the format gate. A format-1 project opens
// view only; the person who may update it (local project, or the owner / hub admin of a linked one on a v2
// hub) gets ONE button, Update project, and a confirm that says 1.x peers will only be able to look. The
// click runs the existing engine through `POST /_api/project/migrate` (apply, from the Maude window) — it
// snapshots to `_history/_migrate/v2-<stamp>/` first. Nothing here migrates on its own: opening the project
// only ASKS (once per project per app session), and Cancel leaves the callout with the button.
// The owner of a project on a 1.x hub gets the team-server line and how to update the server; once the hub
// is v2 the same callout turns into Update project by itself (re-checked on focus / online / a timer).

import { useCallback, useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import {
  applyFailureLine,
  isOlderGate,
  OLDER_COPY,
  olderGateState,
  RECHECK_KINDS,
  teamServerCommand,
} from './format-update.js';

const RECHECK_MS = 60_000;

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
  const [plan, setPlan] = useState(undefined);
  const [dialog, setDialog] = useState(null); // 'update' | 'team-server' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const confirmRef = useRef(null);
  const returnFocus = useRef(null);

  const probe = useCallback(async () => {
    try {
      const { report } = await migrate({});
      setPlan(report && typeof report === 'object' ? report : { error: true });
    } catch {
      setPlan({ error: true });
    }
  }, []);

  // Probe (a dry run — reads only) whenever the project is older; forget it once it is not.
  useEffect(() => {
    if (!older) {
      setPlan(undefined);
      setDialog(null);
      return;
    }
    void probe();
  }, [older, cfg?.formatVersion, cfg?.formatGate?.source, probe]);

  const state = olderGateState({ cfg, plan });

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
    if (state?.action !== 'update' || dialog || alreadyAsked(cfg)) return;
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
    setError('');
    setCopied(false);
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && typeof el.focus === 'function') el.focus();
  }, [busy]);

  const open = (which) => {
    returnFocus.current = document.activeElement;
    setError('');
    setDialog(which);
  };

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { status, report } = await migrate({ apply: true });
      if (status === 200 && report && report.dryRun === false && report.exitCode === 0) {
        setBusy(false);
        setDialog(null);
        shellToast(OLDER_COPY.toastUpdated, true);
        return; // the server emits config-updated; /_config follows and this callout goes away
      }
      setError(applyFailureLine(report));
      void probe();
    } catch {
      setError(applyFailureLine(null));
    }
    setBusy(false);
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
          <StIcon name="problem" size={16} />
        </span>
        <span className="sh-callout-t">{state.line}</span>
        {state.action === 'update' && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            data-testid="format-older-update"
            onClick={() => open('update')}
          >
            {OLDER_COPY.olderStatusAction}
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
          title={OLDER_COPY.dialogTitle(name)}
          onEscape={close}
        >
          <p id="fu-update-body" className="fu-body">
            {OLDER_COPY.dialogBody}
          </p>
          {error && (
            <p className="fu-error" role="alert" data-testid="format-update-error">
              {error}
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
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="btn btn--primary"
              data-testid="format-update-confirm"
              disabled={busy}
              onClick={apply}
            >
              {busy ? 'Updating…' : OLDER_COPY.dialogAction}
            </button>
          </div>
        </Dialog>
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
