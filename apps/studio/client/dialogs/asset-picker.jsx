// dialogs/asset-picker.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useState } from 'react';
import { uploadAsset } from '../../asset-upload.ts';
import { isNativeApp, pickMediaFile, pickMediaFiles, pickedMediaSource } from '../github.js';
import { StIcon } from '../shell/icons.jsx';

// feature-bulk-media-insert — best-effort MIME guess from a filename extension.
// Only used to classify a natively-picked file (Rust returns `{name, bytes}`,
// no type) for the destination-toggle's image/video/audio split; the actual
// upload is always magic-byte-sniffed server-side, so a wrong guess here
// can't misrepresent what gets stored, only which picker UI state it shows.
export const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4', ogg: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', oga: 'audio/ogg', opus: 'audio/opus',
};

export function mimeFromExt(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

// feature-element-editing-robustness Stage F1 — AssetPicker. A shell modal that
// lists the versioned content-addressed media under <designRoot>/assets/ (via the
// main-origin-only GET /_api/assets) and lets the user pick one — or upload a new
// file (POST /_api/asset, content-addressed) — for a media Replace / image
// Insert. Thumbnails load from the main origin's designRoot static serve
// (/${designRel}/${asset.path}); never a remote hotlink (the CSP split origin
// blocks those — memory reference_canvas_images_download_first).
export function AssetPicker({
  designRel,
  onPick,
  onClose,
  multiple = false,
  hasArtboardAnchor = false,
  onPickMany,
}) {
  const [assets, setAssets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState(null);
  // feature-bulk-media-insert — multi-select state. `kindByPath` merges the
  // fetched listing with freshly uploaded assets (the upload response carries
  // no `kind`, so a just-uploaded file's kind comes from its own File.type).
  const [selected, setSelected] = useState(() => new Set());
  const [kindByPath, setKindByPath] = useState({});
  const [destination, setDestination] = useState(hasArtboardAnchor ? 'artboard' : 'annotation');

  useEffect(() => {
    let alive = true;
    fetch('/_api/assets')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const list = j.ok ? j.assets : [];
        setAssets(list);
        setKindByPath((prev) => {
          const next = { ...prev };
          for (const a of list) next[a.path] = a.kind;
          return next;
        });
      })
      .catch(() => alive && setAssets([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const hasNonImageSelected = Array.from(selected).some((p) => (kindByPath[p] || 'image') !== 'image');
  const artboardDisabled = !hasArtboardAnchor || hasNonImageSelected;
  const artboardDisabledReason = !hasArtboardAnchor
    ? 'No artboard on this canvas'
    : hasNonImageSelected
      ? 'Video/audio can only be added as annotations'
      : '';
  // Force off "Add to artboard" the moment it becomes unavailable (e.g. a
  // video gets added to an until-now all-image selection).
  useEffect(() => {
    if (artboardDisabled && destination === 'artboard') setDestination('annotation');
  }, [artboardDisabled, destination]);

  const toggleSelected = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Shared upload core — both the single-pick `doUpload` and the multi-file
  // `doUploadMany` post through here, so neither duplicates the request shape.
  // The shared client chunks a large clip (issue #126) — the same path the
  // canvas drop takes, so the picker isn't left at the one-shot cap.
  const uploadOne = async (f) => {
    const res = await uploadAsset(f, { onProgress: setProgress });
    setProgress(null);
    return 'path' in res ? { ok: true, path: res.path } : { ok: false, error: res.error };
  };

  const doUpload = async (f) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    const res = await uploadOne(f);
    setBusy(false);
    if (res.ok) onPick(res.path);
    else setErr(res.error);
  };

  const kindOfMime = (mime) => {
    if (typeof mime === 'string' && mime.startsWith('video/')) return 'video';
    if (typeof mime === 'string' && mime.startsWith('audio/')) return 'audio';
    return 'image';
  };

  // Multi-file upload — each file uploads independently/concurrently (the
  // route is idempotent + content-addressed, so no ordering concern); every
  // one that succeeds joins the selection as it resolves.
  const doUploadMany = async (files) => {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    const results = await Promise.all(
      files.map((f) => uploadOne(f).then((r) => ({ ...r, file: f })))
    );
    setBusy(false);
    const ok = results.filter((r) => r.ok);
    const failed = results.length - ok.length;
    if (failed > 0) setErr(`${failed} of ${results.length} uploads failed`);
    if (ok.length) {
      setKindByPath((prev) => {
        const next = { ...prev };
        for (const r of ok) next[r.path] = kindOfMime(r.file.type);
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of ok) next.add(r.path);
        return next;
      });
    }
  };

  // Native desktop (Tauri WKWebView) — an HTML <input type=file> won't present
  // the file panel AT ALL here, so route through the same native-dialog spine
  // export uses (dogfood: "pri exportu to uz umime"). The Rust pick_media_file
  // command opens an OS open-dialog + reads the bytes; we POST them to
  // /_api/asset (magic-byte sniffed, so name/ext aren't trusted).
  const openFilePickerNative = async () => {
    setBusy(true);
    setErr(null);
    try {
      // The picker hands back tokens, not bytes; each source reads its file in
      // slices as the upload needs them (issue #126 — a 500 MB clip must not
      // cross IPC whole). The server sniffs the bytes, so the ext-derived type
      // only routes small images to the one-shot path.
      if (multiple) {
        const picked = await pickMediaFiles();
        const sources = (picked || []).map((p) => pickedMediaSource(p, mimeFromExt(p.name)));
        setBusy(false);
        try {
          if (sources.length) await doUploadMany(sources);
        } finally {
          for (const src of sources) src.release();
        }
        return;
      }
      const picked = await pickMediaFile();
      if (picked) {
        // (doUpload sets its own busy=false.)
        const src = pickedMediaSource(picked, mimeFromExt(picked.name));
        try {
          await doUpload(src);
        } finally {
          src.release();
        }
        return;
      }
    } catch (e) {
      setErr(e?.message || 'open failed');
    }
    setBusy(false); // only reached on cancel / error (doUpload/doUploadMany own the success path)
  };

  // Browser — imperative <input>, mirrors the proven replaceMediaViaPicker
  // pattern (freshly created, appended to document.body, clicked synchronously in
  // the gesture). Off-screen (not display:none) so it lays out.
  const openFilePicker = () => {
    if (isNativeApp()) {
      openFilePickerNative();
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    if (multiple) input.multiple = true;
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    const cleanup = () => {
      if (input.isConnected) input.remove();
    };
    window.addEventListener('focus', () => setTimeout(cleanup, 300), { once: true });
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      if (!files.length) return;
      if (multiple) doUploadMany(files);
      else doUpload(files[0]);
    });
    input.click();
  };

  const assetUrl = (p) => `/${designRel}/${p}`;

  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-dialog st-asset-picker" role="dialog" aria-modal="true" aria-label="Choose media">
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Choose media</span>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <StIcon name="x" size={15} />
          </button>
        </div>
        <div className="st-dialog-bd">
          <div className="st-ap-toolbar">
            <button type="button" className="st-btn" onClick={openFilePicker} disabled={busy}>
              {busy
                ? progress == null
                  ? 'Uploading…'
                  : `Uploading… ${Math.round(progress * 100)}%`
                : 'Upload…'}
            </button>
            {err && <span className="st-ap-err">{err}</span>}
          </div>
          <div className="st-ap-grid">
            {assets == null ? (
              <div className="st-ap-empty">Loading…</div>
            ) : assets.length === 0 ? (
              <div className="st-ap-empty">No assets yet — upload one.</div>
            ) : (
              assets.map((a) => {
                const isSelected = multiple && selected.has(a.path);
                return (
                  <button
                    type="button"
                    key={a.path}
                    className="st-ap-cell"
                    data-selected={isSelected ? 'true' : undefined}
                    aria-pressed={multiple ? isSelected : undefined}
                    title={`${a.name} · ${Math.max(1, Math.round(a.size / 1024))} KB`}
                    onClick={() => (multiple ? toggleSelected(a.path) : onPick(a.path))}
                  >
                    {multiple && (
                      <span className="st-ap-check" aria-hidden="true">
                        {isSelected ? <StIcon name="check" size={12} /> : null}
                      </span>
                    )}
                    {a.kind === 'video' ? (
                      <video className="st-ap-thumb" src={assetUrl(a.path)} muted playsInline />
                    ) : (
                      <img className="st-ap-thumb" src={assetUrl(a.path)} alt={a.name} loading="lazy" />
                    )}
                    <span className="st-ap-name">{a.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        {multiple && selected.size > 0 && (
          <div className="st-dialog-ft st-ap-confirm">
            <span className="st-ap-count">{selected.size} selected</span>
            <div className="st-ap-seg" role="radiogroup" aria-label="Insert as">
              <button
                type="button"
                className="st-ap-seg-btn"
                aria-pressed={destination === 'artboard'}
                disabled={artboardDisabled}
                onClick={() => setDestination('artboard')}
              >
                Add to artboard
              </button>
              <button
                type="button"
                className="st-ap-seg-btn"
                aria-pressed={destination === 'annotation'}
                onClick={() => setDestination('annotation')}
              >
                Add as annotation
              </button>
            </div>
            {artboardDisabled && <span className="st-ap-dest-note">{artboardDisabledReason}</span>}
            <span className="st-ap-confirm-spacer" />
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onPickMany?.(Array.from(selected), destination)}
            >
              Insert
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
