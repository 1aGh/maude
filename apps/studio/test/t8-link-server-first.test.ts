// 2.1.1 T8 — Link your server: the first link to a server that holds nothing still asks, and the
// confirm step says what goes up and where ("<n> files will go to <host>.").
import { describe, expect, test } from 'bun:test';
import { linkFolderAnswerOf } from '../client/v2/link-server/link-server-api.js';
import {
  firstLead,
  initialLink,
  LINK_WORDS,
  linkReducer,
} from '../client/v2/link-server/link-server-model.js';

const counts = (canvases: number, files: number) => ({
  onlyHere: canvases + files,
  onlyThere: 0,
  differ: 0,
  same: 0,
  canvases: { onlyHere: canvases, onlyThere: 0, differ: 0, same: 0 },
  files: { onlyHere: files, onlyThere: 0, differ: 0, same: 0 },
});

describe('the first link to an empty server', () => {
  test('the server answer carries `empty` through to the confirm step', () => {
    const a = linkFolderAnswerOf({
      ok: true,
      json: {
        ok: true,
        state: 'needs-confirm',
        host: 'design.example.com',
        counts: counts(2, 5),
        confirm: 'c0de',
        empty: true,
      },
    });
    expect(a.needsConfirm).toMatchObject({ host: 'design.example.com', code: 'c0de', empty: true });
    const s = linkReducer(initialLink(), {
      type: 'needs-confirm',
      confirm: { url: 'https://design.example.com', ...a.needsConfirm },
    });
    expect(s.phase).toBe('confirm');
    expect(s.confirm.empty).toBe(true);
  });

  test('a server that holds work is not the empty case', () => {
    const a = linkFolderAnswerOf({
      ok: true,
      json: { ok: true, state: 'needs-confirm', host: 'h', counts: counts(1, 0), confirm: 'x' },
    });
    expect(a.needsConfirm.empty).toBeUndefined();
  });

  test('the words: what goes up, and where', () => {
    expect(LINK_WORDS.firstTitle('design.example.com')).toBe(
      'Send this folder to design.example.com?'
    );
    expect(firstLead(counts(2, 5), 'design.example.com')).toBe(
      '2 canvases and 5 files will go to design.example.com.'
    );
    expect(firstLead(counts(0, 1), 'h')).toBe('1 file will go to h.');
    expect(firstLead(counts(0, 0), 'h')).toBe(
      'This folder is empty. What you add here will go to h.'
    );
  });
});
