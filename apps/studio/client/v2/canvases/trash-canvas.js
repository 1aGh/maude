// client/v2/canvases/trash-canvas.js — S1.2: move a canvas to the trash, and bring it back (11 · pn-trash).
//
// "Move to trash" asks nothing (an editor moves things to the trash; only an owner clears it out, CONTRACT
// §7) and says what happened: "“ahoj” moved to the trash." with one action, Undo. Undo uses the Trash's own
// restore route (`POST /_api/sync/trash {action:'restore'}`, per file) over the files the move parked —
// `DELETE /_api/canvas` answers with the folder it made, and `sync/trash.ts` reads that folder's manifest to
// say where each file goes. The kernel's `trash.restore` (S1.6) replaces this; the words stay.

export const TRASH_WORDS = {
  moved: (label) => `“${label}” moved to the trash.`,
  back: (label) => `“${label}” is back.`,
  failed: (label) => `Could not move “${label}” to the trash.`,
  stuck: (label) => `Could not bring “${label}” back. It is still in the Trash.`,
  undo: 'Undo',
};

const jsonOf = async (r) => {
  try {
    return await r.json();
  } catch {
    return {};
  }
};

/** `.design/_trash/2026-…__ui-hero` → `_trash/2026-…__ui-hero` (the design-root-relative form the Trash route uses). */
export function trashFolderOf(trashDir) {
  const i = String(trashDir || '').indexOf('_trash/');
  return i < 0 ? null : trashDir.slice(i).replace(/\/+$/, '');
}

/**
 * Put a parked canvas back: every file of its trash folder that knows its way home.
 * @returns {Promise<{ok: boolean, restored: number, failed: number}>}
 */
export async function restoreTrashedCanvas({ trashDir, fetchImpl = fetch }) {
  const folder = trashFolderOf(trashDir);
  if (!folder) return { ok: false, restored: 0, failed: 0 };
  let entries = [];
  try {
    const r = await fetchImpl('/_api/sync/trash', { cache: 'no-store' });
    if (r.ok) entries = (await jsonOf(r)).entries || [];
  } catch {
    return { ok: false, restored: 0, failed: 0 };
  }
  const mine = entries.filter((e) => e.sourceRel && String(e.trashRel).startsWith(`${folder}/`));
  let restored = 0;
  let failed = 0;
  for (const e of mine) {
    try {
      const r = await fetchImpl('/_api/sync/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', trashRel: e.trashRel }),
      });
      const j = await jsonOf(r);
      if (r.ok && j.ok !== false) restored++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { ok: restored > 0 && failed === 0, restored, failed };
}

/**
 * Move one canvas to the trash and toast it with Undo.
 * @param toast (message, ok, action?) — the shell's `shellToast`
 * @param reload  re-reads the tree (`loadTree`)
 * @param onTrashed (path) — the shell closes the canvas if it was open
 * @param onUndone (path) — the shell opens it again if it had been open
 */
export async function trashCanvas({
  path,
  label,
  fetchImpl = fetch,
  toast,
  reload,
  onTrashed,
  onUndone,
}) {
  let j = {};
  try {
    const r = await fetchImpl(`/_api/canvas?file=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
    j = await jsonOf(r);
    if (!r.ok || !j.ok) {
      toast?.(`${TRASH_WORDS.failed(label)}${j.error ? ` ${j.error}` : ''}`, false);
      return { ok: false, error: j.error };
    }
  } catch {
    toast?.(TRASH_WORDS.failed(label), false);
    return { ok: false, error: 'network error' };
  }
  await reload?.();
  onTrashed?.(path);
  toast?.(TRASH_WORDS.moved(label), true, {
    label: TRASH_WORDS.undo,
    onClick: async () => {
      const res = await restoreTrashedCanvas({ trashDir: j.trashDir, fetchImpl });
      if (!res.ok) {
        toast?.(TRASH_WORDS.stuck(label), false);
        return;
      }
      await reload?.();
      onUndone?.(path);
      toast?.(TRASH_WORDS.back(label), true);
    },
  });
  return { ok: true, trashDir: j.trashDir };
}
