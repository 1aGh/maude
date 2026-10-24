// P8 stage C round 3 (03 AI chat): the ask / failure / done copy comes from the WORK, not the tool call.
import { describe, expect, test } from 'bun:test';
import {
  failureCause,
  failureModel,
  needsYouLine,
  permissionModel,
} from '../client/v2/ai/needs-you.js';
import { doneNotice, needsYouNotice } from '../client/v2/ai/needs-you-toast.js';

const edit = (path: string, title = `Edit ${path}`) => ({
  id: 'p1',
  toolCall: { kind: 'edit', title, rawInput: { file_path: `/proj/.design/ui/${path}` } },
  options: [
    { optionId: 'a', kind: 'allow_once', name: 'Allow' },
    { optionId: 'r', kind: 'reject_once', name: 'Reject' },
  ],
});

describe('P8 c3: the permission question is about the work (03 ai-permission)', () => {
  const four = {
    canvas: 'ui/Combine-kampan.tsx',
    boards: [
      { id: 'post', label: 'Post 1:1' },
      { id: 'story', label: 'Story 9:16' },
      { id: 'web', label: 'Web' },
      { id: 'poster', label: 'Poster' },
    ],
    more: 0,
  };
  test('several artboards: "Change 4 artboards in Combine-kampan?" and the button says the same count', () => {
    const m = permissionModel(edit('Combine-kampan.tsx'), four);
    expect(m.title).toBe('Change 4 artboards in Combine-kampan?');
    expect(m.verb).toBe('Change 4 artboards');
    expect(m.detail).toBeNull();
    expect(needsYouLine(m)).toBe('change 4 artboards');
  });
  test('one or two artboards are named; none known falls back to the canvas', () => {
    const one = permissionModel(edit('Combine-kampan.tsx'), {
      ...four,
      boards: four.boards.slice(0, 1),
    });
    expect(one.title).toBe('Change Post 1:1 in Combine-kampan?');
    expect(one.verb).toBe('Change Post 1:1');
    const two = permissionModel(edit('Combine-kampan.tsx'), {
      ...four,
      boards: four.boards.slice(0, 2),
    });
    expect(two.title).toBe('Change Post 1:1 and Story 9:16 in Combine-kampan?');
    expect(two.verb).toBe('Change 2 artboards');
    const none = permissionModel(edit('Combine-kampan.tsx'), { ...four, boards: [] });
    expect(none.title).toBe('Change Combine-kampan?');
    expect(none.verb).toBe('Change');
  });
  test('a new canvas file reads Add; no work context or a non-canvas file keeps the tool words', () => {
    const w = permissionModel(edit('New.tsx', 'Write /proj/.design/ui/New.tsx'), {
      ...four,
      canvas: 'ui/New.tsx',
    });
    expect(w.verb).toBe('Add 4 artboards');
    expect(permissionModel(edit('Combine-kampan.tsx')).title).toBe('Edit Combine-kampan.tsx?');
    const css = permissionModel(edit('theme.css'), four);
    expect(css.title).toBe('Edit theme.css?');
  });
});

describe('P8 c3: a failure names its cause (03 ai-choice-fail)', () => {
  test.each([
    ['429 rate limit reached', 'Claude is too busy to answer right now'],
    ['getaddrinfo ENOTFOUND api', 'this Mac lost its connection'],
    ['request timed out', 'Claude took too long to answer'],
    ['401 Unauthorized', 'Claude needs you to sign in again'],
    ['ENOENT: no such file', 'a file it needed is missing'],
    ['EACCES: permission denied', 'it could not write to the project'],
    [
      "Couldn't finish — the footage file is missing. Nothing changed.",
      'the footage file is missing',
    ],
    ['socket closed', 'the connection to Claude was interrupted'],
    ['', 'the connection to Claude was interrupted'],
  ])('%s', (raw, cause) => {
    expect(failureCause(raw)).toBe(cause);
    expect(failureModel({ message: raw }, { changed: false })?.title).toBe(
      `Couldn't finish — ${cause}. Nothing changed.`
    );
  });
});

describe('P8 c3: the done toast says what was done and offers Undo (01 cf-ai-done)', () => {
  const run = {
    scope: { canvas: 'ui/landing.tsx', artboards: '*' },
    touched: { 'ui/landing.tsx': ['desktop', 'tablet', 'mobile'] },
    objects: [],
  };
  const boards = [
    { id: 'desktop', label: 'Desktop' },
    { id: 'tablet', label: 'Tablet' },
    { id: 'mobile', label: 'Mobile' },
  ];
  test('a reply that is not a result gives way to the work; the verb is Undo', () => {
    const n = doneNotice({
      id: 'd',
      text: 'Drafting the landing page — hero, three services, pricing.',
      run,
      artboards: boards,
      onShow() {},
      onUndo() {},
    });
    expect(n?.title).toBe('Done — Desktop, Tablet and Mobile are updated.');
    expect(n?.action.label).toBe('Undo');
  });
  test('a reply that opens with Done is quoted; an answer-only run offers Show', () => {
    expect(
      doneNotice({
        id: 'd',
        text: 'Done — Post 1:1 is greener.',
        run,
        artboards: boards,
        onShow() {},
        onUndo() {},
      })?.title
    ).toBe('Done — Post 1:1 is greener.');
    const answered = doneNotice({
      id: 'd',
      text: 'The hero is 72 px.',
      run: { ...run, touched: {}, objects: [] },
      artboards: boards,
      onShow() {},
      onUndo() {},
    });
    expect(answered?.action.label).toBe('Show');
    expect(
      needsYouNotice({ id: 'n', canvas: 'x/Combine.tsx', line: 'change 4 artboards', onOpen() {} })
        .title
    ).toBe('AI needs you on Combine — change 4 artboards?');
  });
});
