// Gate B — the timeline split toast's Undo did nothing in the native app. It posted `run-action edit.undo`
// straight to the canvas, which only forwards it after the shell's records settle; ⌘Z (and the duplicate-done /
// add-width toasts) run the shell's one undo path, `menuRunner.run('edit.undo')`. Every toast Undo takes that path.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clipVerbToast, clipVerbToastAction } from '../client/v2/timeline/clip-verb.js';

const STUDIO = join(import.meta.dir, '..');
const src = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

describe('the split toast Undo', () => {
  test('is the shell undo (the same call ⌘Z makes), not a canvas post', () => {
    const calls: string[] = [];
    const run = (id: string) => calls.push(id);
    const toast = clipVerbToast('split', { name: 'Oslava', atFrame: 300, fps: 30 });
    const action = clipVerbToastAction(toast, () => run('edit.undo'));
    expect(action?.label).toBe('Undo');
    action?.onClick();
    expect(calls).toEqual(['edit.undo']);
  });
  test('a verb with no Undo gets no action', () => {
    expect(clipVerbToastAction(clipVerbToast('remove'), () => {})).toBeUndefined();
  });
});

describe('no toast Undo posts run-action edit.undo to the canvas', () => {
  test('timeline clip-verb toast runs menuRunner.run(edit.undo)', () => {
    const s = src('client/hooks/use-photo-and-timeline.jsx');
    expect(s).not.toMatch(/postToActiveCanvas\(runActionMessage\('edit\.undo'\)\)/);
    expect(s).toMatch(/menuRunner\.run\('edit\.undo'\)/);
  });
  test('transcript door undo runs menuRunner.run(edit.undo)', () => {
    const s = src('client/v2/transcript/TranscriptHost.jsx');
    expect(s).not.toMatch(/postToActiveCanvas\(runActionMessage\('edit\.undo'\)\)/);
    expect(s).toMatch(/menuRunner\.run\('edit\.undo'\)/);
  });
});
