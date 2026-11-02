// P8 round 8 (06 ad-search / ad-open-all): "Close all Advanced sections" is ONE ⌘K result. It is the registry action
// `view.advanced-close-all` (path "Settings › Advanced › Reset"); the Settings sheet's own row of the same name stays
// in the sheet and in the parity table, but is not a second search result.
import { describe, expect, test } from 'bun:test';
import {
  actionSearchRows,
  assemble,
  settingsSearchRows,
} from '../client/v2/search/search-model.js';
import { SETTINGS_ROWS } from '../client/v2/settings/settings-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const desktop = menuCtx({ native: true, canvasOpen: true });
const local = [
  ...actionSearchRows(desktop, { isRunnable: () => true }),
  ...settingsSearchRows({ cloud: null }),
];

describe('Close all Advanced sections in ⌘K', () => {
  test('"advanced" lists it once', () => {
    const res = assemble({ query: 'advanced', local, canAskAI: true });
    const names = res.items.map((r: { name: string }) => r.name);
    expect(names.filter((n: string) => n === 'Close all Advanced sections')).toHaveLength(1);
    expect(names.filter((n: string) => n === 'Open all Advanced sections')).toHaveLength(1);
  });

  test('the sheet keeps its row (shell parity) — only the search result is the action', () => {
    const row = SETTINGS_ROWS.find((r: { testid: string }) => r.testid === 'settings-reset-folds');
    expect((row as { searchTwin?: string } | undefined)?.searchTwin).toBe(
      'view.advanced-close-all'
    );
    const rows = settingsSearchRows({ cloud: null }) as { testid: string }[];
    expect(rows.some((r) => r.testid === 'settings-reset-folds')).toBe(false);
  });
});
