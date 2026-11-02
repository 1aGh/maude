// P8 C5 (05 critic-final): the words the empty states and the ⌘K start-here row got wrong.
import { describe, expect, test } from 'bun:test';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { chatsWord } from '../client/v2/ai/chat-list-model.js';
import { copy } from '../client/v2/empty/empty-copy.js';
import { noArtboardsOfKind } from '../client/v2/kinds/layers-kind-model.js';

describe('05 · es-edge-panels: the chat search says "Searched 1 chat", never "1 chats"', () => {
  test('chatsWord counts with its noun', () => {
    expect(chatsWord(0)).toBe('0 chats');
    expect(chatsWord(1)).toBe('1 chat');
    expect(chatsWord(41)).toBe('41 chats');
  });

  test('the empty block reads in the singular and the plural', () => {
    const one = copy('es-edge-panels.chat-search-none', {
      q: 'x',
      chats: chatsWord(1),
      project: 'Studio site',
    });
    expect(one.next).toBe('Searched 1 chat in Studio site — titles and every message.');
    const many = copy('es-edge-panels.chat-search-none', {
      q: 'x',
      chats: chatsWord(41),
      project: 'Alligators brand',
    });
    expect(many.next).toBe('Searched 41 chats in Alligators brand — titles and every message.');
  });
});

describe('05 · es-filter: the one artboard that is left names its kind with an article', () => {
  const only = (kind: string) =>
    noArtboardsOfKind({ kind: 'video', canvas: 'Solo', boards: [{ id: 'a', kind }] }).next;
  test('a web page / a print artboard / a fixed size artboard / a video', () => {
    expect(only('web')).toBe('The Video filter is on. The one artboard here is a web page.');
    expect(only('print')).toContain('The one artboard here is a print artboard.');
    expect(only('digital')).toContain('The one artboard here is a fixed size artboard.');
  });
});

describe('05 · es-search-more: the start-here row says "New canvas" (⌘N makes one, no dialog follows)', () => {
  test('the ⌘K row is the action’s own words, no ellipsis', () => {
    expect(ACTIONS_BY_ID.get('canvas.new')?.legacy?.palette).toBe('New canvas');
  });
});
