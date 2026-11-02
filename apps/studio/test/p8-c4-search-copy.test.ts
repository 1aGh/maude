// P8 C4 (11 critic-d): ⌘K words — the hidden tools next to canvases are "Tools and settings · not shown"
// (pn-k-across, pn-k-close); a tools-only search keeps 06's "Actions · N hidden tools".
import { describe, expect, test } from 'bun:test';
import {
  actionSearchRows,
  assemble,
  settingsSearchRows,
} from '../client/v2/search/search-model.js';
import { assembleAcross } from '../client/v2/search/search-projects.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const desktop = menuCtx({ native: true, canvasOpen: true });
const local = [
  ...actionSearchRows(desktop, { isRunnable: () => true }),
  ...settingsSearchRows({ cloud: null }),
];
const canvasRow = {
  group: 'canvases',
  id: 'canvas:ui/Print guides.tsx',
  name: 'Print guides',
  meta: 'Alligators brand',
  keywords: [],
  icon: 'page',
};

describe('the hidden tools beside canvases', () => {
  test('a search that also finds a canvas names the tools group "Tools and settings · not shown"', () => {
    const res = assemble({ query: 'print guides', local: [...local, canvasRow], canAskAI: true });
    const g = res.groups.find((x: { id: string }) => x.id === 'actions');
    expect(g?.title).toBe('Tools and settings');
    expect(g?.aside).toBe('not shown');
  });

  test('a tools-only search keeps 06’s "Actions · 1 hidden tool"', () => {
    const res = assemble({ query: 'print guides', local, canAskAI: true });
    const g = res.groups.find((x: { id: string }) => x.id === 'actions');
    expect(g?.title).toBe('Actions');
    expect(g?.aside).toBe('1 hidden tool');
  });

  test('across projects the aside adds how they are found', () => {
    const other = {
      pid: 'p-2',
      name: 'Studio site',
      place: 'tab',
      rows: [
        {
          group: 'canvases',
          id: 'canvas:other',
          name: 'Print guides 2',
          meta: 'x',
          icon: 'page',
          pid: 'p-2',
        },
      ],
    };
    const res = assembleAcross({
      query: 'print guides',
      local: [...local, canvasRow],
      others: [other],
      own: { pid: 'p-1', name: 'Alligators brand' },
      canAskAI: true,
    });
    const g = res.groups.find((x: { title: string }) => x.title === 'Tools and settings');
    expect(g?.aside).toBe('not shown, found by search');
  });
});
