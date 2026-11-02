// gate-b-c4f — the file a canvas page names in its own requests. Headless callers
// (`maude design screenshot`, `canvas-rects`) open the shell with `_active.json`'s repo-relative
// `canvas=.design/ui/x.tsx`; prefixing that again named `.design/.design/ui/x.tsx`, outside the
// capture frame's scope, so the comments/annotations reads were refused (403) and a playwright
// capture waiting for network idle never got it.

import { describe, expect, test } from 'bun:test';
import { shellCanvasFile } from '../shell-canvas-file.ts';

const SHELL = '/_canvas-shell.html';

describe('shellCanvasFile', () => {
  test('a designRoot-relative canvas param is prefixed with the design root', () => {
    expect(shellCanvasFile(SHELL, '?canvas=ui%2Fx.tsx')).toBe('.design/ui/x.tsx');
    expect(shellCanvasFile('/_canvas-shell', '?canvas=ui/x.tsx&designRel=design')).toBe(
      'design/ui/x.tsx'
    );
  });

  test('a repo-relative canvas param (what screenshot / canvas-rects pass) is not prefixed twice', () => {
    expect(shellCanvasFile(SHELL, '?canvas=.design%2Fui%2Fx.tsx&fc=abc')).toBe('.design/ui/x.tsx');
    expect(shellCanvasFile(SHELL, '?canvas=/.design/ui/x.tsx')).toBe('.design/ui/x.tsx');
    expect(shellCanvasFile(SHELL, '?canvas=design/ui/x.tsx&designRel=/design/')).toBe(
      'design/ui/x.tsx'
    );
  });

  test('only the design root itself is stripped, not a look-alike segment', () => {
    expect(shellCanvasFile(SHELL, '?canvas=.designs/x.tsx')).toBe('.design/.designs/x.tsx');
  });

  test('no canvas names no file; a legacy page names its own path', () => {
    expect(shellCanvasFile(SHELL, '')).toBeNull();
    expect(shellCanvasFile(SHELL, '?canvas=')).toBeNull();
    expect(shellCanvasFile('/.design/old%20mock.html', '')).toBe('.design/old mock.html');
  });
});
