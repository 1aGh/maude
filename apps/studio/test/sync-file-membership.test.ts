// The file plane's membership policy — unit coverage plus the two parity pins
// that make the classifier trustworthy:
//
//   1. The DDR-115 runtime-state replica vs `git/service.ts`'s
//      `isMaudeRuntimeState` — the 4th-copy tripwire. Three copies of this
//      list drifted silently before; this test makes the drift a red test.
//   2. The hub `.mjs` mirror vs this `.ts` implementation over an adversarial
//      corpus (the doc-name precedent — the bun test imports the hub file
//      across the package boundary on purpose).

import { describe, expect, test } from 'bun:test';

// The HUB's implementation, imported across the package boundary on purpose —
// this file is what pins the two classifiers to each other.
import * as hub from '../../hub/src/file-membership.mjs';
import { isMaudeRuntimeState } from '../git/service.ts';
import {
  type ClassifyOptions,
  classifyProjectFile,
  type FileClass,
  isFilePlaneClass,
  isProjectFileShape,
  isRuntimeStateRel,
} from '../sync/file-membership.ts';

describe('file-membership — the RCA miss-list flows', () => {
  // The 103-file gap, by shape (RCA
  // issue-fresh-link-gets-canvases-but-not-the-design-system): every file the
  // fresh link lost must classify into a flowing class.
  const missList: Array<[string, FileClass]> = [
    ['system/alligators/assets/logos/logo.svg', 'inert-media'],
    ['system/alligators/assets/logos/logo-mono.svg', 'inert-media'],
    ['system/alligators/assets/fonts/lexend.woff2', 'inert-media'],
    ['system/alligators/assets/fonts/lexend-bold.ttf', 'inert-media'],
    ['system/alligators/assets/photos/P1020428.JPG', 'inert-media'],
    ['system/alligators/assets/photos/team.jpeg', 'inert-media'],
    ['system/alligators/preview/_brand-css.ts', 'code-module'],
    ['system/alligators/preview/_layout.css', 'companion-text'],
    ['system/alligators/preview/_components.css', 'companion-text'],
    ['system/alligators/preview/_marketing.css', 'companion-text'],
    ['system/alligators/brand.css', 'companion-text'],
    ['system/alligators/colors_and_type.css', 'companion-text'],
    ['system/alligators/README.md', 'companion-text'],
    ['system/alligators/SKILL.md', 'companion-text'],
    ['assets/c0fa9c7f.png', 'inert-media'],
    // Found by the Task-12 acceptance on the real tree: Maude's own sidecar
    // vocabulary, suffix-enumerated (never bare .json).
    ['assets/066a990a.photo.json', 'companion-text'],
    ['assets/46a07c5e.audio.json', 'companion-text'],
    ['assets/47d9b6d1.srt', 'companion-text'],
    // Found by the T32 scale run: versioned sidecars that never reached a peer.
    ['assets/5f2a1c9e.footage.json', 'companion-text'],
    ['ui/Card.registry.json', 'companion-text'],
    ['ui-reel.edl.json', 'companion-text'],
    ['assets/47d9b6d1.vtt', 'companion-text'],
  ];

  test.each(missList)('%s → %s', (rel, expected) => {
    expect(classifyProjectFile(rel)).toBe(expected);
  });

  test('every miss-list class is a file-plane class', () => {
    for (const [rel] of missList) {
      expect(isFilePlaneClass(classifyProjectFile(rel))).toBe(true);
    }
  });
});

describe('file-membership — canvas-owned is Plane A, never Plane B', () => {
  test('a canvas body and its named sidecars', () => {
    expect(classifyProjectFile('ui/card.tsx')).toBe('canvas-owned');
    expect(classifyProjectFile('ui/card.meta.json')).toBe('canvas-owned');
    expect(classifyProjectFile('ui/card.annotations.svg')).toBe('canvas-owned');
    expect(classifyProjectFile('system/alligators/preview/specimen.tsx')).toBe('canvas-owned');
    // The scan's own quirk is honoured: a leading-underscore `.tsx` inside a
    // group DOES sync as a canvas today (`_kit.tsx` on alligators), so it is
    // canvas-owned here too — the planes must agree on ownership.
    expect(classifyProjectFile('system/alligators/preview/_kit.tsx')).toBe('canvas-owned');
  });

  test('the sibling .css split needs the tree, and both answers are honoured', () => {
    const withSibling: ClassifyOptions = {
      hasFile: (rel) => rel === 'system/ds/preview/specimen.tsx',
    };
    // `specimen.css` beside `specimen.tsx` IS that canvas's Yjs css lane.
    expect(classifyProjectFile('system/ds/preview/specimen.css', withSibling)).toBe('canvas-owned');
    // `brand.css` has no sibling body — it is the RCA's missing stylesheet.
    expect(classifyProjectFile('system/ds/brand.css', withSibling)).toBe('companion-text');
    // No tree knowledge ⇒ the flowing side; the receiver re-checks anyway.
    expect(classifyProjectFile('system/ds/preview/specimen.css')).toBe('companion-text');
  });

  test('group membership is case-insensitive, mirroring canvas-path rule 8', () => {
    expect(classifyProjectFile('UI/card.tsx')).toBe('canvas-owned');
  });

  test('declared canvasGroups replace the default set', () => {
    const opts: ClassifyOptions = { canvasGroups: [{ path: 'mocks' }] };
    expect(classifyProjectFile('mocks/screen.tsx', opts)).toBe('canvas-owned');
    // `ui/` is not a group in THIS project ⇒ a .tsx there is a shared module.
    expect(classifyProjectFile('ui/screen.tsx', opts)).toBe('code-module');
  });

  test('a .tsx outside every canvas group is a code module, not a canvas', () => {
    expect(classifyProjectFile('lib/helpers.tsx')).toBe('code-module');
    expect(classifyProjectFile('_shared.tsx')).toBe('code-module');
  });

  test('.meta.json / .annotations.svg outside a group do not leak into the plane', () => {
    // `.json` is not positively enumerated; a stray meta sidecar stays home.
    expect(classifyProjectFile('notes/thing.meta.json')).toBe('never');
    // A stray annotations svg in an unrelated SUBFOLDER is just an svg…
    expect(classifyProjectFile('notes/thing.annotations.svg')).toBe('inert-media');
  });

  test("the FLAT annotations sidecar is Plane A's — the two-lane erase", () => {
    // Annotations live flat at the design root, keyed by slug
    // (`ui-2.annotations.svg`) — the naming asymmetry the canvas artifacts
    // vocabulary documents. The in-group rule never fires for that shape, so
    // they classified `inert-media` and the FILE plane carried a file the DOC
    // lane already owns. Two lanes, two conflict semantics, no shared
    // ancestor: a stale doc-lane materialisation on one peer read as a fresh
    // local edit to the file plane, was pushed, and erased a drawing made
    // seconds earlier on the other machine (417 B of strokes at 10:50:28, an
    // empty 72 B wrapper over them at 10:50:33 — live journal rows).
    expect(classifyProjectFile('ui-2.annotations.svg')).toBe('canvas-owned');
    expect(classifyProjectFile('ui-ahoj.annotations.svg')).toBe('canvas-owned');
    // But a root-level svg that is NOT an annotations sidecar still flows.
    expect(classifyProjectFile('logo.svg')).toBe('inert-media');
  });

  test('the sidecar suffixes flow; bare .json stays default-closed', () => {
    expect(classifyProjectFile('assets/066a990a.photo.json')).toBe('companion-text');
    expect(classifyProjectFile('assets/46a07c5e.audio.json')).toBe('companion-text');
    expect(classifyProjectFile('assets/47d9b6d1.srt')).toBe('companion-text');
    expect(classifyProjectFile('assets/data.json')).toBe('never');
    expect(classifyProjectFile('photo.json')).toBe('never'); // the suffix, alone, is not a name
  });
});

describe('file-membership — never means never', () => {
  const nevers = [
    'config.json', // the design root's trust anchors
    '_server.json',
    '_active.json',
    '_active.sess-abc123.json', // the per-member D3 sibling
    '_sync.json',
    '_preflight.json',
    '_server.lock',
    '_server.log',
    '_untrusted/INDEX.json',
    '_history/ui-card/2026-08-14.tsx',
    '_trash/old-deleted-123/old.tsx',
    '_canvas-state/ui-card.view.json',
    '_export-history.json',
    'system/ds/_history/x.png', // nested runtime state
    '.kgai/store/log/a.ndjson',
    '.DS_Store', // dotfile
    'data.json', // unclassified extension — default-closed
    'archive.zip',
    'script.sh',
    'binary.wasm',
  ];

  test.each(nevers.map((n) => [n]))('%s → never', (rel) => {
    expect(classifyProjectFile(rel)).toBe('never');
  });
});

describe('file-membership — shape gates', () => {
  const malformed = [
    '', // empty
    '../escape.png',
    'a/../escape.png',
    '/etc/passwd',
    'a\\b.png',
    'C:evil.png',
    '..%2f..%2fetc%2fpasswd', // percent shapes never decode here — charset refusal
    'a/b/c/d/e/f/g/h/i.png', // 9 segments
    'a//b.png', // empty segment
    'a/./b.png',
    `${'x'.repeat(513)}.png`, // over the length cap
    'node_modules/react/index.js',
    'a\u0000b.png', // control character
    'dir /file.png', // trailing-space segment
    'dir/file.png ', // trailing-space final segment
    '_dir/file.css', // leading underscore on a DIRECTORY segment
    'system/_private/x.css',
  ];

  test.each(malformed.map((m) => [m]))('%j → never', (rel) => {
    expect(classifyProjectFile(rel)).toBe('never');
  });

  test('a leading underscore is allowed on the FINAL segment only', () => {
    expect(classifyProjectFile('_brand-css.ts')).toBe('code-module');
    expect(classifyProjectFile('system/ds/preview/_layout.css')).toBe('companion-text');
    expect(classifyProjectFile('_history/x.css')).toBe('never');
  });

  test('extensions match case-insensitively', () => {
    expect(classifyProjectFile('assets/PHOTO.PNG')).toBe('inert-media');
    expect(classifyProjectFile('system/ds/BRAND.CSS')).toBe('companion-text');
  });
});

describe('file-membership — the DDR-115 replica tripwire (4th copy)', () => {
  // Every shape the runtime-state taxonomy names, plus content that must NOT
  // match. If `git/service.ts` gains a new runtime path and this replica does
  // not, this list makes the drift a failing test instead of a leak.
  const fixtures = [
    '_server.json',
    '_active.json',
    '_active.sess-1.json',
    '_sync.json',
    '_preflight.json',
    '_locator.json',
    '_export-history.json',
    '_generate-history.json',
    '_server.lock',
    '_server.log',
    '_history/ui-card/x.tsx',
    '_trash/gone-123/gone.tsx',
    '_draw/proof.tsx',
    '_photo/edit.json',
    '_smoke/report.json',
    '_reports/r.md',
    '_canvas-state/ui-card.view.json',
    '_state/s.json',
    '_chat/c.json',
    '_comments/ui-card.json',
    '_untrusted/INDEX.json',
    '_export-jobs/j.json',
    '.kgai/store/log/a.ndjson',
    'nested/_history/x.png',
    'nested/.kgai/y',
    '_history',
    '_trash',
    // …and the content side, which must NOT be runtime state:
    'ui/card.tsx',
    'ui/card.annotations.svg',
    'system/ds/brand.css',
    'system/ds/preview/_brand-css.ts',
    'system/ds/preview/_layout.css',
    'assets/x.png',
    'config.json',
    '_brandish.json', // close to `_active.json`'s shape, not in the taxonomy
    'history/x.png', // no underscore — a real folder named history
  ];

  test('isRuntimeStateRel agrees with git/service.ts isMaudeRuntimeState', () => {
    for (const p of fixtures) {
      expect(`${p} → ${isRuntimeStateRel(p)}`).toBe(`${p} → ${isMaudeRuntimeState(p)}`);
    }
  });
});

describe('file-membership — studio ↔ hub parity (the doc-name precedent)', () => {
  // Every corpus above, concatenated, plus the fixture set Task 2 names —
  // both classifiers must agree byte-for-byte on every one of them, with and
  // without tree knowledge and group config.
  const corpus = [
    // The RCA miss-list shapes
    'system/alligators/assets/logos/logo.svg',
    'system/alligators/assets/fonts/lexend.woff2',
    'system/alligators/assets/photos/P1020428.JPG',
    'system/alligators/preview/_brand-css.ts',
    'system/alligators/preview/_layout.css',
    'system/alligators/preview/_components.css',
    'system/alligators/preview/_marketing.css',
    'system/alligators/brand.css',
    'system/alligators/colors_and_type.css',
    'system/alligators/README.md',
    'system/alligators/SKILL.md',
    'system/ds/assets/logos/x.svg',
    'assets/x.png',
    // Canvas-owned
    'ui/card.tsx',
    'ui/card.meta.json',
    'ui/card.annotations.svg',
    'system/ds/preview/specimen.tsx',
    'system/ds/preview/specimen.css',
    // Never / adversarial
    'config.json',
    '_untrusted/INDEX.json',
    '_server.json',
    '_active.sess-1.json',
    '..%2f..%2fetc%2fpasswd',
    '../escape.png',
    'a/b/c/d/e/f/g/h/i.png',
    'a\\b.png',
    '/etc/passwd',
    'C:evil.png',
    'a\u0000b.png',
    'node_modules/react/index.js',
    '_brand-css.ts',
    'preview/_layout.css',
    '_history/x.css',
    '.DS_Store',
    'data.json',
    'assets/066a990a.photo.json',
    'assets/46a07c5e.audio.json',
    'assets/47d9b6d1.srt',
    'assets/5f2a1c9e.footage.json',
    'ui/Card.registry.json',
    'ui-reel.edl.json',
    'assets/47d9b6d1.vtt',
    'evil.photo.json.txt', // the suffix must END the name
    '',
    'dir/file.png ',
    'system/_private/x.css',
    '.kgai/store/log/a.ndjson',
  ];

  const optVariants: Array<[string, ClassifyOptions]> = [
    ['no opts', {}],
    ['declared groups', { canvasGroups: [{ path: 'ui' }, { path: 'system' }] }],
    ['custom group', { canvasGroups: [{ path: 'mocks' }] }],
    [
      'with tree knowledge',
      {
        hasFile: (rel: string) => rel === 'system/ds/preview/specimen.tsx' || rel === 'ui/card.tsx',
      },
    ],
  ];

  for (const [label, opts] of optVariants) {
    test(`classifyProjectFile agrees (${label})`, () => {
      for (const rel of corpus) {
        const mine = classifyProjectFile(rel, opts);
        const theirs = hub.classifyProjectFile(rel, opts) as FileClass;
        expect(`${rel} → ${mine}`).toBe(`${rel} → ${theirs}`);
      }
    });
  }

  test('isRuntimeStateRel agrees with the hub replica', () => {
    for (const rel of corpus) {
      expect(`${rel} → ${isRuntimeStateRel(rel)}`).toBe(`${rel} → ${hub.isRuntimeStateRel(rel)}`);
    }
  });

  test('isProjectFileShape agrees with the hub replica', () => {
    for (const rel of corpus) {
      expect(`${rel} → ${isProjectFileShape(rel)}`).toBe(`${rel} → ${hub.isProjectFileShape(rel)}`);
    }
  });

  test('a canvas body never classifies into a file-plane class on either side', () => {
    const bodies = ['ui/card.tsx', 'system/ds/preview/specimen.tsx'];
    for (const rel of bodies) {
      expect(isFilePlaneClass(classifyProjectFile(rel))).toBe(false);
      expect(hub.isFilePlaneClass(hub.classifyProjectFile(rel))).toBe(false);
    }
  });
});
