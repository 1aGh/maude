// client/v2/assets/ask-once.js — S8.22b: "Figma access" and "no Google key" are asked once, not once per file.
//
// A small per-viewer memory (12 · ia-edges G, H): the first time one of these needs the person, it asks. After it was
// put, the next file in the same batch — or the next try — says it quietly in its own line and does not push the
// question at them again. Connecting clears the memory, so a key that is later removed asks again.
//
// Per viewer only: localStorage, never a file, never synced (a person's "not now" is theirs). Every read and write is
// guarded — a private window or blocked site data simply means "ask", which is the safe side.

export const ASK_ONCE_KEYS = Object.freeze({
  figma: 'maude:asked-once:figma-access',
  google: 'maude:asked-once:google-key',
});

const storeOf = (store) => {
  if (store) return store;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Has this viewer already been asked? */
export function wasAsked(kind, store) {
  const key = ASK_ONCE_KEYS[kind];
  const s = storeOf(store);
  if (!key || !s) return false;
  try {
    return s.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Remember the question was put. */
export function markAsked(kind, store) {
  const key = ASK_ONCE_KEYS[kind];
  const s = storeOf(store);
  if (!key || !s) return;
  try {
    s.setItem(key, '1');
  } catch {
    /* blocked storage: ask again next time */
  }
}

/** Connected: forget it, so the question can come back if the connection is removed later. */
export function clearAsked(kind, store) {
  const key = ASK_ONCE_KEYS[kind];
  const s = storeOf(store);
  if (!key || !s) return;
  try {
    s.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** Should this need put the question now? True the first time, and records it, so two files arriving together ask once. */
export function askNow(kind, store) {
  if (wasAsked(kind, store)) return false;
  markAsked(kind, store);
  return true;
}
