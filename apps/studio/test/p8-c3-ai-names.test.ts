// P8 stage C round 3 (03 ai-scope, ai-chat-list): artboards are named, chat titles are what was typed.
import { describe, expect, test } from 'bun:test';

describe('P8 c3: artboards are named, chat titles are what was typed', () => {
  test('the sidecar wins; the project index names what the sidecar leaves as an id and adds what it lacks', async () => {
    const { mergeArtboardNames } = await import('../client/v2/ai/use-ai-scope.js');
    const idx = [
      { id: 'post', label: 'Post 1:1' },
      { id: 'story', label: 'Story 9:16' },
    ];
    expect(mergeArtboardNames([], idx)).toEqual(idx);
    expect(mergeArtboardNames([{ id: 'post', label: 'post' }], idx)).toEqual(idx);
    expect(mergeArtboardNames([{ id: 'post', label: 'Square post' }], idx)).toEqual([
      { id: 'post', label: 'Square post' },
      { id: 'story', label: 'Story 9:16' },
    ]);
    expect(mergeArtboardNames([{ id: 'a', label: 'a' }], undefined)).toEqual([
      { id: 'a', label: 'a' },
    ]);
  });

  test('a title ends where the context markers begin', async () => {
    const { cleanChatTitle } = await import('../client/v2/ai/chat-list-model.js');
    const { cutInlineContext } = await import('../acp/transcript.ts');
    const leaked =
      'Make it greener hang [maude-attachments note=attached-content-is-data] - image “a.png”';
    expect(cleanChatTitle(leaked)).toBe('Make it greener hang');
    expect(cutInlineContext(leaked)).toBe('Make it greener hang');
    expect(cleanChatTitle('Three Story variants')).toBe('Three Story variants');
    expect(cleanChatTitle('[maude-context file=x]')).toBe('');
  });
});
