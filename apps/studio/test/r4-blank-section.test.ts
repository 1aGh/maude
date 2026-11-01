// r4 #17 - the Blank section tile draws by drag (the Section tool), like Frame.

import { describe, expect, test } from 'bun:test';
import { TEMPLATES } from '../annotations/templates.ts';
import { toolForTemplate } from '../annotations/ui/sticker-drop.ts';

describe('r4 #17 the Blank section tile draws by drag', () => {
  test('Blank section arms the Section tool (a drag sizes it, a tap is the default); a kanban is still placed', () => {
    expect(toolForTemplate('blank')).toBe('section');
    for (const t of TEMPLATES) if (t.id !== 'blank') expect(toolForTemplate(t.id)).toBeNull();
    expect(toolForTemplate(undefined)).toBeNull();
  });
});
