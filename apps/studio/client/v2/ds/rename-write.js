// client/v2/ds/rename-write.js — P8 round 7: "Rename…" in a system's own menu (13 · ds-multi-menu).
//
//   checkSystemName({ draft, current, others })   the inline field's own refusals (nothing is sent)
//   renameSystem(ds, label)                       `ds.rename` — one POST to /_api/ds/rename
//
// The name on the row is the system's config label; canvases pin the system by its id, so a rename moves
// nothing else (ds/rename.ts). The registry action's body: the row, ⌘K / an agent and the toast's Undo all
// call this one writer. The server judges the role (Can edit on the whole project) and the name again.

import { tokenWords } from './token-write.js';

export const SYSTEM_NAME_MAX = 64;

export const RENAME_SYSTEM_WORDS = Object.freeze({
  done: (label) => `Renamed to ${label}.`,
  reset: (name) => `${name} shows its own name again.`,
  empty: 'A system needs a name.',
  long: `Names are ${SYSTEM_NAME_MAX} characters or fewer.`,
  taken: 'Another design system already has that name.',
  field: 'Design system name',
});

const norm = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * @param {{ draft: string, current: string, others?: string[] }} a  `others`: the names the other systems show
 * @returns {{ kind: 'keep' } | { kind: 'error', error: string } | { kind: 'ok', name: string }}
 */
export function checkSystemName({ draft, current, others = [] }) {
  const name = norm(draft);
  if (!name) return { kind: 'error', error: RENAME_SYSTEM_WORDS.empty };
  if (name === norm(current)) return { kind: 'keep' };
  if ([...name].length > SYSTEM_NAME_MAX) return { kind: 'error', error: RENAME_SYSTEM_WORDS.long };
  const fold = name.toLowerCase();
  if (others.some((o) => norm(o).toLowerCase() === fold))
    return { kind: 'error', error: RENAME_SYSTEM_WORDS.taken };
  return { kind: 'ok', name };
}

/**
 * @param {string} ds  the system's id
 * @param {string | null} label  the new name; null shows the system's own name again (the Undo of a first rename)
 * @param {{ fetchImpl?: typeof fetch }} [o]
 * @returns {Promise<{ ok: boolean, message: string, code?: string, changed?: boolean,
 *                     label?: string | null, previous?: string | null }>}
 */
export async function renameSystem(ds, label, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl('/_api/ds/rename', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ds, label }),
    });
  } catch {
    return { ok: false, code: 'unreachable', message: tokenWords('unreachable') };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* judged by status */
  }
  if (!res.ok) {
    const code = json?.code ?? (res.status === 403 ? 'forbidden' : 'failed');
    const message =
      code === 'ds-name-taken'
        ? RENAME_SYSTEM_WORDS.taken
        : code === 'ds-bad-name'
          ? RENAME_SYSTEM_WORDS.long
          : tokenWords(code);
    return { ok: false, code, message };
  }
  const now = json?.label ?? null;
  const previous = json?.previous ?? null;
  return {
    ok: true,
    changed: previous !== now,
    label: now,
    previous,
    message: now === null ? RENAME_SYSTEM_WORDS.reset(ds) : RENAME_SYSTEM_WORDS.done(now),
  };
}
