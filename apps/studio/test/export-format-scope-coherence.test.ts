// export-format-scope-coherence.test.ts — DDR-231 Phase 2 T4.
//
// REPRODUCED DEFECT (local, 2026-08-23, workspace-shaped studio + a real
// maude-render service): a cloud PDF or HTML export failed with
//
//   render service refused the job: invalid render job
//
// `POST /_api/export-jobs {format:'pdf', scope:'project-raw'}` is accepted by
// the route (it validates `isFormat` and `isScope` INDEPENDENTLY, never the
// pair), `resolveScope` correctly returns a `file-tree` target for that scope,
// and the render service's `validBody` correctly refuses a file-tree target —
// it names repo paths that process holds no checkout for and must never read.
// Every layer did what it was specified to do; the PAIR was never legal, and
// no layer said so.
//
// The scope table lived in `client/app.jsx` and `export-dialog.tsx` and in
// neither server. It now lives in `exporters/format-scopes.ts`; these tests
// pin the table, the refusal, and — the part that actually closes the bug —
// that the two client copies have not drifted from it.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  defaultScopeForFormat,
  isScopeValidForFormat,
  scopeRefusalMessage,
  VALID_SCOPES_BY_FORMAT,
} from '../exporters/format-scopes.ts';
import { FORMATS } from '../exporters/index.ts';
import { DEV_SERVER_ROOT } from '../paths.ts';

describe('format × scope coherence', () => {
  test('every known format has a scope list', () => {
    for (const f of FORMATS) {
      expect(VALID_SCOPES_BY_FORMAT[f]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('project-raw is legal for zip ONLY — it resolves to a file-tree target', () => {
    for (const f of FORMATS) {
      expect(isScopeValidForFormat(f, 'project-raw')).toBe(f === 'zip');
    }
  });

  test('the exact reproduced pairs are refused', () => {
    // These two are the live failures, verbatim.
    expect(isScopeValidForFormat('pdf', 'project-raw')).toBe(false);
    expect(isScopeValidForFormat('html', 'project-raw')).toBe(false);
    // …while the shapes the dialogs really offer stay legal.
    expect(isScopeValidForFormat('pdf', 'artboard')).toBe(true);
    expect(isScopeValidForFormat('html', 'canvas-as-separate')).toBe(true);
    expect(isScopeValidForFormat('mp4', 'artboard')).toBe(true);
  });

  test('the refusal names the format, the bad scope and the way out', () => {
    const msg = scopeRefusalMessage('pdf', 'project-raw');
    expect(msg).toContain('PDF');
    expect(msg).toContain('project-raw');
    expect(msg).toContain('artboard');
  });

  test('the default scope is the first offered one', () => {
    expect(defaultScopeForFormat('zip')).toBe('project-raw');
    expect(defaultScopeForFormat('pptx')).toBe('canvas-as-separate');
    expect(defaultScopeForFormat('mp4')).toBe('artboard');
  });
});

/**
 * Both dialogs must render pickers from the shared table. A literal map left
 * behind in either client is how the three copies drifted in the first place —
 * `export-dialog.tsx`'s copy was missing mp4/webm/gif entirely.
 */
describe('region scopes (issue #125)', () => {
  test('canvas-whole + selection-bounds are png/pdf only', () => {
    for (const scope of ['canvas-whole', 'selection-bounds']) {
      for (const format of FORMATS) {
        expect(isScopeValidForFormat(format, scope)).toBe(format === 'png' || format === 'pdf');
      }
    }
  });

  test('adding them did not change any default', () => {
    expect(defaultScopeForFormat('png')).toBe('selection');
    expect(defaultScopeForFormat('pdf')).toBe('selection');
  });
});

describe('no client keeps its own copy of the scope table', () => {
  const read = (...p: string[]) => readFileSync(join(DEV_SERVER_ROOT, ...p), 'utf8');

  for (const [file, banned] of [
    ['client/app.jsx', 'EXPORT_VALID_SCOPES = {'],
    ['export-dialog.tsx', 'VALID_SCOPES_PER_FORMAT: Record'],
  ] as const) {
    test(`${file} sources its scopes from exporters/format-scopes.ts`, () => {
      const src = read(...file.split('/'));
      expect(src).not.toContain(banned);
      expect(src).toContain('format-scopes');
    });
  }
});
