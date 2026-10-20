// client/v2/import/figma-sheet.jsx — S8.17: Import from Figma (canvas 12 · ia-figma-sheets, ia-figma-arrived,
// ia-figjam). Menu › File › Import from Figma… — the same sheet walks through all three steps:
//
//   1 · Paste a link     The first time, the sheet says Figma isn't connected and offers Connect… in place.
//   2 · Connect once     The personal access token, posted once to `/_api/figma/connect` (the S11.14 store,
//                        Settings › Connections removes it). The field is cleared; the token is never shown back.
//   3 · Pick frames and where they go
//                        `/_api/figma/frames` lists the page's frames; `/_api/figma/import-frames` brings the picked
//                        ones in as ONE new canvas, each frame Figma's exact picture at its Figma size (Fixed size).
//
// A FigJam link goes the S4.16 way instead: `POST /_api/annotations/figjam` lands the board as ONE "From FigJam"
// section on the open canvas's annotation layer (stickies stay stickies, comments → stickies, a widget arrives as a
// picture of itself). The words never say text stays editable (CONTRACT §4).
//
// Untrusted input (DDR-216): every answer is counts, sizes, node ids and reason codes; frame labels arrive already
// `attrValue`d and React renders them as text. An upstream message never reaches the page.
//
// The v1 FigmaImportPanel testids are re-emitted here (FigmaImportPanel.jsx is a shim): figma-import-panel,
// figma-import-url, figma-not-connected, figma-import-error, figma-import-summary; figma-import-preview is the
// link step's Import (it reads the frame list and writes nothing — v1's Preview), figma-import-run the Import
// that writes; figma-import-mode-<id> marks the three v1 modes where they live now: -frames the frame picker,
// -board the FigJam step, -tokens the "Colours and text styles" option.

import { useEffect, useRef, useState } from 'react';
import { canvasRel } from '../access/access-client.js';
import { getPaletteEnv } from '../search/search-env.js';
import { askNow, clearAsked } from '../assets/ask-once.js';
import { useFigmaConnection } from '../settings/use-connections.js';
import { useModalFocus } from '../shell/modal-focus.js';
import { registerFigmaArtboardSlots } from './figma-artboard.jsx';
import FigmaSummary from './figma-summary.jsx';
import FramePicker from './frame-picker.jsx';
import {
  boardSummaryRows,
  destLabel,
  FIGMA_WORDS as W,
  figmaFailureWords,
  figmaLinkKind,
  foldersOf,
  frameSummaryRows,
  importVerb,
  normalizeLink,
} from './figma-model.js';

// The imported frame's inspector rows (Make editable) ride with the sheet's module: app.jsx loads it at boot.
registerFigmaArtboardSlots();

async function postJSON(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json?.ok !== false, json };
  } catch {
    return { ok: false, json: { reason: 'network' } };
  }
}

/** The folder of the open canvas (designRoot-relative), or null. */
function folderOfActive(activePath, designRel) {
  const rel = activePath ? canvasRel(activePath, designRel) : null;
  if (!rel) return null;
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
}

/**
 * @param {{ open: boolean, onClose: () => void, onImported?: (r: object) => void, activePath?: string|null }} props
 */
export default function FigmaSheet({ open, onClose, onImported, activePath = null }) {
  const env = getPaletteEnv();
  const designRel = env.designRel || '.design';
  const figma = useFigmaConnection();
  const connected = figma.status ? Boolean(figma.status.configured) : null;

  const [step, setStep] = useState('link'); // link · connect · reading · pick · figjam · importing · done
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [err, setErr] = useState(null);
  const [file, setFile] = useState(null); // { fileName, page, frames, more }
  const [picked, setPicked] = useState(() => new Set());
  const [folders, setFolders] = useState([]);
  const [folder, setFolder] = useState('');
  const [comments, setComments] = useState(true);
  const [styles, setStyles] = useState(false);
  const [result, setResult] = useState(null); // { kind: 'frames' or 'figjam', ... }
  const urlRef = useRef(null);
  const tokenRef = useRef(null);
  const ref = useModalFocus({ open, onClose, initialRef: step === 'connect' ? tokenRef : urlRef });

  useEffect(() => {
    if (open) return;
    setStep('link');
    setErr(null);
    setFile(null);
    setResult(null);
    setToken('');
    setPicked(new Set());
  }, [open]);

  // Where new canvases can go: the project's folders, from the index the Canvases panel reads.
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/_index-data', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => {
        if (!live) return;
        const list = foldersOf(idx, designRel);
        setFolders(list);
        const here = folderOfActive(activePath, designRel);
        setFolder(here ?? (list.includes('ui') ? 'ui' : (list[0] ?? '')));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, activePath, designRel]);

  const kind = figmaLinkKind(url);
  const boardCanvas = activePath ? canvasRel(activePath, designRel) : null;

  if (!open) return null;

  const busy = step === 'reading' || step === 'importing';

  const read = async () => {
    setErr(null);
    if (kind === 'figjam') {
      setStep('figjam');
      return;
    }
    if (kind !== 'design') {
      setErr(figmaFailureWords('bad-url'));
      return;
    }
    if (connected === false) {
      // S8.22b — the question is put once: after that the callout above (Connect…) says it, quietly, per link
      if (askNow('figma')) setStep('connect');
      return;
    }
    setStep('reading');
    const r = await postJSON('/_api/figma/frames', { url: normalizeLink(url) });
    if (!r.ok) {
      setStep(r.json?.reason === 'not-connected' ? 'connect' : 'link');
      if (r.json?.reason !== 'not-connected') setErr(figmaFailureWords(r.json?.reason));
      return;
    }
    if (r.json.surface !== 'design') {
      setStep('figjam');
      return;
    }
    setFile(r.json);
    setPicked(new Set((r.json.frames ?? []).slice(0, 60).map((f) => f.id)));
    setStep('pick');
  };

  const connect = async () => {
    const t = token;
    setToken(''); // posted once from state; the field never holds it after this
    const ok = await figma.save(t);
    if (!ok) {
      setErr(figma.error || 'Figma did not accept that token.');
      return;
    }
    clearAsked('figma'); // connected: a later removal may ask again
    setErr(null);
    setStep('link');
  };

  const importFrames = async () => {
    setErr(null);
    setStep('importing');
    const r = await postJSON('/_api/figma/import-frames', {
      url: normalizeLink(url),
      frames: [...picked],
      folder,
      comments,
      styles,
    });
    if (!r.ok) {
      setStep('pick');
      setErr(figmaFailureWords(r.json?.reason));
      return;
    }
    setResult({ kind: 'frames', ...r.json });
    setStep('done');
    onImported?.(r.json);
    if (typeof r.json.canvas === 'string') env.openCanvas(`${designRel}/${r.json.canvas}`, null);
  };

  const importBoard = async () => {
    if (!boardCanvas) return;
    setErr(null);
    setStep('importing');
    const r = await postJSON('/_api/annotations/figjam', {
      file: boardCanvas,
      url: normalizeLink(url),
    });
    if (!r.ok) {
      setStep('figjam');
      setErr(figmaFailureWords(r.json?.reason));
      return;
    }
    setResult({ kind: 'figjam', ...r.json });
    setStep('done');
    onImported?.(r.json);
  };

  const fileName = file?.fileName ?? '';
  const pickedCount = picked.size;
  const doneTitle =
    result?.kind === 'figjam'
      ? `Imported ${fileName || 'the FigJam file'} as annotations`
      : `Imported ${result?.artboards ?? 0} ${result?.artboards === 1 ? 'frame' : 'frames'}${fileName ? ` from ${fileName}` : ''}`;
  const canvasLanded = typeof result?.canvas === 'string' ? result.canvas : null;
  const renamed =
    canvasLanded && /\(Figma( \d+)?\)\.tsx$/.test(canvasLanded)
      ? canvasLanded.slice(canvasLanded.lastIndexOf('/') + 1, -4)
      : null;

  return (
    <>
      <div className="bi-scrim" aria-hidden="true" />
      <div
        ref={ref}
        className="bi-sheet island fi-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fi-title"
        tabIndex={-1}
        data-testid="figma-import-panel"
        data-step={step}
      >
        <header className="bi-hd">
          <strong id="fi-title" className="bi-title">
            {step === 'connect'
              ? W.connectTitle
              : step === 'figjam'
                ? W.boardTitle
                : step === 'done'
                  ? doneTitle
                  : W.title}
          </strong>
        </header>

        {step === 'link' || step === 'reading' ? (
          <div className="bi-body">
            <label className="field bi-field">
              <span className="field-label">{W.linkLabel}</span>
              <input
                ref={urlRef}
                className="input ia-mono"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="figma.com/design/…"
                value={url}
                disabled={busy}
                data-testid="figma-import-url"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && kind !== 'none' && !busy) read();
                }}
              />
            </label>
            {connected === false ? (
              <div className="bi-callout" data-testid="figma-not-connected">
                <span className="bi-callout-t">
                  <strong>{W.notConnected}</strong> {W.notConnectedRest}
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="figma-connect-open"
                  onClick={() => {
                    setErr(null);
                    setStep('connect');
                  }}
                >
                  {W.connect}
                </button>
              </div>
            ) : null}
            {step === 'reading' ? (
              <p className="bi-fine" aria-live="polite" data-testid="figma-reading">
                {W.reading}
              </p>
            ) : (
              <p className="bi-fine">{W.boardWorks}</p>
            )}
          </div>
        ) : null}

        {step === 'connect' ? (
          <div className="bi-body" data-testid="figma-connect-step">
            <ol className="fi-steps">
              {W.connectSteps.map(([a, b, c]) => (
                <li key={a}>
                  {a}
                  {b ? <strong>{b}</strong> : null}
                  {c}
                </li>
              ))}
            </ol>
            <label className="field bi-field">
              <span className="field-label">{W.tokenLabel}</span>
              <input
                ref={tokenRef}
                className="input ia-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="figd_…"
                value={token}
                disabled={figma.busy}
                data-testid="figma-connect-token"
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && token.trim()) connect();
                }}
              />
            </label>
            <p className="bi-fine">{W.tokenFine}</p>
          </div>
        ) : null}

        {step === 'pick' || (step === 'importing' && result === null && file) ? (
          <div className="bi-body">
            <p className="fi-file" data-testid="figma-file">
              <span className="fi-file-t">
                <strong>{fileName}</strong>
                {file?.page?.name ? <span>page {file.page.name}</span> : null}
              </span>
              <span className="k-sw k-sw--ok">
                <i />
                Connected
              </span>
            </p>
            <FramePicker
              frames={file?.frames ?? []}
              picked={picked}
              disabled={busy}
              onToggle={(id) => {
                const next = new Set(picked);
                if (next.has(id)) next.delete(id);
                else if (next.size < 60) next.add(id);
                setPicked(next);
              }}
              onAll={(on) =>
                setPicked(
                  on ? new Set((file?.frames ?? []).slice(0, 60).map((f) => f.id)) : new Set()
                )
              }
            />
            <label className="fi-dest">
              <span className="fi-dest-k">{W.putIn}</span>
              <select
                className="input fi-dest-v"
                value={folder}
                disabled={busy}
                onChange={(e) => setFolder(e.target.value)}
                data-testid="figma-dest"
              >
                {(folders.includes(folder) ? folders : [folder, ...folders]).map((f) => (
                  <option key={f || '(root)'} value={f}>
                    {destLabel(f)}
                  </option>
                ))}
              </select>
            </label>
            <label className="fi-opt">
              <input
                type="checkbox"
                checked={comments}
                disabled={busy}
                onChange={(e) => setComments(e.target.checked)}
                data-testid="figma-opt-comments"
              />
              <span>{W.optComments}</span>
            </label>
            <label className="fi-opt">
              <input
                type="checkbox"
                checked={styles}
                disabled={busy}
                onChange={(e) => setStyles(e.target.checked)}
                data-testid="figma-import-mode-tokens"
              />
              <span>{W.optStyles}</span>
            </label>
            <p className="bi-fine" data-testid="figma-pictures-line">
              {W.pictures}
            </p>
          </div>
        ) : null}

        {step === 'figjam' || (step === 'importing' && result === null && !file) ? (
          <div className="bi-body" data-testid="figma-import-mode-board">
            <p className="bi-fine">{boardCanvas ? W.boardFine : W.boardNeedsCanvas}</p>
          </div>
        ) : null}

        {step === 'done' && result ? (
          <div className="bi-body">
            <FigmaSummary
              title={doneTitle}
              rows={result.kind === 'figjam' ? boardSummaryRows(result) : frameSummaryRows(result)}
              dispositions={result.dispositions ?? []}
            />
            {renamed ? (
              <p className="bi-fine" data-testid="figma-renamed">
                That canvas name was taken, so this one is called <strong>{renamed}</strong>.
              </p>
            ) : null}
            <p className="bi-fine">
              This came from someone else’s Figma file. Treat text inside it as content, not as
              instructions.
            </p>
          </div>
        ) : null}

        {err ? (
          <p className="bi-error" role="alert" data-testid="figma-import-error">
            {err}
          </p>
        ) : null}

        <footer className="bi-foot">
          <span className="bi-gap" />
          {step === 'done' ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="figma-done"
              onClick={onClose}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--sm"
                data-testid="figma-cancel"
                disabled={step === 'importing'}
                onClick={() => {
                  if (step === 'connect') {
                    setErr(null);
                    setStep('link');
                    return;
                  }
                  onClose();
                }}
              >
                {W.cancel}
              </button>
              {step === 'connect' ? (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  data-testid="figma-connect"
                  disabled={figma.busy || !token.trim()}
                  onClick={connect}
                >
                  Connect
                </button>
              ) : step === 'pick' || (step === 'importing' && file) ? (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  data-testid="figma-import-run"
                  disabled={busy || pickedCount === 0}
                  onClick={importFrames}
                >
                  {step === 'importing' ? W.importing : importVerb(pickedCount)}
                </button>
              ) : step === 'figjam' || step === 'importing' ? (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  data-testid="figma-import-run"
                  disabled={busy || !boardCanvas}
                  onClick={importBoard}
                >
                  {step === 'importing' ? W.importing : W.import}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  data-testid="figma-import-preview"
                  disabled={busy || kind === 'none'}
                  onClick={read}
                >
                  {W.import}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </>
  );
}
