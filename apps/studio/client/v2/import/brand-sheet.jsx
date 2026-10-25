// client/v2/import/brand-sheet.jsx — S8.18: Import a brand (canvas 12 · ia-brand-steps, ia-brand).
//
// One sheet from the drop to the result: drop a logo and/or type a website → Reading (one row per
// source, saying which one it is on) → the result (brand-result.jsx). When the website does not
// answer, the logo's colours stay and Try again is the one action.
//
// Bytes only (DDR-167): a logo goes to `/_api/import-asset` as bytes, never as a path, then
// `/_api/import-brand {assetPath}` with the server's own path. A website goes to
// `/_api/import-brand {url}` — the server reads it through the fetch-asset gate and answers with
// typed values only (DDR-173). Both routes are main-origin only and refuse a viewer.
//
// The v1 BrandUploadPanel testids are re-emitted here (BrandUploadPanel.jsx is a shim).

import { useEffect, useRef, useState } from 'react';
import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { isNativeApp, pickMediaFile } from '../../github.js';
import { StIcon } from '../../shell/icons.jsx';
import { getPaletteEnv } from '../search/search-env.js';
import { menuRunner } from '../shell/menu-runner.js';
import { useModalFocus } from '../shell/modal-focus.js';
import BrandResult from './brand-result.jsx';
import { coloursWords, handOff, mergeBrand, siteReason, typedHost } from './brand-model.js';

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/** A logo's bytes → its typed cues (`{ palette, fonts, logoRef, logoRasterRef, hadWordmarkText }`). */
async function readLogo(bytes) {
  const asset = await fetch('/_api/import-asset', {
    method: 'POST',
    headers: { 'X-Import-Kind': 'svg' },
    body: bytes,
  });
  const assetBody = await asset.json().catch(() => ({}));
  if (!asset.ok || !assetBody.ok) {
    throw new Error(
      asset.status === 415 || asset.status === 400
        ? "That file isn't a logo Maude can read — use an SVG."
        : "Couldn't read the logo."
    );
  }
  const { res, json } = await postJSON('/_api/import-brand', { assetPath: assetBody.path });
  if (!res.ok || !json.ok) throw new Error("Couldn't read the logo.");
  return json;
}

/** A website → `{ ok, host, palette, fonts }` or `{ ok: false, host, reason }` (never throws). */
async function readSite(url) {
  try {
    const { json } = await postJSON('/_api/import-brand', { url });
    if (json?.site) return json.site;
    return { ok: false, host: typedHost(url), reason: 'unreachable' };
  } catch {
    return { ok: false, host: typedHost(url), reason: 'unreachable' };
  }
}

function Row({ state, children, testid }) {
  const word = { read: 'Read', reading: 'Reading…', failed: "Couldn't read" }[state] ?? '';
  const sw = { read: 'ok', reading: 'busy', failed: 'warn' }[state] ?? 'off';
  return (
    <p className="bi-readrow" data-testid={testid} data-state={state}>
      <span className={`k-sw k-sw--${sw}`}>
        <i />
        {word}
      </span>
      <span>{children}</span>
    </p>
  );
}

export default function BrandSheet({ open, onClose }) {
  const [step, setStep] = useState('input'); // input · reading · result
  const [logoFile, setLogoFile] = useState(null); // { name, blob }
  const [website, setWebsite] = useState('');
  const [logo, setLogo] = useState({ state: 'idle' });
  const [site, setSite] = useState({ state: 'idle' });
  const [brand, setBrand] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [over, setOver] = useState(false);
  const fileInputRef = useRef(null);
  const websiteRef = useRef(null);
  const ref = useModalFocus({ open, onClose, initialRef: websiteRef });

  useEffect(() => {
    if (open) return;
    setStep('input');
    setLogo({ state: 'idle' });
    setSite({ state: 'idle' });
    setBrand(null);
    setErr(null);
    setNote(null);
  }, [open]);

  if (!open) return null;

  const host = typedHost(website);
  const wantsSite = !!host;
  const siteFailed = site.state === 'failed';
  const busy = logo.state === 'reading' || site.state === 'reading';

  const chooseFile = async () => {
    setErr(null);
    if (isNativeApp()) {
      try {
        const picked = await pickMediaFile();
        if (!picked?.bytes) return; // cancelled
        setLogoFile({
          name: picked.name || 'logo.svg',
          blob: new Blob([new Uint8Array(picked.bytes)]),
        });
      } catch {
        setErr("Couldn't open that file.");
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const takeFile = (file) => {
    if (!file) return;
    setErr(null);
    setLogoFile({ name: file.name || 'logo.svg', blob: file });
  };

  const runSite = async () => {
    setSite({ state: 'reading' });
    const r = await readSite(website);
    setSite(r.ok ? { state: 'read', result: r } : { state: 'failed', result: r });
    return r;
  };

  const finish = (logoResult, siteResult) => {
    setBrand(mergeBrand(logoResult, siteResult?.ok ? siteResult : null));
    setStep('result');
  };

  const start = async () => {
    setErr(null);
    setStep('reading');
    const logoJob = logoFile
      ? (async () => {
          setLogo({ state: 'reading' });
          try {
            const r = await readLogo(logoFile.blob);
            setLogo({ state: 'read', result: r });
            return r;
          } catch (e) {
            setLogo({ state: 'failed', error: e?.message });
            throw e;
          }
        })()
      : Promise.resolve(null);
    const siteJob = wantsSite ? runSite() : Promise.resolve(null);
    const [l, s] = await Promise.allSettled([logoJob, siteJob]);
    if (l.status === 'rejected') {
      setErr(l.reason?.message || "Couldn't read the logo.");
      setStep('input');
      return;
    }
    const sr = s.status === 'fulfilled' ? s.value : null;
    if (sr && !sr.ok) return; // stays on Reading with the callout: Try again / Continue with the logo
    finish(l.value, sr);
  };

  const tryAgain = async () => {
    const r = await runSite();
    if (r.ok) finish(logo.result ?? null, r);
  };

  const useAsStyle = async () => {
    const r = handOff(brand, { actions: ACTIONS_BY_ID, runner: menuRunner, env: getPaletteEnv() });
    if (r.via === 'copy') {
      try {
        await navigator.clipboard?.writeText(r.text);
        setNote('Copied the command — paste it in the AI chat or your terminal.');
      } catch {
        setNote(`Run ${r.text} in the AI chat or your terminal.`);
      }
      return;
    }
    onClose();
  };

  const resultView = step === 'result' && brand;
  return (
    <>
      <div className="bi-scrim" aria-hidden="true" />
      <div
        ref={ref}
        className={`bi-sheet island${resultView ? ' bi-sheet--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bi-title"
        tabIndex={-1}
        data-testid="brand-sheet"
        data-step={siteFailed && step === 'reading' ? 'site-failed' : step}
      >
        <header className="bi-hd">
          <strong id="bi-title" className="bi-title">
            {resultView ? "Use this brand as the project's style?" : 'Import a brand'}
          </strong>
        </header>

        {step === 'input' ? (
          <div className="bi-body">
            <fieldset
              className={`bi-drop${over ? ' is-over' : ''}`}
              aria-label="Logo"
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                takeFile(e.dataTransfer?.files?.[0]);
              }}
            >
              <span className="bi-drop-ic" aria-hidden="true">
                {logoFile ? '✓' : '+'}
              </span>
              <span className="bi-drop-t">
                <strong>{logoFile ? logoFile.name : 'Drop a logo here'}</strong>
                <span>{logoFile ? 'Logo · or drop another — SVG' : 'SVG'}</span>
              </span>
              <button
                type="button"
                className="btn btn--sm"
                data-testid="brand-up-pick-file"
                onClick={chooseFile}
              >
                Choose logo file…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/svg+xml,.svg"
                hidden
                onChange={(e) => {
                  takeFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </fieldset>
            <label className="field bi-field">
              <span className="field-label">Website (optional)</span>
              <input
                ref={websiteRef}
                className="input"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="studio-brno.cz"
                value={website}
                data-testid="brand-website"
                onChange={(e) => setWebsite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (logoFile || wantsSite)) start();
                }}
              />
            </label>
            {err ? (
              <p className="bi-error" role="alert" data-testid="brand-up-error">
                {err}
              </p>
            ) : null}
            <p className="bi-fine">
              Colours come from the logo; fonts and more colours from the website. Nothing changes
              until you choose.
            </p>
          </div>
        ) : null}

        {step === 'reading' ? (
          <div className="bi-body" data-testid="brand-reading" aria-live="polite">
            {logoFile ? (
              <Row state={logo.state} testid="brand-read-logo">
                <strong>{logoFile.name}</strong>
                {logo.state === 'read'
                  ? ` — ${coloursWords(logo.result?.palette?.length ?? 0)}`
                  : ''}
              </Row>
            ) : null}
            {/* a failed site is the callout below, said once (ia-brand-steps step 3: the logo row + the callout) */}
            {wantsSite && !siteFailed ? (
              <Row state={site.state} testid="brand-read-site">
                <strong>{site.result?.host ?? host}</strong> — fonts and colours
              </Row>
            ) : null}
            {siteFailed ? (
              <div
                className="bi-callout"
                role="alert"
                data-testid="brand-site-failed"
                data-reason={site.result?.reason}
              >
                <span className="bi-callout-ic" aria-hidden="true">
                  <StIcon name="warn" size={14} />
                </span>
                <span className="bi-callout-t">
                  <strong>Couldn't read {site.result?.host ?? host}.</strong>{' '}
                  {siteReason(site.result?.reason)}
                  {logoFile ? " The logo's colours are kept." : ''}
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="brand-try-again"
                  onClick={tryAgain}
                >
                  Try again
                </button>
              </div>
            ) : (
              <span className="bi-prog" aria-hidden="true">
                <b />
              </span>
            )}
            <p className="bi-fine">
              {siteFailed
                ? 'Without the site, fonts stay as they are — pick one on the next step.'
                : 'Usually under 10 seconds. The site is read once; nothing is sent to it.'}
            </p>
          </div>
        ) : null}

        {resultView ? (
          <BrandResult
            brand={brand}
            logoName={logoFile?.name ?? null}
            onRole={(colours) => setBrand({ ...brand, colours })}
            onStartOver={() => {
              setStep('input');
              setBrand(null);
              setLogo({ state: 'idle' });
              setSite({ state: 'idle' });
            }}
          />
        ) : null}

        {note ? (
          <p className="bi-fine" role="status" data-testid="brand-note">
            {note}
          </p>
        ) : null}

        <footer className="bi-foot">
          <span className="bi-gap" />
          <button
            type="button"
            className="btn btn--sm"
            data-testid="brand-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          {step === 'input' ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="brand-import"
              disabled={!logoFile && !wantsSite}
              onClick={start}
            >
              Import
            </button>
          ) : null}
          {step === 'reading' && !siteFailed ? (
            <button type="button" className="btn btn--sm btn--primary" disabled>
              Import
            </button>
          ) : null}
          {step === 'reading' && siteFailed && logo.state === 'read' ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="brand-continue-logo"
              disabled={busy}
              onClick={() => finish(logo.result, null)}
            >
              Continue with the logo
            </button>
          ) : null}
          {resultView ? (
            <button
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="brand-use-style"
              onClick={useAsStyle}
            >
              Use as the project's style
            </button>
          ) : null}
        </footer>
      </div>
    </>
  );
}
