// p8-fixups2 (V2-8.7 moderate `landmark-unique`) — Settings open over the inspector: the Settings "Layout" group and the
// inspector's "Layout" section were both <section aria-label="Layout">, two landmarks with one name. The Settings
// group's ACCESSIBLE name now says where it is ("Layout settings"); the visible title is untouched.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Group } from '../client/v2/settings/parts.jsx';

describe('a Settings group is named apart from the inspector section of the same word', () => {
  test('aria-label says "<title> settings"; the visible heading stays the title', () => {
    const html = renderToStaticMarkup(
      <Group title="Layout" testid="settings-layout">
        <p>rows</p>
      </Group>
    );
    expect(html).toContain('aria-label="Layout settings"');
    expect(html).not.toContain('aria-label="Layout"');
    expect(html).toContain('<h3 class="v2s-group-t">Layout</h3>');
  });

  test('no Settings group is ever named exactly like an inspector section', () => {
    for (const title of ['Layout', 'Position', 'Size', 'Appearance', 'Fill', 'Stroke', 'Typography', 'Effects']) {
      const html = renderToStaticMarkup(<Group title={title}>x</Group>);
      expect(html).not.toContain(`aria-label="${title}"`);
    }
  });
});
