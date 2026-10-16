// client/v2/left-panel/assets-panel.jsx — V2-4.4a: Assets, the left panel's third tab (CONTRACT §7; kit
// `CanvasesPanel tab="assets"`; 12 · ia-assets-panel, 05 · es-panels-make).
//
// It hosts the asset list that exists today — the content-addressed media under <designRoot>/assets/
// (GET /_api/assets, the list the Choose-media dialog shows), with the dialog's own Upload path (POST
// /_api/asset through asset-upload.ts, native picker on the desktop). Grouped by kind, searched by name.
// NOT here yet (S8): placing a tile on the selected artboard (↵ / drag), tags + "what's in pictures",
// Generate, the browse view and asset details — the empty state and the list are the contract's words.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadAsset } from '../../../asset-upload.ts';
import { mimeFromExt } from '../../dialogs/asset-picker.jsx';
import { isNativeApp, pickMediaFiles, pickedMediaSource } from '../../github.js';
import { Kbd, StIcon } from '../../shell/icons.jsx';

const GROUPS = [
  { kind: 'image', title: 'Photos' },
  { kind: 'video', title: 'Video' },
  { kind: 'audio', title: 'Sound' },
];

/** Case-insensitive name search. @returns the assets whose name contains every word typed. */
export function filterAssets(assets, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return assets;
  return assets.filter((a) => {
    const n = String(a.name || a.path || '').toLowerCase();
    return words.every((w) => n.includes(w));
  });
}

/** Photos / Video / Sound, empty groups left out. */
export function groupAssets(assets) {
  return GROUPS.map((g) => ({
    ...g,
    items: assets.filter((a) => (a.kind || 'image') === g.kind),
  })).filter((g) => g.items.length);
}

async function addFilesNative(onProgress) {
  const picked = await pickMediaFiles();
  const sources = (picked || []).map((p) => pickedMediaSource(p, mimeFromExt(p.name)));
  try {
    return await Promise.all(sources.map((f) => uploadAsset(f, { onProgress })));
  } finally {
    for (const src of sources) src.release();
  }
}

function addFilesBrowser(onProgress) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,audio/*';
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    const done = (v) => {
      if (input.isConnected) input.remove();
      resolve(v);
    };
    input.addEventListener('change', async () => {
      const files = input.files ? Array.from(input.files) : [];
      done(await Promise.all(files.map((f) => uploadAsset(f, { onProgress }))));
    });
    window.addEventListener('focus', () => setTimeout(() => done([]), 400), { once: true });
    input.click();
  });
}

export function AssetsPanel({ designRel = '.design', readOnly = false }) {
  const [assets, setAssets] = useState(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/_api/assets');
      const j = await r.json();
      if (alive.current) setAssets(j.ok ? j.assets : []);
    } catch {
      if (alive.current) setAssets([]);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const add = async () => {
    setBusy(true);
    setErr('');
    try {
      const results = await (isNativeApp()
        ? addFilesNative(setProgress)
        : addFilesBrowser(setProgress));
      const failed = results.filter((r) => !('path' in r)).length;
      if (failed) setErr(`${failed} of ${results.length} uploads failed`);
      if (results.length) await load();
    } catch (e) {
      setErr(e?.message || 'Could not add files.');
    }
    setProgress(null);
    setBusy(false);
  };

  const shown = useMemo(() => filterAssets(assets || [], query), [assets, query]);
  const groups = useMemo(() => groupAssets(shown), [shown]);
  const url = (p) => `/${designRel}/${p}`;

  return (
    <div className="lp-assets" data-testid="assets-panel">
      <div className="lp-head-row">
        <label className="lp-find">
          <StIcon name="search" size={13} />
          <input
            type="search"
            data-testid="assets-search"
            placeholder="Search assets"
            aria-label="Search assets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? null : <Kbd>⌘K</Kbd>}
        </label>
        {readOnly ? null : (
          <button
            type="button"
            className="st-iconbtn lp-add"
            data-testid="assets-add"
            aria-label="Add files…"
            data-tip="Add files…"
            disabled={busy}
            onClick={add}
          >
            <StIcon name="plus" size={15} />
          </button>
        )}
      </div>
      {busy ? (
        <p className="lp-note" role="status">
          {progress == null ? 'Adding…' : `Adding… ${Math.round(progress * 100)}%`}
        </p>
      ) : null}
      {err ? (
        <p className="lp-note lp-note--err" role="alert">
          {err}
        </p>
      ) : null}
      <div className="lp-assets-list">
        {assets == null ? (
          <p className="lp-empty-b">Loading…</p>
        ) : assets.length === 0 ? (
          <div className="lp-empty" data-testid="assets-empty">
            <p className="lp-empty-t">No images or footage yet.</p>
            <p className="lp-empty-b">
              Drop photos, logos, video or music here — or anywhere on the canvas.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="lp-empty" data-testid="assets-nohits">
            <p className="lp-empty-t">Nothing called “{query}”.</p>
            <p className="lp-empty-b">Try another word — search reads names and tags.</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.kind} aria-label={g.title}>
              <p className="lp-group">
                <span>{g.title}</span>
                <span className="lp-count">{g.items.length}</span>
              </p>
              <div className="lp-grid">
                {g.items.map((a) => (
                  <button
                    type="button"
                    key={a.path}
                    className="lp-tile"
                    data-testid="assets-tile"
                    aria-pressed={picked === a.path}
                    title={`${a.name} · ${Math.max(1, Math.round(a.size / 1024))} KB`}
                    onClick={() => setPicked(a.path)}
                  >
                    {g.kind === 'video' ? (
                      <video className="lp-thumb" src={url(a.path)} muted playsInline />
                    ) : g.kind === 'audio' ? (
                      <span className="lp-thumb lp-thumb--sound">
                        <StIcon name="resolve" size={16} />
                      </span>
                    ) : (
                      <img className="lp-thumb" src={url(a.path)} alt={a.name} loading="lazy" />
                    )}
                    <span className="lp-tile-name">{a.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      {query && assets ? (
        <p className="lp-foot">Searched {assets.length} assets — names and tags</p>
      ) : null}
    </div>
  );
}
