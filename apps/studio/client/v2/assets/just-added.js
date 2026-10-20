// client/v2/assets/just-added.js — the "Just added" group at the top of the Assets tab (S8.14; 12 · ia-placed).
//
// Photos dropped from Finder (or added with Image I, + or paste) are placed on the artboard at once and are ALSO the first thing
// in Assets, so you can find them again. "Just added" is what arrived in this window and not long ago: a file whose time is after
// this window opened and within the last half hour. A time rule, not a list the canvas sends, so every way in — a drop, a paste,
// Generate, a teammate's sync — lands in the same place and nothing has to be told. It is a view: nothing is stored, and a file
// that was already in the project (the same picture imported twice) is not "added" again.
//
// Pure: rows in, groups out. The kind groups (Photos · Video · Sound) keep everything else.

/** How long a file stays "just added". */
export const JUST_ADDED_MS = 30 * 60 * 1000;
/** Taken when the window opens: files older than this never count, however recent. */
export const WINDOW_OPENED_AT = Date.now();

/** Is this row new to the project in this window? */
export function isJustAdded(row, now = Date.now(), since = WINDOW_OPENED_AT) {
  const t = Number(row?.mtimeMs) || 0;
  return t > 0 && t >= since && now - t <= JUST_ADDED_MS && t <= now + 60_000;
}

/**
 * Split the shown rows into the Just added run (newest first) and the rest.
 * @returns {{ added: object[], rest: object[] }}
 */
export function splitJustAdded(assets, now = Date.now(), since = WINDOW_OPENED_AT) {
  const added = [];
  const rest = [];
  for (const a of assets) (isJustAdded(a, now, since) ? added : rest).push(a);
  added.sort((a, b) => b.mtimeMs - a.mtimeMs || String(a.name).localeCompare(String(b.name)));
  return { added, rest };
}
