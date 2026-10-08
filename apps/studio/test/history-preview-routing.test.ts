import { expect, test } from 'bun:test';

import { clientSource, fileContaining } from './_client-source.ts';

// The shell's code, whichever client file it lives in (app.jsx before the
// V2-0.2 split, its modules after) — see `_client-source.ts`.
const app = clientSource();

// Actual-cloud reproduction: select Inspector, then press the status-bar
// Changes button. Directly setting changesOpen leaves Inspector open too;
// its earlier dock precedence hides History although aria-pressed is true.
test('the status-bar history button opens its panel exclusively, like a dock tab', () => {
  // The <StatusBar …> USAGE (App's render), sliced inside the file that holds it.
  const shell = fileContaining('<StatusBar\n').src;
  const statusBar = shell.slice(shell.indexOf('<StatusBar\n'));
  const callback = statusBar.match(/onOpenChanges=\{([\s\S]*?)\n\s*\}/)?.[1];
  expect(callback).toBeDefined();
  expect(callback).toMatch(/=>\s*openRightPanel\('changes'\)/);
  expect(callback).not.toContain('setChangesOpen');
});

// Wiring guard: the rendered DiffView's selected revision must reach the same
// project action as a history row. The DOM test covers the actual selection;
// the real-backend scenario covers the resulting accepted revision.
test('accepted preview history and restore use project actions, not Git discard', () => {
  // The <DiffView …> usage up to the <ShortcutsOverlay> after it, in the file
  // that renders both (App's render tree).
  const shell = fileContaining('<DiffView\n').src;
  const from = shell.indexOf('<DiffView\n');
  const to = shell.indexOf('<ShortcutsOverlay', from);
  expect(to).toBeGreaterThan(from);
  const diff = shell.slice(from, to);
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
