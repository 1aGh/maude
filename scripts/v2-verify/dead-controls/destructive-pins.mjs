// Controls the crawler never clicks (a confirm that would move or delete real things) and the unit test
// that runs each one's action and asserts its effect. The report lists the pin next to the row; a skipped
// control WITHOUT a pin makes the crawl exit 1, and scripts/test/dead-controls-pins.test.mjs checks that
// every pinned test file exists and still names the test.
export const DESTRUCTIVE_PINS = {
  'share-move-confirm': {
    action: 'move this local project to the cloud (share.move → moveToCloud)',
    file: 'apps/studio/test/share-advanced.test.tsx',
    test: 'a local project offers Move to cloud, moves, then opens on Invite once linked',
    also: 'a refusal keeps the project local and says why',
  },
};
