// client/v2/cloud/browser-door.js — S9.17b: the studio half of the 409 browser door.
//
// A mint door (access/scope.ts `peerTokenDoor`) answers a Can view account with
// `409 {reason:'browser-door', url}`: no peer token, so no local copy — the app opens the cell itself
// in a `c-*` tab (Rust `open_cell_tab`, decision v2-S9.17 cell tabs). The `url` is untrusted server
// data. `cellDoorUrl` holds it to the SAME shape Rust `cell_door` (windows.rs) does — https, no port
// or userinfo, one label under the compiled-in cloud zone (never `canvas`, `view-*`, `canvas-*`),
// path `/` or `/c/<canvas>` (project_resolve.rs `validate_open_param`), no query, no fragment — and
// rebuilds it from its parts. Anything else is null, and null goes nowhere: not to `invoke`, not to a
// browser. Rust validates again; this copy keeps a hostile url off the IPC and out of the page.
//
// Pure (no React, no fetch): the server (cloud/endpoints.ts) relays only what passes here, and the
// page (Home, a project tab) checks once more before it calls the shell.

/** The cloud zone, compiled in like Rust `CELL_ZONE` — never read from config. */
export const CELL_ZONE = 'cloud.maude.sh';

/** Rust `CELL_TABS_UNSUPPORTED`: no per-account cookie store here (macOS < 14, not a Mac). */
export const CELL_TABS_UNSUPPORTED = 'Open this project in your browser.';

/** Rust `cell_door`'s refusal — the one sentence a refused door shows. */
export const DOOR_REFUSED = "That isn't a Maude Cloud project address.";

const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Rust `char::is_control` (Cc) + `is_whitespace`, `\`, `@` — and `?` / `#`, which Rust refuses as a
// query or fragment even when empty (WHATWG would report an empty one as no query at all).
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control range IS what is refused
const BANNED = /[\s\u0000-\u001f\u007f-\u009f\\@?#]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control range IS what is refused
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f-\u009f\\]/;

/** windows.rs `cell_project_id`: a DNS label, and never one of the zone's own non-cell hosts. */
function cellProjectId(label) {
  return (
    label.length <= 63 &&
    LABEL.test(label) &&
    label !== 'canvas' &&
    !label.startsWith('view-') &&
    !label.startsWith('canvas-')
  );
}

/** project_resolve.rs `validate_open_param`: a design-root-relative canvas path, or null. */
function openParam(open) {
  if (!open || open.length > 512 || CONTROL_OR_BACKSLASH.test(open) || /^[A-Za-z]:/.test(open))
    return null;
  const rel = open.startsWith('.design/') ? open.slice('.design/'.length) : open;
  if (rel.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return rel;
}

function decodeSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

/**
 * A browser door's `url` → the cell front door it names, rebuilt from its parts; null for
 * anything else.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function cellDoorUrl(raw) {
  if (typeof raw !== 'string' || raw === '' || BANNED.test(raw)) return null;
  if (new TextEncoder().encode(raw).length > 2048) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '')
    return null;
  const suffix = `.${CELL_ZONE}`;
  if (!u.hostname.endsWith(suffix)) return null;
  const project = u.hostname.slice(0, -suffix.length);
  if (!cellProjectId(project)) return null;
  const origin = `https://${project}.${CELL_ZONE}`;
  if (u.origin !== origin) return null;
  if (u.pathname === '' || u.pathname === '/') return `${origin}/`;
  if (!u.pathname.startsWith('/c/')) return null;
  const segs = u.pathname.slice(3).split('/').map(decodeSegment);
  if (segs.some((s) => s === null || s.includes('/') || s.includes('\\'))) return null;
  const canvas = openParam(segs.join('/'));
  if (!canvas) return null;
  return `${origin}/c/${canvas.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * A response body → `{url}` when it is a browser door with a valid cell front door, else null.
 * `project`, when given, must be the cell the door names (a door for another project is no door).
 * @param {unknown} body
 * @param {string | null} [project]
 * @returns {{ url: string } | null}
 */
export function browserDoorOf(body, project) {
  if (!body || typeof body !== 'object') return null;
  const b = /** @type {{ reason?: unknown, url?: unknown }} */ (body);
  if (b.reason !== 'browser-door') return null;
  const url = cellDoorUrl(b.url);
  if (!url) return null;
  if (project && new URL(url).hostname !== `${project}.${CELL_ZONE}`) return null;
  return { url };
}

const errText = (e) =>
  String((e && typeof e === 'object' && 'message' in e ? e.message : e) ?? '').trim();

function windowOpen(url) {
  try {
    globalThis.window?.open?.(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* a blocked popup is the browser's call */
  }
}

/**
 * Open a browser door. Home names its `profile` (the account it prepared for); a project tab names
 * none (Rust uses the tab's own account). `invoke` is the shell's, or null in the browser shell —
 * which opens the door in the browser, as it always has. When the shell has no cell tabs
 * (`CELL_TABS_UNSUPPORTED`) the cell's ORIGIN opens in the system browser (`open_cloud_url`).
 * @param {{ url: unknown, profile?: string | null }} door
 * @param {{ invoke: ((cmd: string, args: unknown) => Promise<unknown>) | null, openInBrowser?: (url: string) => void }} deps
 * @returns {Promise<{ ok: true, via: 'tab' | 'browser' } | { ok: false, error: string }>}
 */
export async function openBrowserDoor({ url, profile }, { invoke, openInBrowser = windowOpen }) {
  const door = cellDoorUrl(url);
  if (!door) return { ok: false, error: DOOR_REFUSED };
  if (!invoke) {
    openInBrowser(door);
    return { ok: true, via: 'browser' };
  }
  try {
    await invoke(
      'open_cell_tab',
      typeof profile === 'string' && profile ? { url: door, profile } : { url: door }
    );
    return { ok: true, via: 'tab' };
  } catch (e) {
    const msg = errText(e);
    if (!msg.includes(CELL_TABS_UNSUPPORTED)) return { ok: false, error: msg || DOOR_REFUSED };
  }
  try {
    await invoke('open_cloud_url', { url: new URL(door).origin });
    return { ok: true, via: 'browser' };
  } catch (e) {
    return { ok: false, error: errText(e) || CELL_TABS_UNSUPPORTED };
  }
}
