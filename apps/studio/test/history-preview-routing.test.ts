import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../client/app.jsx', import.meta.url), 'utf8');

// Actual-cloud reproduction: select Inspector, then press the status-bar
// Changes button. Directly setting changesOpen leaves Inspector open too;
// its earlier dock precedence hides History although aria-pressed is true.
test('the status-bar history button opens its panel exclusively, like a dock tab', () => {
  const statusBar = app.slice(app.indexOf('<StatusBar\n'));
  const callback = statusBar.match(/onOpenChanges=\{([\s\S]*?)\n\s*\}/)?.[1];
  expect(callback).toBeDefined();
  expect(callback).toMatch(/=>\s*openRightPanel\('changes'\)/);
  expect(callback).not.toContain('setChangesOpen');
});

// Wiring guard: the rendered DiffView's selected revision must reach the same
// project action as a history row. The DOM test covers the actual selection;
// the real-backend scenario covers the resulting accepted revision.
test('accepted preview history and restore use project actions, not Git discard', () => {
  const diff = app.slice(app.indexOf('<DiffView\n'), app.indexOf('<ShortcutsOverlay'));
  expect(diff).toContain('loadLog={loadDiffLog}');
  expect(diff).toContain('onRestore={async (file, version) =>');
  expect(diff).toContain('acceptedDiff');
  expect(diff).toContain('restoreProjectVersion(file,');
  expect(/historyRefresh=.*syncStatus\?\.appliedRevision.*projectHistoryRefresh/.test(app)).toBe(
    true
  );
  expect(app).toContain(
    'onRestoreVersion={(revision) => restoreProjectVersion(activePath, revision)'
  );
  expect(app).toMatch(/if \(!acceptedDiff\) return gitLoadLog\(path\);/);
  expect(app).toMatch(
    /const entries = await loadAcceptedLog\(path\);\s*return Array\.isArray\(entries\) \? entries : \[\];/
  );
});
