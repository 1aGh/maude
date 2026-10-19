// S4.16 (an-viewer) — Can comment: everyone's annotations show, read-only; N / M / A / S / E answer with ONE line
// that names what needs Can edit, plus Ask to edit. The server half (ops → 403) is test/access-role-matrix.test.ts.

import { describe, expect, test } from 'bun:test';
import { annotationPosture } from '../annotations/ui/posture.ts';
import {
  ASK_TO_EDIT_ACTION,
  ASK_TO_EDIT_FALLBACK,
  askToEditRegistered,
} from '../client/v2/shell/ask-to-edit.js';
import { denialLine, ROLE_DENIAL, showRoleDenial } from '../client/v2/shell/role-denial.js';

describe('the layer’s posture for a person who may not annotate', () => {
  const comment = { annotate: false };
  const editor = { annotate: true };

  test('Preview without the annotate cap is read-only; Edit and Viewing are what they were', () => {
    expect(annotationPosture('preview', true, false, comment)).toBe('read-only');
    expect(annotationPosture('viewing', true, false, comment)).toBe('read-only');
    expect(annotationPosture('preview', true, false, editor)).toBe('drawn');
    expect(annotationPosture('edit', true, false, editor)).toBe('quiet');
  });

  test('an ungoverned canvas, an unknown cap set and Present are unchanged', () => {
    expect(annotationPosture(null, true, false, comment)).toBe('drawn');
    expect(annotationPosture('preview', true, false, null)).toBe('drawn');
    expect(annotationPosture('preview', true, false)).toBe('drawn');
    expect(annotationPosture('preview', true, true, comment)).toBe('hidden');
    expect(annotationPosture('preview', false, false, comment)).toBe('hidden');
  });
});

describe('the denial line names what needs Can edit', () => {
  test('N, M, A, S and E each say their own thing', () => {
    expect(denialLine({ tool: 'sticky' })).toBe('Stickies need Can edit.');
    expect(denialLine({ tool: 'pen' })).toBe('Marker needs Can edit.');
    expect(denialLine({ tool: 'arrow' })).toBe('Arrows need Can edit.');
    expect(denialLine({ tool: 'section' })).toBe('Sections need Can edit.');
    expect(denialLine({ panel: 'stickers' })).toBe('Stickers need Can edit.');
  });
  test('C without the comment cap says Can comment; an unknown request falls back to the general line', () => {
    expect(denialLine({ tool: 'comment' })).toBe('Comments need Can comment.');
    expect(denialLine({ tool: 'nope' })).toBe(ROLE_DENIAL);
    expect(denialLine({})).toBe(ROLE_DENIAL);
    expect(denialLine(undefined)).toBe(ROLE_DENIAL);
  });
  test('the toast carries Ask to edit, and the button runs S9.21’s action', () => {
    const said: Array<{ text: string; action: { label: string; onClick: () => void } }> = [];
    const ran: string[] = [];
    showRoleDenial(
      { tool: 'sticky' },
      {
        toast: (text: string, _ok: boolean, action: { label: string; onClick: () => void }) =>
          said.push({ text, action }),
        run: (id: string) => ran.push(id),
      }
    );
    expect(said).toHaveLength(1);
    expect(said[0]?.text).toBe('Stickies need Can edit.');
    expect(said[0]?.action.label).toBe('Ask to edit');
    said[0]?.action.onClick();
    if (askToEditRegistered()) expect(ran).toEqual([ASK_TO_EDIT_ACTION]);
    else {
      // S9.21 has not registered the action in this build: the fallback line is said, nothing runs
      expect(ran).toEqual([]);
      expect(said[1]?.text).toBe(ASK_TO_EDIT_FALLBACK);
    }
  });
});
