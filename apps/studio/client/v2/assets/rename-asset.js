// client/v2/assets/rename-asset.js — "Rename…" in a tile's menu (P8 round 7; 12 · ia-assets-keys).
//
// One request, `POST /_api/assets/rename { asset, name }`: the picture and its sidecars take the new name, the extension
// stays. The studio refuses a picture a canvas uses or an older version shows (renaming it would break the artboards that
// show it) — this file only asks and says the answer in words. Undo is the same call with the old name. Nothing throws.

export const ASSET_RENAME_WORDS = Object.freeze({
  field: (name) => `New name for ${name}`,
  done: (name) => `Renamed to “${name}”.`,
  back: (name) => `“${name}” has its old name again.`,
  used: (name) =>
    `“${name}” is on a canvas, so its name stays. Rename a picture before you place it.`,
  keptByVersions: (name) => `“${name}” is in an older version, so its name stays.`,
  checking: 'Still checking older versions. Try again in a moment.',
  exists: (name) => `Another file is called “${name}”.`,
  badName: 'Use letters, numbers, spaces, dots, dashes or underscores.',
  gone: (name) => `“${name}” is not in the project any more.`,
  forbidden: 'Not renamed. You can look here; ask to edit.',
  failed: 'Not renamed. The studio could not be reached; try again.',
});

const baseName = (rel) => String(rel).split('/').pop() || String(rel);
const stemOf = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};

/** What the field starts with: the name without its extension (the extension is not the person's to change). */
export function renameDraftOf(rel) {
  return stemOf(baseName(rel));
}

/**
 * Ask the studio to rename `rel` (`assets/<name>.<ext>`) to `name` (+ the same extension).
 * @returns {Promise<{ ok: boolean, keep?: boolean, rel: string, to?: string, message: string }>}
 */
export async function renameAssetRequest(rel, name, { fetchImpl = fetch } = {}) {
  const old = baseName(rel);
  const typed = String(name ?? '').trim();
  if (!typed || typed === stemOf(old)) return { ok: false, keep: true, rel, message: '' };
  let res;
  try {
    res = await fetchImpl('/_api/assets/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asset: rel, name: typed }),
    });
  } catch {
    return { ok: false, rel, message: ASSET_RENAME_WORDS.failed };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (res.status === 403) return { ok: false, rel, message: ASSET_RENAME_WORDS.forbidden };
  if (res.ok && body?.ok && typeof body.to === 'string')
    return { ok: true, rel, to: body.to, message: ASSET_RENAME_WORDS.done(baseName(body.to)) };
  const reason = body?.reason;
  const message =
    reason === 'used'
      ? ASSET_RENAME_WORDS.used(old)
      : reason === 'kept-by-versions'
        ? ASSET_RENAME_WORDS.keptByVersions(old)
        : reason === 'checking'
          ? ASSET_RENAME_WORDS.checking
          : reason === 'exists'
            ? ASSET_RENAME_WORDS.exists(`${typed}${old.slice(stemOf(old).length)}`)
            : reason === 'bad-name'
              ? ASSET_RENAME_WORDS.badName
              : reason === 'same'
                ? ''
                : reason === 'missing' || reason === 'invalid'
                  ? ASSET_RENAME_WORDS.gone(old)
                  : ASSET_RENAME_WORDS.failed;
  return { ok: false, keep: reason === 'same', rel, message };
}
