// P8 bug sweep B2 — every selection in a project without a design system read "Uses project ↗": the config
// still resolves a default system NAME, and the line is a door to that system's canvas. The line is for a
// system the project has.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isConfiguredSystem } from '../client/v2/ds/uses-link.jsx';

describe('the Inspector names only a design system the project has', () => {
  test('a configured system', () => {
    expect(isConfiguredSystem({ designSystems: [{ name: 'Studio' }] }, 'Studio')).toBe(true);
  });
  test('a default name with no system behind it, or no list at all', () => {
    expect(isConfiguredSystem({ designSystems: [] }, 'project')).toBe(false);
    expect(isConfiguredSystem({ defaultDesignSystem: 'project' }, 'project')).toBe(false);
    expect(isConfiguredSystem(undefined, 'project')).toBe(false);
    expect(isConfiguredSystem({ designSystems: [{ name: 'Studio' }] }, 'project')).toBe(false);
  });
  test('the frame draws the line only through that check', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'v2', 'inspector', 'frame.jsx'),
      'utf8'
    );
    expect(src).toMatch(/ds && isConfiguredSystem\(cfg, ds\)/);
  });
});
