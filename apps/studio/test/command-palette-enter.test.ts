// ⌘K → a query → Enter runs the command the query names.
//
// Found by the surface run (2026-09-16): "New video" typed and confirmed at
// once opened the "New brief board" prompt instead — Enter read the list the
// last render had drawn, which was still the unfiltered one.

import { expect, test } from 'bun:test';
import { commandForEnter, matchCommands } from '../client/command-palette-match.js';

const actions = [
  { id: 'brief', label: 'New brief board', group: 'Create', run: () => {} },
  { id: 'video', label: 'New video…', group: 'Create', run: () => {} },
  { id: 'theme', label: 'Toggle theme', group: 'View', run: () => {} },
];

test('a query the list has not re-rendered for yet still runs its own command', () => {
  expect(commandForEnter(actions, '', 'New video', 0)?.id).toBe('video');
});

test('when the list is current, the highlighted row runs', () => {
  expect(commandForEnter(actions, 'new', 'new', 1)?.id).toBe('video');
  expect(commandForEnter(actions, '', '', 2)?.id).toBe('theme');
});

test('a query that matches nothing runs nothing', () => {
  expect(commandForEnter(actions, '', 'no such command', 0)).toBeNull();
  expect(matchCommands(actions, 'create').map((a) => a.id)).toEqual(['brief', 'video']);
});
