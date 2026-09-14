// Wire-level check for audit 2026-09-13 P1 #5: the undo command's expected
// current value must actually reach the css/attr routes. The original bug was
// exactly here — the command carried `from`, the shell dropped it.

import { describe, expect, test } from 'bun:test';

import { applyEditRequest } from '../client/apply-edit-request.ts';
import { createEditSourceCommand } from '../commands/edit-source-command.ts';

describe('applyEditRequest', () => {
  test('a CSS undo carries its expected current value to /_api/edit-css', async () => {
    const posted: unknown[] = [];
    const cmd = createEditSourceCommand({
      payload: {
        op: 'css',
        canvas: 'home.tsx',
        id: 'title',
        key: 'color',
        before: 'black',
        after: 'red',
      },
      applyFn: (apply) => {
        posted.push(applyEditRequest(apply));
      },
    });
    await cmd.undo();
    await cmd.do();
    expect(posted).toEqual([
      {
        op: 'css',
        url: '/_api/edit-css',
        body: {
          canvas: 'home.tsx',
          id: 'title',
          property: 'color',
          value: 'black',
          expected: 'red',
        },
      },
      {
        op: 'css',
        url: '/_api/edit-css',
        body: {
          canvas: 'home.tsx',
          id: 'title',
          property: 'color',
          value: 'red',
          expected: 'black',
        },
      },
    ]);
  });

  test('undoing a first-time set resets, expecting the value it set', () => {
    expect(
      applyEditRequest({
        op: 'attr',
        canvas: 'c',
        id: 'x',
        key: 'data-tone',
        value: null,
        from: 'warm',
      })
    ).toEqual({
      op: 'attr',
      url: '/_api/edit-attr',
      body: { canvas: 'c', id: 'x', attr: 'data-tone', reset: true, expected: 'warm' },
    });
  });

  test('redoing onto an unset property expects "unset" (null)', () => {
    expect(
      applyEditRequest({ op: 'css', canvas: 'c', id: 'x', key: 'top', value: '4px', from: null })
    ).toEqual({
      op: 'css',
      url: '/_api/edit-css',
      body: { canvas: 'c', id: 'x', property: 'top', value: '4px', expected: null },
    });
  });

  test('a message without `from` keeps the legacy unconditional request', () => {
    const req = applyEditRequest({ op: 'css', canvas: 'c', id: 'x', key: 'top', value: '4px' });
    expect(req?.body).not.toHaveProperty('expected');
  });

  test('text keeps using `from` only to target the source string', () => {
    expect(
      applyEditRequest({
        op: 'text',
        canvas: 'c',
        id: 'x',
        value: 'Hi',
        from: 'Hello',
        occurrence: 2,
      })
    ).toEqual({
      op: 'text',
      url: '/_api/edit-text',
      body: { canvas: 'c', id: 'x', text: 'Hi', occurrence: 2, before: 'Hello' },
    });
  });

  test('refuses unknown ops and missing ids', () => {
    expect(applyEditRequest({ op: 'reorder', id: 'x' })).toBeNull();
    expect(applyEditRequest({ op: 'css', id: '' })).toBeNull();
  });
});
