// p8-cloud-canvas-only-viewing — a CLOUD canvas-only session's frame carries the read-only follow capability
// (p8-secfix-f F2: `ro=1`, writes 403). The shell's access model must say the same thing: Viewing, no toolbar,
// not a Can edit promise the frame refuses. Desktop and full-role sessions are unchanged; comments keep
// following the grant.

import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasUrl, setCanvasCaps } from '../client/canvas-url.js';
import {
  canEditOn,
  editsInAppOnly,
  viewerModeOn,
  WORDS,
} from '../client/v2/access/access-client.js';
import { ViewOnlyTip } from '../client/v2/access/ask-to-edit.jsx';
import { accessStatus } from '../client/v2/shell/save-status.js';

const A = '.design/ui/a.tsx';
const canvasOnly = (r: string) => ({
  designRel: '.design',
  canvasOrigin: 'http://canvas.test',
  readOnly: true,
  readOnlyReason: 'role',
  formatGate: null,
  access: { role: null, grants: [{ c: 'ui/a.tsx', r }] },
});
const cloudCanvasOnly = (r: string) => ({ ...canvasOnly(r), cloud: { role: null } });
const q = (cfg: unknown, k: string) => new URL(canvasUrl(A, cfg), 'http://x').searchParams.get(k);

afterEach(() => setCanvasCaps({}));

describe('the shell says Viewing where the frame is read-only', () => {
  test('cloud, canvas-only Can edit: Viewing, not editable (the same condition as the frame ro)', () => {
    setCanvasCaps({ 'ui/a.tsx': 'follow-cap-a' });
    const cfg = cloudCanvasOnly('member');
    expect(q(cfg, 'ro')).toBe('1');
    expect(canEditOn(cfg, 'ui/a.tsx')).toBe(false);
    expect(viewerModeOn(cfg, A)).toBe(true);
  });

  test('desktop, canvas-only Can edit stays editable', () => {
    const cfg = canvasOnly('member');
    expect(viewerModeOn(cfg, A)).toBe(false);
    expect(canEditOn(cfg, 'ui/a.tsx')).toBe(true);
    expect(q(cfg, 'ro')).toBeNull();
  });

  test('cloud, full-role member stays editable (project-wide capability)', () => {
    const cfg = {
      designRel: '.design',
      canvasOrigin: 'http://canvas.test',
      readOnly: false,
      cloud: { role: 'member' },
      canvasToken: 'project-cap',
      access: { role: 'member', grants: [] },
    };
    expect(viewerModeOn(cfg, A)).toBe(false);
    expect(q(cfg, 'ro')).toBeNull();
  });

  test('comments keep following the grant: Can comment and Can edit on the cloud canvas keep cm', () => {
    expect(q(cloudCanvasOnly('viewer'), 'cm')).toBe('1');
    expect(q(cloudCanvasOnly('member'), 'cm')).toBe('1');
    expect(q(cloudCanvasOnly('observer'), 'cm')).toBeNull();
  });
});

describe('and says why in plain words', () => {
  test('editsInAppOnly: only a cloud canvas-only session whose grant is Can edit or up', () => {
    expect(editsInAppOnly(cloudCanvasOnly('member'), 'ui/a.tsx')).toBe(true);
    expect(editsInAppOnly(cloudCanvasOnly('member'), 'ui/b.tsx')).toBe(false);
    expect(editsInAppOnly(cloudCanvasOnly('viewer'), 'ui/a.tsx')).toBe(false);
    expect(editsInAppOnly(canvasOnly('member'), 'ui/a.tsx')).toBe(false);
  });

  test('the tip and the status chip carry the note; no Ask to edit for someone who can edit', () => {
    expect(WORDS.appOnlyTitle('Combine-kampan')).toBe(
      'You can look at Combine-kampan here, not change it.'
    );
    expect(WORDS.appOnlyLine).toBe(
      'You can edit it in the desktop app. Editing one canvas in a browser comes later.'
    );
    expect(accessStatus({ canEdit: false, role: 'member', appOnly: true })).toEqual({
      word: 'Can edit',
      action: null,
    });
    expect(accessStatus({ canEdit: false, role: 'viewer' })?.action).toBe('Ask to edit');
  });

  test('the view-only tip says the app note when appOnly, the Ask to edit line otherwise', () => {
    const tip = (appOnly: boolean) =>
      renderToStaticMarkup(
        createElement(ViewOnlyTip as never, { canvas: 'ui/Combine-kampan.tsx', appOnly } as never)
      );
    expect(tip(true)).toContain('here, not change it.');
    expect(tip(true)).toContain('You can edit it in the desktop app.');
    expect(tip(true)).not.toContain('Ask to edit');
    expect(tip(false)).toContain('Ask to edit, top right');
  });
});
