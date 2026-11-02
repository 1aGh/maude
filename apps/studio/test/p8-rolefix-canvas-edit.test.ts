// p8-e2e-rolefix (2) — after "Let Petra edit" she holds a canvas-only Can edit grant. The shell decided
// editing from `/_config.readOnly`, which is PROJECT-level (`!can('edit', null)`), so her granted canvas
// stayed Viewing with no toolbar and `ro=1` on its frame. The shell now offers what the server allows on
// the OPEN canvas: the higher of the project role and that canvas's grant — and only that canvas.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasUrl } from '../client/canvas-url.js';
import { canEditOn, viewerModeOn } from '../client/v2/access/access-client.js';

const base = { designRel: '.design', readOnly: true, readOnlyReason: 'role', formatGate: null };
const grant = (r: string) => ({
  ...base,
  access: { role: null, grants: [{ c: 'ui/a.tsx', r }] },
});
const ro = (path: string, cfg: unknown) =>
  new URL(canvasUrl(path, cfg), 'http://x').searchParams.get('ro');
const cm = (path: string, cfg: unknown) =>
  new URL(canvasUrl(path, cfg), 'http://x').searchParams.get('cm');

describe('a canvas-only Can edit grant edits that canvas, and only that one', () => {
  test('canvas A with the grant → editing; canvas B without → Viewing', () => {
    const petra = grant('member');
    expect(canEditOn(petra, 'ui/a.tsx')).toBe(true);
    expect(canEditOn(petra, 'ui/b.tsx')).toBe(false);
    expect(viewerModeOn(petra, '.design/ui/a.tsx')).toBe(false);
    expect(viewerModeOn(petra, '.design/ui/b.tsx')).toBe(true);
    expect(viewerModeOn(petra, null)).toBe(true);
    expect(ro('.design/ui/a.tsx', petra)).toBeNull();
    expect(ro('.design/ui/b.tsx', petra)).toBe('1');
  });

  test('Can view / Can comment grants stay Viewing; Can comment keeps its comment lane on its canvas', () => {
    for (const r of ['observer', 'viewer']) {
      expect(viewerModeOn(grant(r), '.design/ui/a.tsx')).toBe(true);
      expect(ro('.design/ui/a.tsx', grant(r))).toBe('1');
    }
    expect(cm('.design/ui/a.tsx', grant('viewer'))).toBe('1');
    expect(cm('.design/ui/a.tsx', grant('observer'))).toBeNull();
    expect(cm('.design/ui/b.tsx', grant('viewer'))).toBeNull();
  });

  test('a format gate keeps everything Viewing, whatever the grant; a project editor edits all', () => {
    const gated = { ...grant('member'), formatGate: { projectFormat: 3 } };
    expect(viewerModeOn(gated, '.design/ui/a.tsx')).toBe(true);
    expect(ro('.design/ui/a.tsx', gated)).toBe('1');
    const editor = {
      designRel: '.design',
      readOnly: false,
      access: { role: 'member', grants: [] },
    };
    expect(viewerModeOn(editor, '.design/ui/b.tsx')).toBe(false);
    expect(ro('.design/ui/b.tsx', editor)).toBeNull();
  });

  test('an older server (no access field) stays as it was: readOnly decides', () => {
    expect(viewerModeOn({ ...base }, '.design/ui/a.tsx')).toBe(true);
    expect(ro('.design/ui/a.tsx', { ...base })).toBe('1');
    expect(viewerModeOn({ designRel: '.design', readOnly: false }, '.design/ui/a.tsx')).toBe(false);
  });

  test('a live grant change switches the open canvas: Can view → Can edit is a new, editable frame', () => {
    const before = grant('observer');
    const after = grant('member');
    expect(viewerModeOn(before, '.design/ui/a.tsx')).toBe(true);
    expect(viewerModeOn(after, '.design/ui/a.tsx')).toBe(false);
    expect(canvasUrl('.design/ui/a.tsx', before)).not.toBe(canvasUrl('.design/ui/a.tsx', after));
  });
});

describe('the shell wiring', () => {
  const src = (p: string) => readFileSync(join(import.meta.dir, '..', p), 'utf8');
  test('viewerMode follows the open canvas', () => {
    expect(src('client/hooks/use-shell-core.jsx')).toMatch(
      /const viewerMode = viewerModeOn\(cfg, activePath\);/
    );
  });
  test('a hubs.json change re-reads /_config (access-changed)', () => {
    expect(src('client/app.jsx')).toMatch(
      /m\.type === 'access-changed'\)\s*\{?\s*(\/\/[^\n]*\n\s*)*loadServerConfig\(\)/
    );
  });
});
