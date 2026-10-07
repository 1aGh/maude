// client/report-bug.jsx — the Report-a-Bug dialog (feature-bug-report-button).
//
// Consent-first by construction (docs/report-schema.md): the dialog's middle
// step IS the payload preview — every optional item (screenshot, log tail,
// project name, active canvas, crash logs) has its own checkbox, description
// is the only mandatory field, and nothing transmits until "Send report".
// Screenshots can be redacted in place (black-box rects, flattened into the
// PNG client-side — the original pixels never leave the machine).
//
// Transport: POST /_api/report (dev-server proxy → cloud intake). Cloud down
// or declined → POST /_api/report-fallback writes the bundle under
// `<designRoot>/_reports/` and we open a prefilled public-issue URL (text
// only — media never goes to the public repo).

import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  invoke,
  isNativeApp,
  openGitHubUrl,
  pickMediaFile,
  readPickedMediaBlob,
} from './github.js';

// Two of these are auto-captured (window + artboard), so the ceiling leaves
// room for the user to still attach their own.
const MAX_SHOTS = 4;
const PUBLIC_ISSUES_URL = 'https://github.com/1aGh/maude/issues/new';

/** How each attached shot got here — shown per tile so the user can tell the
 * auto-captured artboard (which never contains Maude's own chrome) apart from
 * one they attached themselves. */
const SHOT_LABEL = {
  shell: 'Maude window (auto)',
  artboard: 'Active artboard (auto)',
  attached: 'Attached by you',
};

/** The OS window-capture shortcut, for the "a Maude UI bug needs the chrome"
 * hint. `platform` is the node `process.platform` string from the bundle. */
function windowShotHint(platform) {
  if (platform === 'darwin') return '⇧⌘4 then Space';
  if (platform === 'win32') return 'Win+Shift+S';
  return 'your screenshot tool';
}

function randHex(n) {
  const bytes = new Uint8Array(n / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function installId() {
  try {
    let id = localStorage.getItem('maude-install-id');
    if (!id) {
      id = `i-${randHex(12)}`;
      localStorage.setItem('maude-install-id', id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Flatten one screenshot: source image + redaction rects → PNG blob. */
async function flattenShot(shot) {
  const img = new Image();
  img.src = shot.url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c2d = canvas.getContext('2d');
  c2d.drawImage(img, 0, 0);
  c2d.fillStyle = '#000';
  for (const r of shot.rects) {
    c2d.fillRect(
      r.x * img.naturalWidth,
      r.y * img.naturalHeight,
      r.w * img.naturalWidth,
      r.h * img.naturalHeight
    );
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

const blobToDataUrl = (blob) =>
  new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });

/** One screenshot preview tile: redact-mode drag draws normalized black rects. */
function ShotTile({ shot, redacting, onRects, onRemove }) {
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const [draft, setDraft] = useState(null);

  const norm = (e) => {
    const b = boxRef.current.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - b.left) / b.width, 0), 1),
      y: Math.min(Math.max((e.clientY - b.top) / b.height, 0), 1),
    };
  };

  return (
    <div className="rb-shot" data-testid="report-bug-shot">
      <div
        ref={boxRef}
        className={`rb-shot-box${redacting ? ' is-redacting' : ''}`}
        onPointerDown={(e) => {
          if (!redacting) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = norm(e);
          setDraft({ ...dragRef.current, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!redacting || !dragRef.current) return;
          const p = norm(e);
          const s = dragRef.current;
          setDraft({
            x: Math.min(s.x, p.x),
            y: Math.min(s.y, p.y),
            w: Math.abs(p.x - s.x),
            h: Math.abs(p.y - s.y),
          });
        }}
        onPointerUp={() => {
          if (!redacting || !dragRef.current) return;
          dragRef.current = null;
          if (draft && draft.w > 0.005 && draft.h > 0.005) onRects([...shot.rects, draft]);
          setDraft(null);
        }}
      >
        <img src={shot.url} alt="screenshot to attach" draggable={false} />
        {[...shot.rects, ...(draft ? [draft] : [])].map((r, i) => (
          <div
            key={i}
            className="rb-redact-rect"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="rb-shot-src">{SHOT_LABEL[shot.source] ?? SHOT_LABEL.attached}</div>
      <div className="rb-shot-actions">
        {shot.rects.length > 0 && (
          <button type="button" className="rb-link" onClick={() => onRects([])}>
            Clear redactions
          </button>
        )}
        <button type="button" className="rb-link" data-testid="report-bug-shot-remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

export function ReportBugDialog({ open, onClose, activeCanvas = null }) {
  const [step, setStep] = useState('describe'); // describe | preview | sending | done | fallback
  const [description, setDescription] = useState('');
  const [bundle, setBundle] = useState(null);
  const [shots, setShots] = useState([]); // {url, blob, source, rects:[{x,y,w,h} normalized]}
  const [crashLogs, setCrashLogs] = useState([]); // native only: {name, firstLine}
  const [consent, setConsent] = useState({
    logTail: true,
    activeCanvas: true,
    projectName: false,
    crashLogs: true,
  });
  const [shellPending, setShellPending] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const [result, setResult] = useState(null); // {issueUrl, issueNumber} | {fallbackDir}
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    for (const s of shots) URL.revokeObjectURL(s.url);
    setStep('describe');
    setDescription('');
    setBundle(null);
    setShots([]);
    setCrashLogs([]);
    setShellPending(false);
    setRedacting(false);
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots]);

  const addShotBlob = useCallback((blob, source = 'attached') => {
    if (!blob) return;
    setShots((prev) =>
      prev.length >= MAX_SHOTS
        ? prev
        : [...prev, { url: URL.createObjectURL(blob), blob, source, rects: [] }]
    );
  }, []);

  // Attach a screenshot the user took themselves — the ONLY lane that can carry
  // Maude's own chrome (menubar, sidebar, dialogs), since the auto-capture
  // renders the canvas headlessly and the shell is never in frame. Native
  // WKWebView won't present a panel for an HTML <input type=file> at all, so it
  // routes through the same Rust open-dialog the AssetPicker uses.
  const attachScreenshot = useCallback(async () => {
    if (isNativeApp()) {
      try {
        const picked = await pickMediaFile();
        if (picked) addShotBlob(await readPickedMediaBlob(picked), 'attached');
      } catch {
        /* cancelled or dialog failure — paste (⌘V) still works */
      }
      return;
    }
    // Browser — imperative off-screen <input>, clicked inside the gesture
    // (mirrors app.jsx's openFilePicker; display:none inputs don't lay out).
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) addShotBlob(file, 'attached');
      input.remove();
    });
    input.click();
  }, [addShotBlob]);

  // On open: pull the scrubbed bundle, capture the active artboard, list
  // native crash logs. Every leg fails soft — a report with fewer attachments
  // beats no dialog.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch('/_api/debug-bundle')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => alive && setBundle(b))
      .catch(() => {});
    // Artboard shot only when THIS window actually has a canvas open. The
    // export resolves its target from the server's `_active.json`, so with
    // nothing open it would attach a stale canvas from another session.
    if (activeCanvas) {
      fetch('/_api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'png', scope: 'artboard' }),
      })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => alive && blob && addShotBlob(blob, 'artboard'))
        .catch(() => {});
    }
    // The window shot — Maude's own chrome, which the artboard capture above
    // structurally cannot see. Slow (boots a headless browser, opens the canvas),
    // so it lands second and shows a pending row meanwhile. `canvas` is sent
    // explicitly — including as null, which means "open nothing", so an empty
    // window is reported as an empty window.
    setShellPending(true);
    fetch('/_api/shell-shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas: activeCanvas }),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!alive) return;
        if (blob) addShotBlob(blob, 'shell');
        setShellPending(false);
      })
      .catch(() => alive && setShellPending(false));
    if (isNativeApp()) {
      invoke('list_crash_logs')
        .then((logs) => alive && setCrashLogs(Array.isArray(logs) ? logs.slice(0, 3) : []))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeCanvas]);

  // Paste-to-attach — the lane that covers native-shell bugs the canvas
  // capture can't see (user screenshots the window, pastes here).
  useEffect(() => {
    if (!open) return;
    function onPaste(e) {
      for (const item of e.clipboardData?.items ?? []) {
        if (item.type.startsWith('image/')) addShotBlob(item.getAsFile());
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, addShotBlob]);

  if (!open) return null;

  const close = () => {
    reset();
    onClose();
  };

  async function buildReport() {
    const report = {
      schema: 'maude-report/v1',
      reportId: `r-${randHex(8)}`,
      createdAt: new Date().toISOString(),
      app: {
        maudeVersion: bundle?.app?.maudeVersion ?? 'unknown',
        surface: isNativeApp() ? 'native' : 'browser',
        platform: bundle?.app?.platform ?? 'unknown',
        arch: bundle?.app?.arch ?? 'unknown',
      },
      context: {
        projectName: consent.projectName ? (bundle?.context?.projectName ?? null) : null,
        // This window's canvas, never the server's sticky `_active.json` — the
        // report must not name a file the reporter does not have open.
        activeCanvas: consent.activeCanvas ? activeCanvas : null,
      },
      description: description.trim(),
      attachments: {
        screenshots: shots.length,
        serverLogTail: consent.logTail && !!bundle?.logs?.serverLogTail,
        processStats: consent.logTail && !!bundle?.process,
        crashLogs: consent.crashLogs ? crashLogs.length : 0,
      },
      logs: {},
    };
    const id = installId();
    if (id) report.installId = id;
    if (consent.logTail && bundle?.logs?.serverLogTail) {
      report.logs.serverLogTail = bundle.logs.serverLogTail;
    }
    // Server process memory — three integers, rides the SAME consent as the log
    // tail because it is diagnostics of the same kind (and, like the tail, is
    // only meaningful alongside it). Issue #119 arrived as a RAM figure the
    // reporter read off Activity Monitor, with nothing in the report to confirm
    // it; the memory watch that should have logged the problem was measuring a
    // counter that does not move under Bun, so the log tail was silent too.
    if (consent.logTail && bundle?.process) {
      report.process = {
        rssBytes: bundle.process.rssBytes,
        heapUsedBytes: bundle.process.heapUsedBytes,
        uptimeSeconds: bundle.process.uptimeSeconds,
      };
    }
    if (consent.crashLogs && crashLogs.length && isNativeApp()) {
      report.logs.crashLogs = [];
      for (const log of crashLogs) {
        try {
          const body = await invoke('read_crash_log', { name: log.name });
          report.logs.crashLogs.push({ name: log.name, body });
        } catch {
          /* an unreadable crash log is dropped, not fatal */
        }
      }
    }
    return report;
  }

  async function send() {
    setStep('sending');
    setError(null);
    try {
      const report = await buildReport();
      const form = new FormData();
      form.set('report', JSON.stringify(report));
      for (const shot of shots) {
        form.append('screenshot', await flattenShot(shot), 'screenshot.png');
      }
      const res = await fetch('/_api/report', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setResult(json);
        setStep('done');
        return;
      }
      setError(json?.error ?? `report failed (HTTP ${res.status})`);
      setStep('fallback');
    } catch {
      setError('Maude could not reach the report service.');
      setStep('fallback');
    }
  }

  async function saveFallback() {
    try {
      const report = await buildReport();
      const screenshots = [];
      for (const shot of shots) screenshots.push(await blobToDataUrl(await flattenShot(shot)));
      const res = await fetch('/_api/report-fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report, screenshots }),
      });
      const json = await res.json().catch(() => null);
      const title = encodeURIComponent(report.description.split('\n')[0].slice(0, 80));
      const body = encodeURIComponent(
        `${report.description}\n\n> Maude ${report.app.maudeVersion} · ${report.app.platform} ${report.app.arch} · ${report.app.surface}\n> Local report bundle: \`${json?.dir ?? '.design/_reports/'}\` (attach its files here)`
      );
      const url = `${PUBLIC_ISSUES_URL}?title=${title}&body=${body}&labels=report`;
      if (isNativeApp()) {
        try {
          await openGitHubUrl(url);
        } catch {
          window.open(url, '_blank', 'noopener');
        }
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setResult({ fallbackDir: json?.dir ?? null });
      setStep('done');
    } catch {
      setError('Saving the local bundle failed too — please file the issue by hand.');
    }
  }

  const canPreview = description.trim().length > 0;

  return (
    <div className="st-scrim" onClick={close} data-testid="report-bug-dialog">
      <div
        className="st-dialog rb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rb-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="st-dialog-hd">
          <span className="st-dialog-title" id="rb-title">
            Report a bug
          </span>
          <button type="button" className="st-iconbtn" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        <div className="st-dialog-bd rb-body">
          {step === 'describe' && (
            <>
              <label className="rb-label" htmlFor="rb-desc">
                What happened? What did you expect instead?
              </label>
              <textarea
                id="rb-desc"
                className="textarea"
                data-testid="report-bug-description"
                rows={5}
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Clicking Export → PNG shows a spinner forever…"
              />
              <p className="rb-hint">
                Next you'll see exactly what gets attached — nothing is sent until you approve it.
              </p>
              <footer className="rb-actions">
                <button type="button" className="st-btn" onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="st-btn rb-primary"
                  data-testid="report-bug-preview"
                  disabled={!canPreview}
                  onClick={() => setStep('preview')}
                >
                  Review &amp; attach
                </button>
              </footer>
            </>
          )}

          {step === 'preview' && (
            <>
              <div className="rb-section">
                <div className="rb-section-hd">
                  <span>Screenshots ({shots.length})</span>
                  <span className="rb-hd-actions">
                    {shots.length < MAX_SHOTS && (
                      <button
                        type="button"
                        className="rb-link"
                        data-testid="report-bug-attach"
                        onClick={attachScreenshot}
                      >
                        Attach screenshot…
                      </button>
                    )}
                    {shots.length > 0 && (
                      <button
                        type="button"
                        className={`rb-link${redacting ? ' is-on' : ''}`}
                        data-testid="report-bug-redact"
                        onClick={() => setRedacting((v) => !v)}
                      >
                        {redacting ? 'Done redacting' : 'Redact…'}
                      </button>
                    )}
                  </span>
                </div>
                <p className="rb-hint">
                  Maude captures its own window and the active artboard for you. The window shot is
                  a fresh render, so anything mid-flight — an open menu, a stuck spinner — won't be
                  in it: grab that yourself ({windowShotHint(bundle?.app?.platform)}) and attach or
                  paste (⌘V) it here.
                </p>
                {shellPending && (
                  <p className="rb-hint" data-testid="report-bug-shell-pending">
                    Capturing the Maude window…
                  </p>
                )}
                {shots.length === 0 && !shellPending ? (
                  <p className="rb-hint">No screenshot attached yet — up to {MAX_SHOTS}.</p>
                ) : (
                  <>
                    {redacting && (
                      <p className="rb-hint">Drag over anything private — it ships as solid black.</p>
                    )}
                    <div className="rb-shots">
                      {shots.map((shot, i) => (
                        <ShotTile
                          key={shot.url}
                          shot={shot}
                          redacting={redacting}
                          onRects={(rects) =>
                            setShots((prev) => prev.map((s, j) => (j === i ? { ...s, rects } : s)))
                          }
                          onRemove={() => {
                            URL.revokeObjectURL(shot.url);
                            setShots((prev) => prev.filter((_, j) => j !== i));
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="rb-section">
                <div className="rb-section-hd">
                  <span>Included with the report</span>
                </div>
                <label className="rb-check">
                  <input type="checkbox" checked disabled />
                  <span>
                    Maude {bundle?.app?.maudeVersion ?? '…'} · {bundle?.app?.platform ?? '…'}{' '}
                    {bundle?.app?.arch ?? ''} · {isNativeApp() ? 'desktop app' : 'browser'}
                  </span>
                </label>
                {activeCanvas && (
                  <label className="rb-check">
                    <input
                      type="checkbox"
                      checked={consent.activeCanvas}
                      onChange={(e) => setConsent({ ...consent, activeCanvas: e.target.checked })}
                    />
                    <span>
                      Active canvas path — <code>{activeCanvas}</code>
                    </span>
                  </label>
                )}
                {bundle?.context?.projectName && (
                  <label className="rb-check">
                    <input
                      type="checkbox"
                      checked={consent.projectName}
                      onChange={(e) => setConsent({ ...consent, projectName: e.target.checked })}
                    />
                    <span>
                      Project name — <code>{bundle.context.projectName}</code>
                    </span>
                  </label>
                )}
                {bundle?.logs?.serverLogTail ? (
                  <label className="rb-check">
                    <input
                      type="checkbox"
                      data-testid="report-bug-consent-logs"
                      checked={consent.logTail}
                      onChange={(e) => setConsent({ ...consent, logTail: e.target.checked })}
                    />
                    <span>
                      Recent server log ({bundle.logs.serverLogTail.split('\n').length} lines,
                      paths &amp; secrets scrubbed)
                      {bundle?.process
                        ? ` + server memory (${Math.round(bundle.process.rssBytes / 1048576)} MB)`
                        : ''}{' '}
                      —{' '}
                      <details className="rb-details">
                        <summary>view</summary>
                        <pre className="rb-log">{bundle.logs.serverLogTail}</pre>
                      </details>
                    </span>
                  </label>
                ) : null}
                {isNativeApp() && crashLogs.length > 0 && (
                  <label className="rb-check">
                    <input
                      type="checkbox"
                      checked={consent.crashLogs}
                      onChange={(e) => setConsent({ ...consent, crashLogs: e.target.checked })}
                    />
                    <span>
                      Crash logs ({crashLogs.length}) — <code>{crashLogs.map((l) => l.name).join(', ')}</code>
                    </span>
                  </label>
                )}
              </div>

              <p className="rb-hint">
                Your description and the system info above become a{' '}
                <strong>public GitHub issue</strong>; screenshots and logs go to a private
                repository only maintainers can open.
              </p>
              <footer className="rb-actions">
                <button type="button" className="st-btn" onClick={() => setStep('describe')}>
                  Back
                </button>
                <button
                  type="button"
                  className="st-btn rb-primary"
                  data-testid="report-bug-send"
                  onClick={send}
                >
                  Send report
                </button>
              </footer>
            </>
          )}

          {step === 'sending' && <p className="rb-hint">Sending your report…</p>}

          {step === 'done' && (
            <>
              {result?.issueUrl ? (
                <p>
                  Thank you — your report is filed as{' '}
                  <button
                    type="button"
                    className="rb-link"
                    data-testid="report-bug-issue-link"
                    onClick={() => {
                      if (isNativeApp()) {
                        openGitHubUrl(result.issueUrl).catch(() =>
                          navigator.clipboard?.writeText(result.issueUrl)
                        );
                      } else {
                        window.open(result.issueUrl, '_blank', 'noopener');
                      }
                    }}
                  >
                    report #{result.issueNumber}
                  </button>
                  {' '}
                  on the public Maude issue tracker. Screenshots and logs stay in a private
                  repository only maintainers can open — the issue links to them.
                </p>
              ) : (
                <p>
                  The bundle is saved locally
                  {result?.fallbackDir ? (
                    <>
                      {' '}
                      at <code>{result.fallbackDir}</code>
                    </>
                  ) : null}{' '}
                  and a prefilled GitHub issue was opened — attach the bundle files there.
                </p>
              )}
              <footer className="rb-actions">
                <button type="button" className="st-btn rb-primary" onClick={close}>
                  Done
                </button>
              </footer>
            </>
          )}

          {step === 'fallback' && (
            <>
              <p className="rb-error" data-testid="report-bug-error">
                {error}
              </p>
              <p className="rb-hint">
                You can save the report locally instead and file it on GitHub yourself — the
                prefilled issue carries the text; screenshots stay on this machine unless you
                attach them by hand.
              </p>
              <footer className="rb-actions">
                <button type="button" className="st-btn" onClick={() => setStep('preview')}>
                  Back
                </button>
                <button type="button" className="st-btn rb-primary" onClick={saveFallback}>
                  Save locally &amp; open GitHub
                </button>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
