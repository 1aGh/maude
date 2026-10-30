// Controls the crawler never clicks (a confirm that would move or delete real things) and the unit test that runs
// each one's action and asserts its effect. The report lists the pin next to the row; a skipped control WITHOUT a pin
// makes the crawl exit 1, and scripts/test/dead-controls-pins.test.mjs checks that every pinned test file exists and
// still names the test. A key is a control name, or `/regexp/` for a family whose ids carry a per-run id.
export const DESTRUCTIVE_PINS = {
  'share-move-confirm': {
    action: 'move this local project to the cloud (share.move → moveToCloud)',
    file: 'apps/studio/test/share-advanced.test.tsx',
    test: 'a local project offers Move to cloud, moves, then opens on Invite once linked',
    also: 'a refusal keeps the project local and says why',
  },
  'settings-reset-all-confirm': {
    action:
      'put the look, layout, folds and switches back to a fresh Mac’s (Settings › Advanced › Reset all settings)',
    file: 'apps/studio/test/v2-s11-13-advanced.test.tsx',
    test: 'Reset all settings puts the look, layout, folds and switches back — and nothing else',
    also: 'Reset all settings… asks first: a dialog titled with its verb, Cancel writes nothing',
  },
  '/^comment-delete-/': {
    action: 'delete one comment thread (Delete comment in the thread’s ⋯ menu)',
    file: 'apps/studio/test/p8-c10-ann-convert-thread.test.tsx',
    test: 'the ⋯ keeps every dropped function: Reply…, Edit, Turn back into a sticky, Delete comment',
  },
  // older runs skipped these as 'Move … up/down' (the word "move"); the crawler now clicks them, the pin keeps old data honest
  '/^present-order-(up|down)-/': {
    action: 'move one artboard up / down in the present order (Order and notes)',
    file: 'apps/studio/test/order-notes-sheet.test.tsx',
    test: 'reads once, reorders, skips, annotates and saves only the change with the ETag',
  },
};

/** The pin for a control name, or undefined. */
export function pinFor(control) {
  const c = String(control ?? '');
  if (DESTRUCTIVE_PINS[c]) return DESTRUCTIVE_PINS[c];
  for (const [k, v] of Object.entries(DESTRUCTIVE_PINS))
    if (k.startsWith('/') && k.endsWith('/') && new RegExp(k.slice(1, -1)).test(c)) return v;
  return undefined;
}
