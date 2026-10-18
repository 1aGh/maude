// V2-4 gate (roles) — the registry rows a Can comment person must not be offered (V2-4.9's
// "found, not changed" list), and what the shell does with a key or a native menu item the role
// refuses. Contract: V2-1.7 §5.2 (annotate / edit are Can edit's) + §5.9 (no New canvas below
// edit); decision:maude/v2-tool-keys-resolve-for-every-role (a key a viewer may press reaches the
// one denial line rather than going silent).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shellKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import { chord } from '../actions/keys.ts';
import { isEnabled, isVisible, resolveChord } from '../actions/resolve.ts';
import type { KeyCtx } from '../actions/types.ts';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { keyOutcome, roleRefuses } from '../client/v2/shell/role-gate.js';

type Offer = 'offered' | 'greyed' | 'absent';
const offer = (id: string, ctx: KeyCtx): Offer => {
  const def = ACTIONS_BY_ID.get(id);
  if (!def) throw new Error(`no action ${id}`);
  if (!isVisible(def, ctx)) return 'absent';
  return isEnabled(def, ctx) ? 'offered' : 'greyed';
};

// What a Can comment person (role 'comment') gets, per action, with the reason the row records.
const COMMENTER: [string, Offer, string][] = [
  ['canvas.new', 'absent', 'creates a canvas in this project (V2-1.7 §5.9 "No New canvas")'],
  ['canvas.new-video', 'absent', 'creates a canvas'],
  ['video.assemble', 'absent', 'writes a new video canvas'],
  ['artboard.new-desktop', 'absent', 'inserts into the open canvas'],
  ['artboard.new-laptop', 'absent', 'inserts into the open canvas'],
  ['artboard.new-tablet', 'absent', 'inserts into the open canvas'],
  ['artboard.new-mobile', 'absent', 'inserts into the open canvas'],
  ['artboard.new-a4', 'absent', 'inserts into the open canvas'],
  ['artboard.new-letter', 'absent', 'inserts into the open canvas'],
  [
    'select.all-annotations',
    'absent',
    'annotations are selected to change them; annotate is Can edit',
  ],
  ['edit.undo', 'greyed', 'the stack holds edits only (V2-1.5 Q4); ⌘Z → the denial line'],
  ['edit.redo', 'greyed', 'as Undo'],
  ['edit.cut', 'greyed', "the row's canvas branch cuts annotations; ⌘X stays WebKit's"],
  ['edit.paste', 'greyed', "the row's canvas branch pastes annotations; ⌘V stays WebKit's"],
  ['edit.paste-properties', 'greyed', 'writes styles'],
  // Kept: they do not change this project.
  ['edit.copy', 'offered', 'a read'],
  ['edit.copy-properties', 'offered', 'a read, like Copy'],
  ['select.all', 'offered', 'selecting to inspect is looking'],
  ['select.none', 'offered', 'selection is the person’s own'],
  ['project.new', 'offered', 'another project, which the person owns'],
  ['project.open', 'offered', 'another project; this role is per project'],
  ['canvas.close', 'offered', 'the person’s own tabs'],
  ['export.open', 'offered', 'Can comment holds export (V2-1.7 §5.2)'],
  // S8.9 (A6b-2): visible at Can comment, enabled from Can edit — a handoff is a production bundle, not an export
  ['handoff.open', 'greyed', 'Handoff needs Can edit (decision v2-S8.9)'],
];

describe('role gating — Can comment', () => {
  for (const native of [false, true]) {
    const viewer = menuCtx({ native, readOnly: true, canvasOpen: true });
    const owner = menuCtx({ native, readOnly: false, canvasOpen: true });
    for (const [id, want, why] of COMMENTER) {
      test(`${native ? 'desktop' : 'browser'} · ${id} → ${want} (${why})`, () => {
        // project.new / project.open draw in the desktop shell only for their keys; the row is the
        // same in both shells.
        expect(offer(id, viewer)).toBe(want);
        // An owner is offered every one of them: the role, and nothing else, takes them away.
        expect(offer(id, owner)).toBe('offered');
      });
    }
  }
});

describe('a key the role refuses', () => {
  const SHELL = documentIndex(ACTIONS, 'shell', (id) => id in SHELL_KEY_HANDLERS);
  const base = {
    canvasOpen: true,
    timelineVisible: false,
    presenting: false,
    native: false,
    clipSelected: false,
    artboardSelected: false,
    commentFocused: false,
  };
  const ctx = (readOnly: boolean) => shellKeyCtx({ tag: 'BODY' }, { ...base, readOnly });

  for (const [spec, id] of [
    ['⌘Z', 'edit.undo'],
    ['⇧⌘Z', 'edit.redo'],
    ['⌘Y', 'edit.redo'],
  ] as const) {
    test(`${spec}: a commenter's press still resolves to ${id} and is denied, never run`, () => {
      const r = resolveChord(SHELL, chord(spec) ?? spec, ctx(true));
      expect(r?.action.id).toBe(id);
      expect(keyOutcome(r?.action, ctx(true))).toBe('deny');
    });
    test(`${spec}: an editor's press runs`, () => {
      const r = resolveChord(SHELL, chord(spec) ?? spec, ctx(false));
      expect(keyOutcome(r?.action, ctx(false))).toBe('run');
    });
  }

  test('a refusal for another reason is swallowed silently (no denial line)', () => {
    const noCanvas = menuCtx({ readOnly: false, canvasOpen: false });
    expect(keyOutcome(ACTIONS_BY_ID.get('canvas.duplicate'), noCanvas)).toBe('swallow');
  });

  test('a native menu item the role refuses: File ▸ New Canvas ⌘N', () => {
    const viewer = menuCtx({ native: true, readOnly: true, canvasOpen: true });
    expect(roleRefuses(ACTIONS_BY_ID.get('canvas.new'), viewer)).toBe(true);
    expect(roleRefuses(ACTIONS_BY_ID.get('project.new'), viewer)).toBe(false);
    expect(roleRefuses(ACTIONS_BY_ID.get('project.open'), viewer)).toBe(false);
    const owner = menuCtx({ native: true, readOnly: false, canvasOpen: true });
    expect(roleRefuses(ACTIONS_BY_ID.get('canvas.new'), owner)).toBe(false);
  });

  // The two callers: the shell's key listener and the native-menu bridge.
  const src = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
  test('the shell key listener asks keyOutcome before it runs a handler', () => {
    const s = src('client/hooks/use-action-keys.jsx');
    const gate = s.indexOf('keyOutcome(r.action, ctx)');
    const run = s.indexOf('SHELL_KEY_HANDLERS[r.action.id](d');
    expect(gate).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(gate);
    expect(s).toContain('shellToast(ROLE_DENIAL)');
  });
  test('the native menu bridge refuses a role-refused id with the denial line', () => {
    const s = src('client/hooks/use-palette-and-panels.jsx');
    expect(s).toMatch(
      /onMenuAction\(\(id\) => \{[\s\S]*?roleRefuses\([\s\S]*?shellToast\(ROLE_DENIAL\)/
    );
  });
});
