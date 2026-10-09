// First-open AI-editing readiness list (DDR-128). Reads GET /_api/preflight and
// renders one row per dependency (claude · maude · plugins · agent-browser) with a
// status glyph, a one-line detail, and a copy-paste remediation when something's
// missing. Detect-and-guide only — it never installs or mutates anything.
//
// Shared by the onboarding wizard (a non-blocking strip) and the ChatPanel
// not-connected explainer (where a user actually hits the wall). Both also use it
// as the persistent re-check surface — `refresh()` re-probes without a reinstall.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getClaudeAutoSetup, isNativeApp, setClaudeAutoSetup } from '../github.js';

/** Fetch + cache the readiness report. `refresh()` re-probes (the re-check button). */
export function useReadiness(enabled = true) {
  const [report, setReport] = useState(null); // { ready, items } | null
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(() => {
    setLoading(true);
    return fetch('/_api/preflight')
      .then((r) => r.json())
      .then((d) => {
        setReport(d && Array.isArray(d.items) ? d : null);
        setLoading(false);
        return d;
      })
      .catch(() => {
        setReport(null);
        setLoading(false);
        return null;
      });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetch('/_api/preflight')
      .then((r) => r.json())
      .then((d) => alive && (setReport(d && Array.isArray(d.items) ? d : null), setLoading(false)))
      .catch(() => alive && (setReport(null), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { report, loading, refresh };
}

function StatusIcon({ status }) {
  if (status === 'present')
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="3 8.4 6.4 11.8 13 4.4" />
      </svg>
    );
  if (status === 'unknown')
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 6a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6 1V10" />
        <circle cx="8" cy="12.4" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    );
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
      <line x1="8" y1="5" x2="8" y2="8.6" />
    </svg>
  );
}

/** Render `code`-fenced spans inside a string as <code>, the rest as text. */
function Inline({ text }) {
  const parts = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<code key={parts.length}>{m[1]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// DDR-166 T0d — a bounded, cancelable poll after "Sign in" is clicked. Capped
// duration (not indefinite), single-flight (the button disables while
// polling), and its copy is static text — no animation, so it costs nothing
// under prefers-reduced-motion.
const SIGNIN_POLL_MS = 2000;
const SIGNIN_POLL_MAX_MS = 120000;
// The installer itself is fire-and-forget server-side (avoids Bun's default
// 10s idle timeout on a slow network) — poll for its result the same way.
const INSTALL_POLL_MS = 1500;
// The window we allow with NO `running` signal from the server before giving up.
// The deadline is pushed forward on every `running` poll (see pollForInstall), so
// a genuinely-progressing install is never cut off — this only bounds a hung/lost
// installer. Generous vs the old fixed 90 s that cut off fresh-machine downloads.
const INSTALL_POLL_MAX_MS = 180000;

// DDR-166 T0c/T0d — one component drives both the "install then sign in"
// chain (mode='install') and the "sign in only" case (mode='signin'), since
// the poll-after-signin logic is identical either way. The install step
// itself is a single distinct network call, not a loop — only the sign-in
// half needs polling (the browser-OAuth completion signal).
function SetupAction({ mode, refresh }) {
  const [phase, setPhase] = useState('idle'); // idle | installing | waiting | error
  const [error, setError] = useState(null);
  const timerRef = useRef({ interval: null, deadline: 0 });

  const stopPoll = () => {
    if (timerRef.current.interval) clearInterval(timerRef.current.interval);
    timerRef.current.interval = null;
  };

  const pollForSignin = () => {
    setPhase('waiting');
    timerRef.current.deadline = Date.now() + SIGNIN_POLL_MAX_MS;
    timerRef.current.interval = setInterval(async () => {
      if (Date.now() > timerRef.current.deadline) {
        stopPoll();
        setPhase('error');
        setError('Sign-in timed out — try again.');
        return;
      }
      const report = await refresh();
      const claudeItem = report?.items?.find((i) => i.id === 'claude');
      if (claudeItem?.status === 'present') stopPoll();
    }, SIGNIN_POLL_MS);
  };

  const runSignin = async () => {
    const res = await fetch('/_api/claude/signin', { method: 'POST' })
      .then((r) => r.json())
      .catch(() => ({ ok: false, reason: 'Could not reach Maude.' }));
    if (!res.ok) {
      setPhase('error');
      setError(res.reason || 'Could not start sign-in.');
      return;
    }
    pollForSignin();
  };

  const pollForInstall = () => {
    setPhase('installing');
    timerRef.current.deadline = Date.now() + INSTALL_POLL_MAX_MS;
    timerRef.current.interval = setInterval(async () => {
      if (Date.now() > timerRef.current.deadline) {
        stopPoll();
        setPhase('error');
        setError(
          'Install is taking longer than expected — it may still finish in the background; you can also run the command below yourself, then Re-check.'
        );
        return;
      }
      const state = await fetch('/_api/claude/install-status')
        .then((r) => r.json())
        .catch(() => null);
      // The installer downloads a ~200 MB binary; on a fresh/slow machine that
      // routinely exceeds a fixed 90 s wall clock (RCA G6 — the "Install timed
      // out" the user hit while the fire-and-forget install was still running).
      // While the server reports it's actively installing, push the deadline
      // forward so a slow-but-progressing download is never declared a failure;
      // the cap only bites if the server stops reporting `running` (hung/lost).
      if (state && state.phase === 'running') {
        timerRef.current.deadline = Date.now() + INSTALL_POLL_MAX_MS;
        return;
      }
      if (!state || state.phase !== 'done') return; // transient — keep polling to the deadline
      stopPoll();
      if (!state.ok) {
        setPhase('error');
        setError(state.reason || 'Install failed — you can also run the command below yourself.');
        return;
      }
      // One click covers both steps: only on verified-fresh install success
      // does this move straight into sign-in with no second click needed.
      await runSignin();
    }, INSTALL_POLL_MS);
  };

  const start = async () => {
    setError(null);
    if (mode === 'install') {
      const res = await fetch('/_api/claude/install', { method: 'POST' })
        .then((r) => r.json())
        .catch(() => ({ ok: false, reason: 'Could not reach Maude.' }));
      if (!res.ok) {
        setPhase('error');
        setError(res.reason || 'Could not start the installer.');
        return;
      }
      pollForInstall();
    } else {
      await runSignin();
    }
  };

  const cancel = async () => {
    stopPoll();
    setPhase('idle');
    await fetch('/_api/claude/signin-cancel', { method: 'POST' }).catch(() => {});
  };

  useEffect(() => () => stopPoll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'installing') {
    return (
      <span className="rdy-fix">
        <span className="rdy-fix-tx">Installing Claude Code…</span>
      </span>
    );
  }
  if (phase === 'waiting') {
    return (
      <span className="rdy-fix">
        <span className="rdy-fix-tx">Waiting for you to finish signing in in your browser…</span>
        <button type="button" className="rdy-copy" onClick={cancel}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    <span className="rdy-fix">
      {error ? <span className="rdy-fix-tx rdy-fix-tx--err">{error}</span> : null}
      <button
        type="button"
        className="rdy-signin"
        data-testid={mode === 'install' ? 'acp-setup-install' : 'acp-setup-signin'}
        onClick={start}
      >
        {mode === 'install' ? 'Set up AI editing' : 'Sign in to Claude'}
      </button>
    </span>
  );
}

function InstallCommand({ command }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };
  return (
    <span className="rdy-cmd">
      <code className="rdy-cmd-tx">{command}</code>
      <button type="button" className="rdy-copy" onClick={copy} aria-label="Copy install command">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

function Row({ item, refresh }) {
  const [copied, setCopied] = useState(false);
  const copyFix = () => {
    const cmds = item.remediation?.replace(/`/g, '') ?? '';
    navigator.clipboard?.writeText(cmds).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };
  return (
    <li
      className={`rdy-row rdy-row--${item.status}${item.required ? '' : ' rdy-row--opt'}`}
      data-testid={`rdy-row-${item.id}`}
    >
      <span className="rdy-ic" aria-hidden="true">
        <StatusIcon status={item.status} />
      </span>
      <span className="rdy-tx">
        <span className="rdy-label">{item.label}</span>
        <span className="rdy-detail">
          <Inline text={item.detail} />
        </span>
        {item.remediation ? (
          <span className="rdy-fix">
            <span className="rdy-fix-tx">
              <Inline text={item.remediation} />
            </span>
            {!item.installCommand && !item.action ? (
              <button
                type="button"
                className="rdy-copy"
                onClick={copyFix}
                aria-label={`Copy the fix for ${item.label}`}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            ) : null}
          </span>
        ) : null}
        {/* Shown whenever a path resolved — NOT only in the signin state. DDR-166
            Decision 3 calls this binding ("so a pre-existing PATH-hijacked `claude`
            isn't invisible to the one human capable of noticing it's wrong"), and
            gating it on `action === 'signin'` hid it in the one state whose most
            likely cause IS something unexpected fronting the binary (issue #107,
            attacker finding F4). */}
        {item.resolvedPath ? (
          <span className="rdy-fix-tx rdy-resolved-path">
            {item.resolvedViaMaude ? 'Installed by Maude: ' : 'Found on your PATH: '}
            <code>{item.resolvedPath}</code>
          </span>
        ) : null}
        {(item.action === 'install' || item.action === 'signin') && refresh ? (
          <SetupAction mode={item.action} refresh={refresh} />
        ) : null}
        {item.installCommand ? (
          <>
            {item.action === 'install' ? (
              <span className="rdy-fix-tx rdy-fallback-label">
                Clicking above runs this command, then opens your browser to sign in. Prefer to do
                it yourself?
              </span>
            ) : null}
            <InstallCommand command={item.installCommand} />
          </>
        ) : null}
      </span>
    </li>
  );
}

export default function ReadinessList({ report, loading, refresh }) {
  return (
    <div className="rdy">
      <ul className="rdy-list">
        {report?.items?.map((it) => (
          <Row key={it.id} item={it} refresh={refresh} />
        ))}
      </ul>
      {refresh ? (
        <div className="rdy-foot">
          <button
            type="button"
            className="btn btn--ghost btn--sm rdy-recheck"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? 'Checking…' : 'Re-check'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// DDR-166 Decision 5 — the settings-UI opt-out for the auto-install/auto-
// sign-in buttons above. DEFAULT ON. Native-only (the toggle is backed by a
// Tauri command); a terminal-launched `maude design serve` web session has
// no automated action to opt out of in the first place.
function AutoSetupToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let alive = true;
    getClaudeAutoSetup()
      .then((v) => alive && setOn(v !== false))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!isNativeApp()) return null;
  return (
    <label className="rdy-autosetup-toggle">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          setClaudeAutoSetup(next).catch(() => setOn(!next));
        }}
      />
      <span>
        Offer to install Claude Code and sign in automatically. Turn off to see only the copy-paste
        command — takes effect next launch or project switch.
      </span>
    </label>
  );
}

// Standalone readiness modal reachable any time from Help ▸ Check AI editing
// readiness… (DDR-128, T6 — the persistent re-check surface, not gated on
// first-run or a disconnected chat). Reuses the shared help-modal chrome (backdrop
// + header + body) so it matches the What's New / Help dialogs, and the same
// ReadinessList. Self-contained: probes only while open (the hook's `enabled` gate),
// re-probes via the list's Re-check button.
export function ReadinessDialog({ open, onClose }) {
  const { report, loading, refresh } = useReadiness(open);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="help-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-modal rdy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rdy-modal-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="rdy-modal-title">
            Check AI editing readiness
          </span>
          <button
            type="button"
            className="help-modal-close"
            aria-label="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="help-modal-body">
          <p className="rdy-modal-note">
            The canvas browser, version history, and sharing work with no setup. AI editing
            additionally drives a Claude Code you have installed — here's what it needs:
          </p>
          {report ? (
            <ReadinessList report={report} loading={loading} refresh={refresh} />
          ) : (
            <p className="rdy-modal-note">
              {loading ? 'Checking…' : "Couldn't reach the readiness probe."}
            </p>
          )}
          <AutoSetupToggle />
        </div>
      </div>
    </div>
  );
}
