// client/v2/export/native-save.js — S8.23: the page side of the desktop app's export doors
// (apps/desktop/src-tauri/src/export_save.rs).
//
//   save({ jobId, filename, saveTo }) → `save_export`         writes the finished job to this Mac;
//                                                              `{ ok, path }`, `{ ok:false, reason:'cancelled' }`
//   reveal(path)                      → `reveal_export`        Finder with that file selected — only a path
//                                                              `save` returned in this run of the app
//   copyPng(blob)                     → navigator.clipboard, then `clipboard_write_png` (Q13: WKWebView
//                                                              refuses ClipboardItem outside some gestures)
//
// The bytes of a save never pass through the page: Rust fetches the job from this project's own server by
// id. `saveTo` is ExportSpecV2's (`ask` | `remembered` | `downloads`; absent = ask). Rust is the gate (the
// caller is this project's tab in front; reveal refuses what it did not write; the PNG is capped and
// checked); the checks here only spare a round trip.
//
// In a browser tab there is no shell: `available` is false, `save` falls back to a download of the job
// (`/_api/export-jobs/download?id=`), `reveal` answers `{ ok:false, reason:'browser' }` (callers hide Show
// in Finder), and `copyPng` uses `navigator.clipboard` alone.
//
// Pure but for `window`, which `nativeSave(win)` reads; `invoke`, `download` and `clipboard` can be
// injected.

/** The Tauri commands, as `lib.rs` registers them. */
export const SAVE_COMMANDS = Object.freeze({
  save: 'save_export',
  reveal: 'reveal_export',
  copyPng: 'clipboard_write_png',
});

export const SAVE_TO = Object.freeze(['ask', 'remembered', 'downloads']);

/** Mirrors export_save.rs `MAX_CLIPBOARD_PNG`. */
export const MAX_CLIPBOARD_PNG = 64 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JOB_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Bytes that start like a PNG and fit under the cap (Rust also checks IHDR and IEND). */
export function looksLikePng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > MAX_CLIPBOARD_PNG)
    return false;
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

function invokeOf(win) {
  const t = win?.__TAURI__;
  return t?.core?.invoke ? (cmd, args) => t.core.invoke(cmd, args) : null;
}

const words = (e) => (typeof e === 'string' ? e : String(e?.message ?? e));

/** The browser fallback: fetch the job from this server and hand it to `<a download>`. */
async function browserDownload(win, jobId, filename) {
  const res = await win.fetch(`/_api/export-jobs/download?id=${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`The export isn't ready to download (${res.status}).`);
  const url = win.URL.createObjectURL(await res.blob());
  const a = win.document.createElement('a');
  a.href = url;
  a.download = filename || 'export';
  win.document.body.appendChild(a);
  a.click();
  a.remove();
  win.URL.revokeObjectURL(url);
}

async function bytesOf(png) {
  if (png instanceof Uint8Array) return png;
  if (png instanceof ArrayBuffer) return new Uint8Array(png);
  if (png && typeof png.arrayBuffer === 'function') return new Uint8Array(await png.arrayBuffer());
  return null;
}

/**
 * The export doors for this page. `opts.invoke` overrides the Tauri global, `opts.download(jobId, filename)`
 * the browser fallback, `opts.clipboard` `navigator.clipboard`, `opts.ClipboardItem` the constructor (tests).
 */
export function nativeSave(win = typeof window !== 'undefined' ? window : null, opts = {}) {
  const invoke = opts.invoke ?? invokeOf(win);
  const download = opts.download ?? ((jobId, filename) => browserDownload(win, jobId, filename));
  const clipboard = opts.clipboard ?? win?.navigator?.clipboard ?? null;
  const Item = opts.ClipboardItem ?? win?.ClipboardItem ?? null;

  return {
    available: !!invoke,

    /** `{ ok:true, path }` (path null in a browser: the file went to the browser's downloads). */
    async save({ jobId, filename, saveTo } = {}) {
      if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) {
        return { ok: false, reason: 'refused', error: 'Invalid export job id.' };
      }
      if (saveTo != null && !SAVE_TO.includes(saveTo)) {
        return { ok: false, reason: 'refused', error: 'Unknown place to save to.' };
      }
      if (!invoke) {
        try {
          await download(jobId, filename);
          return { ok: true, path: null, downloaded: true };
        } catch (e) {
          return { ok: false, reason: 'refused', error: words(e) };
        }
      }
      try {
        const args = { jobId, filename: filename || 'export' };
        if (saveTo) args.saveTo = saveTo;
        const path = await invoke(SAVE_COMMANDS.save, args);
        return path ? { ok: true, path } : { ok: false, reason: 'cancelled' };
      } catch (e) {
        return { ok: false, reason: 'refused', error: words(e) };
      }
    },

    async reveal(path) {
      if (!invoke) return { ok: false, reason: 'browser' };
      if (typeof path !== 'string' || path === '') {
        return { ok: false, reason: 'refused', error: "Maude didn't save that file." };
      }
      try {
        await invoke(SAVE_COMMANDS.reveal, { path });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'refused', error: words(e) };
      }
    },

    /** `png`: a Blob, ArrayBuffer or Uint8Array of one PNG. `via` says which path wrote it. */
    async copyPng(png) {
      if (clipboard?.write && Item) {
        try {
          const blob =
            png && typeof png.arrayBuffer === 'function' && png.type === 'image/png'
              ? png
              : new Blob([await bytesOf(png)], { type: 'image/png' });
          await clipboard.write([new Item({ 'image/png': blob })]);
          return { ok: true, via: 'browser' };
        } catch {
          // WKWebView refuses outside a gesture it trusts — the shell writes it instead.
        }
      }
      if (!invoke) return { ok: false, reason: 'refused', error: "Couldn't copy the image." };
      const bytes = await bytesOf(png);
      if (!bytes || !looksLikePng(bytes)) {
        const big = bytes && bytes.length > MAX_CLIPBOARD_PNG;
        return {
          ok: false,
          reason: 'refused',
          error: big
            ? 'That image is too big to copy. Export it instead.'
            : "That isn't a PNG image.",
        };
      }
      try {
        // A Uint8Array as the whole argument travels as the raw IPC body, not a JSON array.
        await invoke(SAVE_COMMANDS.copyPng, bytes);
        return { ok: true, via: 'shell' };
      } catch (e) {
        return { ok: false, reason: 'refused', error: words(e) };
      }
    },
  };
}
