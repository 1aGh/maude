// client/v2/shell/format-update.jsx — p8-v1-drop (Michal, decision maude/v2-michal-drop-v1-auto-convert):
// a format-1 project, or a linked one that still saves the old way, CONVERTS BY ITSELF when it opens. No
// opt-in dialog any more. The shell runs the dry run (`POST /_api/project/migrate`, read only); when it
// says this Mac may convert now (format-update.js `olderGateState` / `saveModeState` → kind 'ready'), it
// applies at once through the same route — the engine snapshots to `_history/_migrate/v2-<stamp>/` first
// — and says what happened in a notice. Anyone who cannot convert now (not the owner, signed out,
// offline, an older team server, a team server not set up for accepted revisions) gets ONE line with its
// action, and the conversion runs by itself once the reason clears (re-checked on focus / online / a
// timer). A failed attempt is never retried on the same answer (`autoStep`): only after the conditions
// change, at most AUTO_MAX times per app session; by hand it is "Retry update" (CONTRACT §4 [C20]).
// A Maude Cloud project never converts by itself during the rc: its owner gets Update project, behind a
// warning that the cloud tab stays view only until Maude Cloud runs Maude 2 (`confirmCloud`).

import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeApp } from '../../github.js';
import { TeamProjectsDialog } from '../../panels/TeamProjects.jsx';
import { StIcon } from '../../shell/icons.jsx';
import { shellToast } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import {
  AUTO_FRESH,
  applyResult,
  autoStep,
  FAIL_COPY,
  failureActionLabel,
  isOlderGate,
  isSaveModeOffer,
  OLDER_COPY,
  olderGateState,
  RECHECK_KINDS,
  recheckDelay,
  SAVE_COPY,
  saveModeState,
  teamServerCommand,
} from './format-update.js';

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

/** The no-loop guard, per project per app session (sessionStorage: a reload does not loop either). */
function guardKey(cfg) {
  return `maude-format-auto:${cfg?.designRel ?? ''}:${cfg?.name ?? ''}`;
}
function readGuard(cfg) {
  try {
    const v = JSON.parse(sessionStorage.getItem(guardKey(cfg)) ?? 'null');
    return v && typeof v.attempts === 'number' ? v : AUTO_FRESH;
  } catch {
    return AUTO_FRESH;
  }
}
function writeGuard(cfg, g) {
  try {
    sessionStorage.setItem(guardKey(cfg), JSON.stringify(g));
  } catch {
    /* private window: the in-memory guard still holds for this page */
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
  const [dialog, setDialog] = useState(null); // 'cloud' | 'team-server' | null
  const [busy, setBusy] = useState(false);
  // { kind, line, action, hub } — the worded state after an apply that did not go through, and its one
  // action (failureActionLabel). Never a silent no-op.
  const [failure, setFailure] = useState(null);
  const [copied, setCopied] = useState(false);
  // the team server's sign-in (Sync details' own dialog), for the hub URL it holds; null = closed
  const [signInAt, setSignInAt] = useState(null);
  const [guard, setGuard] = useState(() => readGuard(cfg));
  const confirmRef = useRef(null);
  const returnFocus = useRef(null);
  // one request at a time: a second trigger in the same tick (before `busy` renders) sends nothing
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
      setFailure(null);
      return;
    }
    void probe();
  }, [probes, cfg?.formatVersion, cfg?.formatGate?.source, cfg?.saveMode, probe]);

  const state = older ? olderGateState({ cfg, plan }) : saveModeState({ cfg, plan });

  const linkedHub = () => plan?.project?.linked?.hub ?? cfg?.linkedHub?.url ?? '';
  const signIn = (hub) => setSignInAt(hub || linkedHub());

  const apply = async ({ confirmCloud = false } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    let out;
    try {
      const { status, report } = await migrate({
        apply: true,
        ...(confirmCloud ? { confirmCloud: true } : {}),
      });
      out = applyResult({ status, report });
    } catch {
      out = applyResult({ thrown: true });
    }
    inFlight.current = false;
    setBusy(false);
    if (out.done) {
      // the guard stays blocked: until `/_config` catches up the dry run may still read 'ready'
      setDialog(null);
      const action =
        out.action === 'sign-in-again'
          ? { label: FAIL_COPY.signInAgain, onClick: () => signIn(out.hub) }
          : undefined;
      shellToast(out.toast, true, action);
      // the server emits config-updated; /_config follows. Probe again too: a switch that did not
      // happen after the format moved becomes the save-mode trigger, one that did clears it.
      void probe();
      return;
    }
    setFailure(out);
    void probe();
  };

  // The automatic conversion: once per change of conditions (autoStep), never in a loop. It runs on a
  // new probe answer only — the guard, the failure and `apply` are read, never what re-runs it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new dry-run answer is the only trigger
  useEffect(() => {
    const step = autoStep(guard, state, older ? 'format' : 'save');
    if (step.guard !== guard) {
      setGuard(step.guard);
      writeGuard(cfg, step.guard);
    }
    // a different answer than the one the failure came from: the failure's words are stale
    if (failure && state && state.kind !== 'ready' && state.kind !== 'checking') setFailure(null);
    if (step.apply) void apply();
  }, [state?.kind, plan]);

  // The reason may clear on its own (the team server comes back, is updated, a sign-in): re-check.
  const recheck = !!state && (RECHECK_KINDS.has(state.kind) || !!failure);
  useEffect(() => {
    if (!recheck) return;
    // a person coming back to the window (focus / online) re-asks at once; the TIMER backs off
    const again = () => void probe();
    let misses = 0;
    let t;
    const tick = () => {
      t = setTimeout(() => {
        misses += 1;
        again();
        tick();
      }, recheckDelay(misses));
    };
    tick();
    window.addEventListener('online', again);
    window.addEventListener('focus', again);
    return () => {
      clearTimeout(t);
      window.removeEventListener('online', again);
      window.removeEventListener('focus', again);
    };
  }, [recheck, probe]);

  useEffect(() => {
    if (dialog) confirmRef.current?.focus();
  }, [dialog]);

  const close = useCallback(() => {
    if (busy) return;
    setDialog(null);
    setCopied(false);
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && typeof el.focus === 'function') el.focus();
  }, [busy]);

  const open = (which) => {
    returnFocus.current = document.activeElement;
    setDialog(which);
  };

  // gate-b-sec4 — the parked claim's Connect (the Share sheet's own door): record the link on this Mac,
  // then ask again; once linked, the project updates by itself when this Mac may (r1-format-ds).
  const connect = async () => {
    try {
      await fetch('/_api/sync/link/confirm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } catch {
      /* the next probe says what is still true */
    }
    void probe();
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
  // What the callout says: the run in progress, else a failure (with its one action), else a 'ready'
  // the guard holds back (tried already on this answer: Retry update by hand), else the state's line.
  const cloudKind = state.kind === 'cloud';
  let shown = state;
  if (busy)
    shown = { kind: 'updating', line: older ? OLDER_COPY.olderUpdating : SAVE_COPY.updating };
  else if (failure && !cloudKind) shown = failure;
  else if (state.kind === 'ready' && guard.blocked)
    shown = {
      kind: 'held',
      line: older ? OLDER_COPY.olderStatus : SAVE_COPY.status,
      action: 'retry',
    };
  const action = busy ? null : reachable(shown.action);
  const name = cfg?.cloud?.projectName || cfg?.name || project || 'this project';
  const quiet = !older;
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="sh-callout sh-callout--info"
        data-testid="format-older-callout"
        data-kind={shown.kind}
      >
        <span className="sh-callout-ic" aria-hidden="true">
          <StIcon name={quiet ? 'clock' : 'problem'} size={16} />
        </span>
        <span className="sh-callout-t">{shown.line}</span>
        {(action === 'sign-in' || action === 'sign-in-again') && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="format-older-sign-in"
            onClick={() => signIn(shown.hub)}
          >
            {failureActionLabel(action)}
          </button>
        )}
        {action === 'retry' && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="format-older-retry"
            onClick={() => void apply()}
          >
            {FAIL_COPY.retry}
          </button>
        )}
        {action === 'update-cloud' && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="format-older-update"
            onClick={() => open('cloud')}
          >
            {OLDER_COPY.olderStatusAction}
          </button>
        )}
        {action === 'dashboard' && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="format-save-mode-dashboard"
            onClick={() => window.open(shown.href, '_blank', 'noopener,noreferrer')}
          >
            {SAVE_COPY.cloudAction}
          </button>
        )}
        {action === 'connect' && (
          <button
            type="button"
            className="btn btn--sm"
            data-testid="format-older-connect"
            onClick={() => void connect()}
          >
            {OLDER_COPY.connectAction}
          </button>
        )}
        {action === 'team-server' && (
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
      {dialog === 'cloud' && (
        <Dialog
          testid="format-cloud-dialog"
          titleId="fu-cloud-title"
          bodyId="fu-cloud-body"
          title={OLDER_COPY.cloudDialogTitle(name)}
          onEscape={close}
        >
          <p id="fu-cloud-body" className="fu-body">
            {OLDER_COPY.cloudDialogBody}
          </p>
          {failure && (
            <p
              className="fu-error"
              role="alert"
              data-testid="format-cloud-error"
              data-kind={failure.kind}
            >
              {failure.line}
            </p>
          )}
          <div className="fu-actions">
            <button
              type="button"
              className="btn"
              data-testid="format-cloud-cancel"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="btn btn--primary"
              data-testid="format-cloud-confirm"
              disabled={busy}
              aria-busy={busy ? 'true' : undefined}
              onClick={() => void apply({ confirmCloud: true })}
            >
              {busy ? 'Updating…' : OLDER_COPY.olderStatusAction}
            </button>
          </div>
        </Dialog>
      )}
      {signInAt !== null && (
        <TeamProjectsDialog
          title={FAIL_COPY.signInAgain}
          initialServer={signInAt}
          onClose={() => {
            setSignInAt(null);
            // signed in again (or not): ask the team server afresh — a new answer re-arms the guard
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
