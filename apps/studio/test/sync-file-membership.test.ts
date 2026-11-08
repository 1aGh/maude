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
  LEGACY_MAX_SEGMENTS,
  MAX_SEGMENTS,
  olderDoorRefuses,
  olderDoorRefusesAdded,
  olderDoorRefusesDepth,
} from '../sync/file-membership.ts';
import {
  ASSET_ADDED_CAPABILITY,
  FILE_CLASSES_V2_CAPABILITY,
  FILE_DEPTH_V2_CAPABILITY,
  hasAssetAddedV1,
  hasFileClassesV2,
  hasFileDepthV2,
} from '../sync/journal-client.ts';
// The classifier every deployed 1.x hub judges a push with (issue #175) — a frozen copy.
import * as hubV110 from './fixtures/hub-v1.10.0-file-membership.mjs';

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
    // S8 asset sidecars (contract S8-asset-sidecars §5.1–§5.2): the per-use photo
    // edit (dot spelling) and the generation provenance sidecar.
    ['assets/0a1b2c3d.9f8e7d6c.photo.json', 'companion-text'],
    ['assets/0a1b2c3d.9f8e7d6c0b1a.photo.json', 'companion-text'],
    ['assets/0a1b2c3d.gen.json', 'companion-text'],
    // #172 — who added the asset (contract 172-asset-origins.md): versioned, rides with its asset.
    ['assets/0a1b2c3d.added.json', 'companion-text'],
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
    expect(classifyProjectFile('gen.json')).toBe('never');
    // The plan's `~` spelling never syncs — the S8 contract chose the dot (§3).
    expect(classifyProjectFile('assets/0a1b2c3d~9f8e7d6c.photo.json')).toBe('never');
  });
});

// p8-hub-folder-boundary (decision maude/v2-michal-hub-is-the-folder-boundary-before-config, option A):
// until the owner declares canvas folders, a hub is the folder boundary — `canvasGroups: null` says
// "this checkout declared none", and every top folder the kernel's canvas-path rule accepts is a
// group. A teammate's `components/x.tsx` was `code-module` (owner-only) while the kernel took it as
// a canvas.
describe('file-membership — an undeclared hub checkout (canvasGroups: null)', () => {
  const undeclared: ClassifyOptions = { canvasGroups: null };

  test("a teammate's folder is a canvas group, never owner-only code", () => {
    expect(classifyProjectFile('components/x.tsx', undeclared)).toBe('canvas-owned');
    expect(classifyProjectFile('screens/home.tsx', undeclared)).toBe('canvas-owned');
    expect(classifyProjectFile('screens/home.meta.json', undeclared)).toBe('canvas-owned');
    const tree = { ...undeclared, hasFile: (r: string) => r === 'screens/home.tsx' };
    expect(classifyProjectFile('screens/home.css', tree)).toBe('canvas-owned');
  });

  test('what is code by the path rules stays code', () => {
    // the kernel refuses a canvas at the design root (it must sit inside a group): still a module
    expect(classifyProjectFile('x.tsx', undeclared)).toBe('code-module');
    expect(classifyProjectFile('components/util.ts', undeclared)).toBe('code-module');
    expect(classifyProjectFile('system/ds/preview/_brand-css.ts', undeclared)).toBe('code-module');
    // a dotted top folder is outside the kernel's group charset
    expect(classifyProjectFile('lib.v2/x.tsx', undeclared)).toBe('code-module');
  });

  test('the default groups answer exactly as before', () => {
    for (const rel of [
      'system/ds/preview/specimen.tsx',
      'system/ds/components/button.tsx',
      'system/ds/preview/_layout.css',
      'system/ds/tokens.json',
      'ui/card.tsx',
      'ui/card.meta.json',
      'assets/x.png',
      'config.json',
      '_history/x.css',
    ]) {
      expect(`${rel} → ${classifyProjectFile(rel, undeclared)}`).toBe(
        `${rel} → ${classifyProjectFile(rel)}`
      );
    }
  });

  // #167 T5.3 — the boundary makes a teammate's top folder a canvas group, never a design-system
  // home: `<folder>/<ds>/tokens.json` is DS data only under a group the owner declared (or the
  // default system/ui), so an undeclared folder's manifests stay default-closed.
  test('a DS manifest counts only under a declared (or default) group', () => {
    for (const rel of [
      'brand/acme/tokens.json',
      'brand/acme/components.json',
      'brand/acme/revisions/head.json',
      `brand/acme/revisions/${'ab'.repeat(32)}.json`,
    ]) {
      expect(`${rel} → ${classifyProjectFile(rel, undeclared)}`).toBe(`${rel} → never`);
      expect(`${rel} → ${hub.classifyProjectFile(rel, undeclared)}`).toBe(`${rel} → never`);
    }
    expect(classifyProjectFile('system/acme/tokens.json', undeclared)).toBe('companion-text');
    expect(
      classifyProjectFile('brand/acme/tokens.json', { canvasGroups: [{ path: 'brand' }] })
    ).toBe('companion-text');
  });

  test('declared groups still rule; absent groups (a desktop copy) are not undeclared', () => {
    const declared: ClassifyOptions = { canvasGroups: [{ path: 'screens' }] };
    expect(classifyProjectFile('screens/home.tsx', declared)).toBe('canvas-owned');
    expect(classifyProjectFile('components/x.tsx', declared)).toBe('code-module');
    expect(classifyProjectFile('components/x.tsx')).toBe('code-module');
    expect(classifyProjectFile('components/x.tsx', { canvasGroups: [] })).toBe('code-module');
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
    '_canvas-state/asset-origins.json', // S8 §5.4 — per Mac, never synced
    '_export-history.json',
    '_cache/blobs/9f2c1d0e5b7a4e3f8c6d2b1a0e9f8d7c6b5a4e3f2d1c0b9a8f7e6d5c4b3a2f10.jpg',
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
    `${'d/'.repeat(32)}x.png`, // 33 segments — past the depth cap (fix/205 raised it from 8)
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
    '_canvas-state/asset-origins.json', // S8 §5.4 — the per-Mac original path
    '_state/s.json',
    '_chat/c.json',
    '_comments/ui-card.json',
    '_untrusted/INDEX.json',
    '_export-jobs/j.json',
    // Cell materializer: the blob cache is content-addressed and disposable —
    // if it ever entered the file plane, every evicted photo would look
    // like a deletion to every peer.
    '_cache/blobs/9f2c1d0e5b7a4e3f8c6d2b1a0e9f8d7c6b5a4e3f2d1c0b9a8f7e6d5c4b3a2f10',
    '_cache/tmp/fill-1a2b',
    '.kgai/store/log/a.ndjson',
    // V2-2.16 — v2's runtime paths: one new class, the rest under `_state/`.
    '_runs/sess-1/snap/toolu_01',
    '_runs/shots.jsonl',
    '_state/runs/run_01.json',
    // S5.3 — the run registry's record and its tmp-before-rename sibling (ai/runs.ts persist)
    '_state/runs/x.json',
    '_state/runs/r_0123456789ab.json.4242.tmp',
    '_state/outbox/intents/1760000000000-i_abcdefghij0123456789.json',
    // S5.10 — this Mac's folder grants for the AI chat (routes/chat-attach.ts): never synced
    '_state/ai-grants.json',
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
    // fix/207 — nested `_` modules are the user's files; only the first segment is runtime
    'system/studyfi-v3/preview/_ui-feedback.tsx',
    'system/studyfi-v3/preview/_ui-feedback.css',
    'ui/club-web/_frames.tsx',
    'system/ds/preview/_state.tsx',
    'system/ds/preview/_history.tsx',
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
    // fix/207 — a DS's `_` module and its stylesheet (design.studyfi.com)
    'system/studyfi-v3/preview/_ui-feedback.tsx',
    'system/studyfi-v3/preview/_ui-feedback.css',
    '_ui-feedback.tsx',
    '_state/ui-feedback.tsx',
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
    // S8 asset sidecars — the per-use edit, the provenance sidecar, the rejected `~`
    'assets/0a1b2c3d.9f8e7d6c.photo.json',
    'assets/0a1b2c3d.gen.json',
    'assets/0a1b2c3d~9f8e7d6c.photo.json',
    'evil.gen.json.txt',
    '_canvas-state/asset-origins.json',
    // #172 — who added the asset: synced on both copies, never runtime state
    'assets/0a1b2c3d.added.json',
    'evil.added.json.txt',
    // V2-1.12 C1 / V2-1.6 / V2-1.10 — versioned v2 companions, both copies
    'system/ds/tokens.json',
    'system/ds/components.json',
    'system/ds/revisions/head.json',
    `system/ds/revisions/${'ab'.repeat(32)}.json`,
    'system/ds/revisions/not-hex.json',
    'assets/ab12cd34.transcript.json',
    'assets/ab12cd34.beats.json',
    '_runs/shots.jsonl',
    '',
    'dir/file.png ',
    'system/_private/x.css',
    '.kgai/store/log/a.ndjson',
    // p8-hub-folder-boundary — a teammate's folders in an undeclared checkout
    'components/x.tsx',
    'screens/home.tsx',
    'screens/home.meta.json',
    'screens/home.css',
    'screens/home.annotations.json',
    'brand/acme/tokens.json',
    'lib.v2/x.tsx',
    'x.tsx',
  ];

  const optVariants: Array<[string, ClassifyOptions]> = [
    ['no opts', {}],
    ['declared groups', { canvasGroups: [{ path: 'ui' }, { path: 'system' }] }],
    ['custom group', { canvasGroups: [{ path: 'mocks' }] }],
    ['undeclared hub checkout', { canvasGroups: null }],
    [
      'undeclared hub checkout with tree knowledge',
      { canvasGroups: null, hasFile: (rel: string) => rel === 'screens/home.tsx' },
    ],
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

// Issue #175 — a 2.0 desktop offered a 1.10.0 hub 19 files its door refuses (`400 invalid path`)
// and retried them forever. The desktop now holds exactly the files an older door refuses, and
// only for a hub that does not advertise `file-classes-v2`.
describe('olderDoorRefuses — exactly what a 1.x door refuses that 2.0 syncs', () => {
  const groups = [{ path: 'system' }, { path: 'ui' }];
  const corpus = [
    // the field report's shapes
    'assets/0f3a9c21.transcript.json',
    'system/studyfi-web/tokens.json',
    'system/studyfi-v3/tokens.json',
    // the rest of what 2.0 added
    'assets/0f3a9c21.beats.json',
    'assets/0f3a9c21.gen.json',
    'assets/0f3a9c21.added.json', // #172
    'system/ds/components.json',
    'system/ds/revisions/head.json',
    `system/ds/revisions/${'a'.repeat(64)}.json`,
    // what both take
    'assets/0f3a9c21.photo.json',
    'assets/0f3a9c21.12345678.photo.json',
    'assets/clip.audio.json',
    'assets/clip.footage.json',
    'system/ds/x.registry.json',
    'ui/reel.edl.json',
    'assets/hero.png',
    'system/ds/brand.css',
    'assets/captions.vtt',
    'ui/notes.md',
    'system/ds/_brand.ts',
    // what neither takes
    'config.json',
    'assets/data.json',
    'ui/a.tsx',
    'ui/a.meta.json',
    '_sync.json',
  ];

  test('pinned against the 1.10.0 classifier: held ⇔ 2.0 syncs it and 1.10.0 does not', () => {
    for (const rel of corpus) {
      const now = isFilePlaneClass(classifyProjectFile(rel, { canvasGroups: groups }));
      const then = hubV110.isFilePlaneClass(
        hubV110.classifyProjectFile(rel, { canvasGroups: groups })
      );
      const held = now && olderDoorRefuses(rel);
      expect({ rel, held }).toEqual({ rel, held: now && !then });
    }
  });

  test('the field report’s paths are all held for a 1.x hub', () => {
    for (const rel of corpus.slice(0, 3)) expect(olderDoorRefuses(rel)).toBe(true);
  });

  test('the capability decides: absent (every 1.x hub, or an unreadable /health) holds them', () => {
    expect(FILE_CLASSES_V2_CAPABILITY).toBe('file-classes-v2');
    expect(hasFileClassesV2(['ledger', 'annotations-v2', 'format-v2'])).toBe(false); // 1.10.0
    expect(hasFileClassesV2(null)).toBe(false);
    expect(hasFileClassesV2(['ledger', 'format-v2', 'file-classes-v2'])).toBe(true);
  });

  test('the current hub mirror takes them — the 2.0 door is not the bug', () => {
    for (const rel of corpus.slice(0, 8)) {
      expect(hub.isFilePlaneClass(hub.classifyProjectFile(rel, { canvasGroups: groups }))).toBe(
        true
      );
    }
  });
});

// fix/205-sync-assets — the studyfi first sync: a 3D asset pack (`…/Models/GLTF format/…`) sat
// deeper than the old 8-segment cap, both classifiers answered `never`, and the files were dropped
// with no row anywhere. The cap is now 32 in BOTH; the 512-character cap still bounds a path.
describe('deep paths — the depth cap is 32, the same in both classifiers', () => {
  const groups = [{ path: 'system' }, { path: 'ui' }];
  const deep = [
    'system/kenney/assets/pack/Models/GLTF format/Textures/colormap.png', // 8 — always took
    'assets/kenney/space-kit/Models/GLTF format/Textures/variants/v1/colormap.png', // 9
    'system/kenney/assets/space kit/Models/GLTF format/Textures/variants/a/b/colormap.png', // 11
    `assets/${'d/'.repeat(30)}x.png`, // 32 — the cap itself
  ];

  test('both caps are 32; the old figure is named for the older-hub hold', () => {
    expect(MAX_SEGMENTS).toBe(32);
    expect(hub.MAX_SEGMENTS).toBe(MAX_SEGMENTS);
    expect(LEGACY_MAX_SEGMENTS).toBe(8);
  });

  test('a deep media path flows in the studio AND the hub', () => {
    for (const rel of deep) {
      expect(`${rel} → ${classifyProjectFile(rel, { canvasGroups: groups })}`).toBe(
        `${rel} → inert-media`
      );
      expect(`${rel} → ${hub.classifyProjectFile(rel, { canvasGroups: groups })}`).toBe(
        `${rel} → inert-media`
      );
      expect(isProjectFileShape(rel)).toBe(true);
      expect(hub.isProjectFileShape(rel)).toBe(true);
    }
  });

  test('past 32 is refused by both — still a shape, never a silent class', () => {
    const tooDeep = `assets/${'d/'.repeat(31)}x.png`; // 33
    expect(classifyProjectFile(tooDeep)).toBe('never');
    expect(hub.classifyProjectFile(tooDeep)).toBe('never');
  });

  test('olderDoorRefusesDepth: exactly the paths deeper than an older door takes', () => {
    expect(olderDoorRefusesDepth(deep[0] as string)).toBe(false);
    for (const rel of deep.slice(1)) expect(olderDoorRefusesDepth(rel)).toBe(true);
    // Pinned against the frozen 1.10.0 classifier: what we hold is what it refuses.
    for (const rel of deep) {
      const then = hubV110.isFilePlaneClass(
        hubV110.classifyProjectFile(rel, { canvasGroups: groups })
      );
      expect({ rel, held: olderDoorRefusesDepth(rel) }).toEqual({ rel, held: !then });
    }
  });

  test('the capability decides: absent holds them', () => {
    expect(FILE_DEPTH_V2_CAPABILITY).toBe('file-depth-v2');
    expect(hasFileDepthV2(null)).toBe(false);
    expect(hasFileDepthV2(['ledger', 'file-classes-v2'])).toBe(false);
    expect(hasFileDepthV2(['ledger', 'file-classes-v2', 'file-depth-v2'])).toBe(true);
  });
});

// #172 — the who-added sidecar came after `file-classes-v2`: its own word, its own hold.
describe('asset-added-v1 — the who-added sidecar waits for a hub that takes it', () => {
  test('exactly `.added.json` is held, and only for a hub without the word', () => {
    expect(ASSET_ADDED_CAPABILITY).toBe('asset-added-v1');
    expect(olderDoorRefusesAdded('assets/a1b2c3d4.added.json')).toBe(true);
    expect(olderDoorRefusesAdded('assets/hero.ADDED.json')).toBe(true);
    for (const rel of ['assets/a1b2c3d4.png', 'assets/a1b2c3d4.gen.json', 'assets/added.json'])
      expect(olderDoorRefusesAdded(rel)).toBe(false);
    expect(hasAssetAddedV1(null)).toBe(false);
    expect(hasAssetAddedV1(['ledger', 'file-classes-v2', 'file-depth-v2'])).toBe(false);
    expect(hasAssetAddedV1(['ledger', 'file-classes-v2', 'asset-added-v1'])).toBe(true);
  });
});
