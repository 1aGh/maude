// BrandUploadPanel — T12 (DDR-173). The in-app "Bring my existing brand"
// panel: upload a logo file → DDR-167 sanitize (`POST /_api/import-asset`)
// → DDR-173 typed-cue extraction (`POST /_api/import-brand`) → show the
// palette/fonts/logo the user can carry into `/design:setup-ds --from-brand`.
//
// Client never sends a filesystem PATH to either route — only bytes (native:
// via the existing `pick_media_file` Tauri command, which reads the file in
// Rust and returns bytes over IPC, mirroring app.jsx's `openFilePickerNative`;
// browser: via a plain `<input type=file>` + FileReader). This mirrors
// DDR-167's own entry-point trust table: "no server-side path resolution at
// all — the client never sends a path string, only bytes over loopback HTTP."

import { useRef, useState } from 'react';
import { isNativeApp, pickMediaFile } from '../github.js';

async function readFileAsArrayBuffer(file) {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolvePromise(reader.result);
    reader.onerror = () => reject(reader.error || new Error('file read failed'));
    reader.readAsArrayBuffer(file);
  });
}

/** Upload + extract. Returns `{ palette, fonts, logoRef, logoRasterRef, hadWordmarkText }` or throws. */
async function ingestBrandFile(bytes) {
  const importAssetRes = await fetch('/_api/import-asset', {
    method: 'POST',
    headers: { 'X-Import-Kind': 'svg' },
    body: bytes,
  });
  const importAssetBody = await importAssetRes.json().catch(() => ({}));
  if (!importAssetRes.ok || !importAssetBody.ok) {
    throw new Error(importAssetBody.error || `import failed (HTTP ${importAssetRes.status})`);
  }

  const importBrandRes = await fetch('/_api/import-brand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetPath: importAssetBody.path }),
  });
  const importBrandBody = await importBrandRes.json().catch(() => ({}));
  if (!importBrandRes.ok || !importBrandBody.ok) {
    throw new Error(importBrandBody.error || `extraction failed (HTTP ${importBrandRes.status})`);
  }
  return importBrandBody;
}

function PaletteSwatches({ palette }) {
  if (!palette?.length) {
    return <p className="brand-up-empty">No color values could be extracted from this file.</p>;
  }
  return (
    <ul className="brand-up-swatches" data-testid="brand-up-palette">
      {palette.map((color) => (
        <li key={color} className="brand-up-swatch" title={color}>
          <span className="brand-up-swatch-chip" style={{ background: color }} aria-hidden="true" />
          <span className="brand-up-swatch-value">{color}</span>
        </li>
      ))}
    </ul>
  );
}

function FontList({ fonts }) {
  if (!fonts?.length) {
    return (
      <p className="brand-up-empty">
        No recognized font names found — this is normal (font names inside the logo's own text are
        stripped for safety before extraction; the design system's typography will still be
        researched from your brief).
      </p>
    );
  }
  return (
    <ul className="brand-up-fonts" data-testid="brand-up-fonts">
      {fonts.map((f) => (
        <li key={f} className="brand-up-font-chip">
          {f}
        </li>
      ))}
    </ul>
  );
}

export default function BrandUploadPanel({ open, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null); // ingestBrandFile() response
  const fileInputRef = useRef(null);

  const runIngest = async (bytes) => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await ingestBrandFile(bytes);
      setResult(r);
    } catch (e) {
      setErr(e?.message || 'upload failed');
    } finally {
      setBusy(false);
    }
  };

  const pickNative = async () => {
    setBusy(true);
    setErr(null);
    try {
      const picked = await pickMediaFile();
      if (!picked?.bytes) {
        setBusy(false);
        return; // user cancelled
      }
      await runIngest(new Blob([new Uint8Array(picked.bytes)]));
    } catch (e) {
      setErr(e?.message || 'open failed');
      setBusy(false);
    }
  };

  const pickBrowser = () => fileInputRef.current?.click();

  const onBrowserFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    const buf = await readFileAsArrayBuffer(file);
    await runIngest(new Blob([buf]));
  };

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
        className="help-modal brand-up-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-up-modal-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="brand-up-modal-title">
            Bring my existing brand
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
          <p className="brand-up-note">
            Upload your logo (SVG) and Maude will pull out its color palette to seed your design
            system — nothing here is final, you'll confirm every choice during setup.
          </p>

          {!result && (
            <div className="brand-up-pick">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                data-testid="brand-up-pick-file"
                disabled={busy}
                onClick={isNativeApp() ? pickNative : pickBrowser}
              >
                {busy ? 'Working…' : 'Choose logo file…'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/svg+xml,.svg"
                style={{ display: 'none' }}
                onChange={onBrowserFileChosen}
              />
            </div>
          )}

          {err && (
            <p className="brand-up-error" data-testid="brand-up-error" role="alert">
              {err}
            </p>
          )}

          {result && (
            <div className="brand-up-result" data-testid="brand-up-result">
              <img
                className="brand-up-preview"
                src={`/${result.logoRasterRef || result.logoRef}`}
                alt="Uploaded logo preview"
              />
              <h4 className="brand-up-sechd">Palette</h4>
              <PaletteSwatches palette={result.palette} />
              <h4 className="brand-up-sechd">Fonts</h4>
              <FontList fonts={result.fonts} />
              <p className="brand-up-nextstep">
                Next: run <code>/design:setup-ds --from-brand {result.logoRef}</code> in the AI chat
                (or your terminal) to build a design system seeded from this upload.
              </p>
              <div className="brand-up-actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  data-testid="brand-up-copy-command"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      `/design:setup-ds --from-brand ${result.logoRef}`
                    )
                  }
                >
                  Copy command
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="brand-up-again"
                  onClick={() => {
                    setResult(null);
                    setErr(null);
                  }}
                >
                  Upload a different file
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
