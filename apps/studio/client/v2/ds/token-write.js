// client/v2/ds/token-write.js — S10.7: a token edited in place becomes ONE pending entry (13 · ds-edit-colour).
//
// Nothing here writes a token file. An edit goes to the design-system engine (`POST /_api/ds/pending`, S10.3):
// it waits as `dsPending` ("1 change waiting" in the Design system bar) and reaches canvases only through
// "Update N canvases" (S10.8). The same functions back the registry actions `ds.set-token` and
// `ds.set-dark-follows`, so the panel and an agent do exactly one thing.
//
// The engine REPLACES a token's pending entry, it does not merge into it, so the entry built here is the whole
// of what should wait: the values already waiting, with this edit over them. `expect` carries the `at` of the
// entry the person saw: if someone else changed the same token since, the engine answers `ds-pending-conflict`
// and the panel re-reads and shows theirs (two Macs on different tokens never meet).

import { followDark } from '../../../ds/contrast.ts';

const JSON_HEADERS = { 'content-type': 'application/json' };
const NAME_MAX = 64;
// a value name is one line a person reads: no control characters (the engine's DISPLAY_RE)
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export const TOKEN_WORDS = Object.freeze({
  locked: 'Locked brand colour. It can’t be changed here.',
  changed: 'Someone changed this just now. Showing their edit.',
  forbidden: 'You can look here; ask to edit.',
  offline: 'Not changed. This Mac isn’t connected; try again.',
  invalid: 'That isn’t a value this token can take.',
  unknown: 'This token isn’t in the system.',
  unreachable: 'Not changed. The studio could not be reached; try again.',
  failed: 'Not changed; try again.',
  converted: 'Turn this folder into a Design system canvas first.',
});

/** A refusal code from the routes → the person's words. */
export function tokenWords(code) {
  switch (code) {
    case 'ds-token-locked':
      return TOKEN_WORDS.locked;
    case 'ds-pending-conflict':
      return TOKEN_WORDS.changed;
    case 'forbidden':
      return TOKEN_WORDS.forbidden;
    case 'ds-kernel-unavailable':
      return TOKEN_WORDS.offline;
    case 'ds-pending-invalid':
      return TOKEN_WORDS.invalid;
    case 'ds-unknown-token':
      return TOKEN_WORDS.unknown;
    case 'ds-not-converted':
      return TOKEN_WORDS.converted;
    case 'unreachable':
      return TOKEN_WORDS.unreachable;
    default:
      return TOKEN_WORDS.failed;
  }
}

/** The value text the person has typed, or null when it cannot be one value. */
export function cleanValue(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.length > 240) return null;
  if (/[;{}<>\\]|\/\*/.test(v) || CONTROL.test(v)) return null;
  return v;
}

/** A name for a value ("Deeper azure"): one line, ≤ 64 characters; '' clears it. */
export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length <= NAME_MAX && !CONTROL.test(v) ? v : null;
}

/** The value a theme shows today: a waiting edit over the files', Dark falling back to Light. */
export function currentValue(token, themes, theme) {
  const pend = token?.pending?.trashTo ? undefined : token?.pending?.values?.[theme];
  return pend ?? token?.values?.[theme] ?? token?.values?.[themes.light] ?? '';
}

/** Does Dark follow Light for this token? Said by a waiting edit, else by the file, else yes. */
export function darkFollowsOf(token) {
  const said = token?.pending?.darkFollows ?? token?.darkFollows;
  return said !== false;
}

/**
 * The whole pending entry after one edit. `edit` names what changed:
 *   { theme, value }          a value in one theme; on Light, Dark follows when it is meant to
 *   { theme, name }           the value's own name ("" clears it)
 *   { follows }               Dark follows Light (true) or is set by hand (false); true recomputes Dark now
 * Returns { entry } or { refused } (a word, nothing sent).
 */
export function buildEntry(token, themes, edit) {
  if (!token) return { refused: TOKEN_WORDS.unknown };
  if (token.locked) return { refused: TOKEN_WORDS.locked };
  const entry = {};
  // what already waits stays: the engine replaces the entry
  for (const [t, v] of Object.entries(token.pending?.values ?? {})) entry[t] = v;
  const names = { ...(token.pending?.valueNames ?? {}) };
  const hasDark = !!themes.dark;
  const light = themes.light;
  const followedBefore = darkFollowsOf(token);
  let follows = followedBefore;
  // Dark re-derived from the Light value that will be on screen, keeping the relation the pair has now
  const refollow = (nextLight) => {
    const dark = followDark(
      { light: currentValue(token, themes, light), dark: currentValue(token, themes, themes.dark) },
      nextLight
    );
    if (dark) entry[themes.dark] = dark;
  };

  if (edit.theme !== undefined && edit.value !== undefined) {
    const value = cleanValue(edit.value);
    if (value === null) return { refused: TOKEN_WORDS.invalid };
    entry[edit.theme] = value;
    if (hasDark && edit.theme === light && followedBefore) refollow(value);
    // Dark set by hand: it no longer follows
    else if (hasDark && edit.theme === themes.dark) follows = false;
  }
  if (edit.theme !== undefined && edit.name !== undefined) {
    const name = cleanName(edit.name);
    if (name === null) return { refused: TOKEN_WORDS.invalid };
    const put = (t) => (name ? (names[t] = name) : delete names[t]);
    put(edit.theme);
    // Dark follows: the colour keeps one name in both modes
    if (hasDark && edit.theme === light && followedBefore) put(themes.dark);
  }
  if (edit.follows !== undefined) {
    follows = edit.follows === true;
    if (follows && hasDark) refollow(currentValue(token, themes, light));
  }
  // only a difference from the file is worth waiting for
  if (follows !== (token.darkFollows !== false)) entry.darkFollows = follows;
  if (Object.keys(names).length) entry.valueNames = names;
  return { entry };
}

async function postPending(ds, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl('/_api/ds/pending', {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ds, ...body }),
    });
  } catch {
    return { ok: false, code: 'unreachable' };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* judged by status */
  }
  return res.ok
    ? { ok: true, body: json }
    : { ok: false, code: json?.code ?? (res.status === 403 ? 'forbidden' : 'failed') };
}

/** `GET /_api/ds/board?ds=` — the model, or null. */
export async function fetchBoard(ds, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/_api/ds/board?ds=${encodeURIComponent(ds)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.format === 'maude.ds-board' ? json : null;
  } catch {
    return null;
  }
}

/**
 * Write one edit. `model` is the board the person saw (the panel); without it (an action run by an agent) the
 * board is read right now, so there is nothing to clash with.
 * @returns {Promise<{ ok: true, token: any } | { ok: false, message: string, code: string, model?: any }>}
 */
export async function writeToken({ ds, css, edit, model = null }, fetchImpl = globalThis.fetch) {
  const board = model ?? (await fetchBoard(ds, fetchImpl));
  if (!board) return { ok: false, code: 'unreachable', message: TOKEN_WORDS.unreachable };
  const token = board.tokens.find((t) => t.css === css) ?? null;
  if (!token) return { ok: false, code: 'ds-unknown-token', message: TOKEN_WORDS.unknown };
  const built = buildEntry(token, board.themes, edit);
  if (built.refused) return { ok: false, code: 'refused', message: built.refused };
  const r = await postPending(
    ds,
    {
      tokens: { [css]: built.entry },
      // the entry the person (or the agent, a moment ago) read; the engine refuses if it moved since
      expect: { [css]: token.pending?.at ?? null },
    },
    fetchImpl
  );
  if (r.ok) return { ok: true, token };
  // a clash is answered with what is there now, so the panel can show it
  const fresh = r.code === 'ds-pending-conflict' ? await fetchBoard(ds, fetchImpl) : null;
  return {
    ok: false,
    code: r.code,
    message: tokenWords(r.code),
    ...(fresh ? { model: fresh } : {}),
  };
}

/** Registry `ds.set-token` / `ds.set-dark-follows` (menu-runner): the same write, a sentence back. */
export async function runTokenAction(id, p, fetchImpl = globalThis.fetch) {
  const ds = typeof p?.ds === 'string' ? p.ds : '';
  const css = typeof p?.css === 'string' ? p.css : '';
  if (!ds || !/^--[A-Za-z0-9_-]{1,128}$/.test(css))
    return { ok: false, message: TOKEN_WORDS.failed };
  const edit =
    id === 'ds.set-dark-follows'
      ? { follows: p?.follows === true }
      : p?.name !== undefined && p?.value === undefined
        ? { theme: String(p?.theme ?? ''), name: p.name }
        : { theme: String(p?.theme ?? ''), value: p?.value };
  if (id === 'ds.set-token') {
    const model = await fetchBoard(ds, fetchImpl);
    if (!model) return { ok: false, message: TOKEN_WORDS.unreachable };
    if (!edit.theme) edit.theme = model.themes.light;
    if (!model.themes.all.includes(edit.theme)) return { ok: false, message: TOKEN_WORDS.invalid };
  }
  const r = await writeToken({ ds, css, edit }, fetchImpl);
  return r.ok
    ? {
        ok: true,
        message: id === 'ds.set-dark-follows' ? 'Saved. Waiting for Update.' : '1 change waiting.',
      }
    : { ok: false, message: r.message };
}
