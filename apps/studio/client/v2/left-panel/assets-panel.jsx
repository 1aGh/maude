// client/v2/left-panel/assets-panel.jsx — the Assets tab, the left panel's third (CONTRACT §7; 12 · ia-assets-panel,
// ia-assets-keys; 05 · es-panels-make). V2-4.4a hosted the library; S8.12 groups it by usage.
//
// Pictures come first, then Video and Sound. Hover or focus gives a tile's name and where it is used. A picture drags onto
// a frame (`tile-drag.js`) and ↵ places it on the selected artboard (`assets.place` → `placeAsset`, one edit-op, one undo
// step); right-click opens the same two actions as a menu (Place · Show details ⌘I). + and "From this Mac…" add from Finder,
// and files dropped on an empty Assets land here too. The rows are the index's (`use-assets.js`).
// NOT here yet: the wide Browse view and Not used (S8.13), details per kind (S8.21), search in pictures (S8.20), Generate
// (S8.16), Move to trash (S8.13).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadAsset } from '../../../asset-upload.ts';
import { mimeFromExt } from '../../dialogs/asset-picker.jsx';
import { isNativeApp, pickMediaFiles, pickedMediaSource } from '../../github.js';
import { Kbd, StIcon } from '../../shell/icons.jsx';
import { bindAssetsPanel } from '../assets/assets-bus.js';
import { AssetDetailsCard } from '../assets/details-card.jsx';
import { placeAsset, SELECT_ARTBOARD_LINE } from '../assets/place-asset.js';
import { AssetTile } from '../assets/tile.jsx';
import { AssetTileMenu, tileMenuItems } from '../assets/tile-menu.jsx';
import { useAssets } from '../assets/use-assets.js';
import { AskButton, copy, Empty } from '../empty/index.js';
import { getPaletteEnv } from '../search/search-env.js';

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

const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function AssetsPanel({
  designRel = '.design',
  readOnly = false,
  // S2.15 — where ↵ puts the picked tile (place-asset.js `placeTargetOf`), and the undo sink for that write
  placeTarget = null,
  // S8.12 — the selected artboard's name, for "Place in MVP zápasu"
  placeLabel = null,
  onRecord = undefined,
  fetchImpl = undefined,
}) {
  const { assets, reload } = useAssets({ fetchImpl });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [menu, setMenu] = useState(null);
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');
  const [dropping, setDropping] = useState(false);
  const alive = useRef(true);
  const rootRef = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const upload = async (run) => {
    setBusy(true);
    setErr('');
    try {
      const results = await run();
      const failed = results.filter((r) => !('path' in r)).length;
      if (failed) setErr(`${failed} of ${results.length} uploads failed`);
      if (results.length) await reload();
    } catch (e) {
      setErr(e?.message || 'Could not add files.');
    }
    setProgress(null);
    setBusy(false);
  };
  const add = () =>
    upload(() => (isNativeApp() ? addFilesNative(setProgress) : addFilesBrowser(setProgress)));

  const byPath = useMemo(() => new Map((assets || []).map((a) => [a.path, a])), [assets]);
  const shown = useMemo(() => filterAssets(assets || [], query), [assets, query]);
  const groups = useMemo(() => groupAssets(shown), [shown]);
  const url = (p) => `/${designRel}/${p}`;

  // ↵ / the menu's Place: the picked picture onto the selected artboard (or frame). One edit-op, one undo step.
  const place = useCallback(
    async (path) => {
      if (readOnly) return;
      const asset = byPath.get(path);
      if (!asset || asset.kind !== 'image') return;
      if (!placeTarget) {
        setErr(SELECT_ARTBOARD_LINE);
        return;
      }
      setErr('');
      const tile = Array.from(rootRef.current?.querySelectorAll?.('[data-asset]') ?? []).find(
        (el) => el.dataset.asset === path
      );
      const img = tile?.querySelector?.('img');
      const natural =
        img?.naturalWidth > 0 && img?.naturalHeight > 0
          ? { w: img.naturalWidth, h: img.naturalHeight }
          : undefined;
      const r = await placeAsset(
        { asset: path, target: placeTarget, natural },
        { record: onRecord }
      );
      if (!r.ok && alive.current) setErr(r.message);
    },
    [readOnly, byPath, placeTarget, onRecord]
  );
  const showDetails = useCallback(
    (path) => {
      const asset = byPath.get(path);
      if (asset) setDetails(path);
    },
    [byPath]
  );

  // The registry reaches the tab through the bus: the same functions the tile menu runs.
  const live = useRef({});
  live.current = { picked, place, showDetails };
  useEffect(
    () =>
      bindAssetsPanel({
        place: () => live.current.picked && void live.current.place(live.current.picked),
        details: () => live.current.picked && live.current.showDetails(live.current.picked),
        tileSelected: () =>
          !!live.current.picked && !!rootRef.current?.contains(document.activeElement),
      }),
    []
  );

  const openMenu = (e, asset) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const at = {
      left: e.clientX || r.left,
      top: e.clientY || r.top,
      bottom: e.clientY || r.bottom,
    };
    setMenu({ anchor: at, asset });
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuItems = menu ? tileMenuItems(menu.asset, { readOnly, placeLabel }) : [];
  const onMenuSelect = (id) => {
    const path = menu?.asset.path;
    setMenu(null);
    if (!path) return;
    if (id === 'place') void place(path);
    else if (id === 'details') showDetails(path);
  };

  const detailed = details ? byPath.get(details) : null;
  const env = getPaletteEnv();
  const canAsk = !readOnly && env.canAskAI?.() === true;
  const emptyWords = copy('es-panels-make.assets-none');

  const onDrop = (e) => {
    if (readOnly || !hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length)
      void upload(() => Promise.all(files.map((f) => uploadAsset(f, { onProgress: setProgress }))));
  };

  return (
    <div
      ref={rootRef}
      className="lp-assets"
      data-testid="assets-panel"
      data-dropping={dropping ? 'true' : undefined}
      onDragOver={(e) => {
        if (readOnly || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
      }}
      onDrop={onDrop}
    >
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
      {detailed ? <AssetDetailsCard asset={detailed} onClose={() => setDetails(null)} /> : null}
      <div className="lp-assets-list">
        {assets == null ? (
          <p className="lp-empty-b">Loading…</p>
        ) : assets.length === 0 ? (
          <Empty
            spot="image"
            spotW={168}
            copyId="es-panels-make.assets-none"
            testid="assets-empty"
            className="es-e--inpanel"
            actions={
              canAsk ? (
                <AskButton onClick={() => env.askAI?.(emptyWords.action)}>
                  {emptyWords.action}
                </AskButton>
              ) : null
            }
          />
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
                  <AssetTile
                    key={a.path}
                    asset={a}
                    url={url(a.path)}
                    picked={picked === a.path}
                    canDrag={!readOnly}
                    onPick={setPicked}
                    onMenu={openMenu}
                  />
                ))}
              </div>
            </section>
          ))
        )}
        {readOnly ? null : (
          // S3.15 (04 md-edit-image): the row under the photos — the same picker and upload as "Add files…"
          <button
            type="button"
            className="lp-mac"
            data-testid="assets-from-mac"
            disabled={busy}
            onClick={add}
          >
            <StIcon name="folder" size={14} />
            <span>From this Mac…</span>
          </button>
        )}
      </div>
      {query && assets ? (
        <p className="lp-foot">Searched {assets.length} assets — names and tags</p>
      ) : null}
      <AssetTileMenu state={menu} items={menuItems} onSelect={onMenuSelect} onClose={closeMenu} />
    </div>
  );
}
