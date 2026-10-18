import { expect, test } from 'bun:test';

import { clientSource, fileContaining } from './_client-source.ts';

// The shell's code, whichever client file it lives in (app.jsx before the
// V2-0.2 split, its modules after) — see `_client-source.ts`.
const app = clientSource();

// Actual-cloud reproduction: select Inspector, then press the Changes entry. Directly setting
// changesOpen leaves Inspector open too; its earlier dock precedence hides History although the
// entry looks pressed. The entry is Menu › Version history now (the status-bar chip is gone,
// V2-4.8b) — it must open its panel exclusively, like a dock tab.
test('Version history opens its panel exclusively, like a dock tab', () => {
  const handler = app.match(/'history\.open':\s*\(\)\s*=>\s*([^,\n]+)/)?.[1];
  expect(handler).toBeDefined();
  expect(handler).toMatch(/toggleRightPanel\('changes'\)/);
  expect(handler).not.toContain('setChangesOpen');
  // ... and nothing reaches past the dock helpers for it
  expect(app).not.toMatch(/onOpenChanges=\{[^}]*setChangesOpen/);
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
  expect(diff).toMatch(/restoreProjectVersion\(\s*file,/);
  // S11.10 retired the Changes panel: the refresh key now rides the Version history host
  // (`refreshKey=` and the Advanced fold's `historyRefresh:`), same two inputs.
  expect(
    /(historyRefresh[=:]|refreshKey=).*syncStatus\?\.appliedRevision.*projectHistoryRefresh/.test(
      app
    )
  ).toBe(true);
  expect(app).toMatch(
    /onRestoreVersion=\{\(revision\) =>\s*restoreProjectVersion\(activePath, revision\)/
  );
  expect(app).toMatch(/if \(!acceptedDiff\) return gitLoadLog\(path\);/);
  expect(app).toMatch(
    /const entries = await loadAcceptedLog\(path\);\s*return Array\.isArray\(entries\) \? entries : \[\];/
  );
});
