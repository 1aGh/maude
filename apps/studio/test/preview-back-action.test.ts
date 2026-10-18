// S3.10a — registry `preview.back` (no key; esc order unchanged) and the link actions' registry rows. The menu
// runner's `preview.back` handler is the ONE function the PreviewBar's "‹ Homepage" and ⌘K both run
// (client/v2/preview/preview-back.js); the link writers are `edit-op`s with an agent path and a server route.
import { describe, expect, test } from 'bun:test';
import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import {
  clearPreviewBack,
  runPreviewBack,
  setPreviewBack,
} from '../client/v2/preview/preview-back.js';
import { createMenuHandlers, runnableIds } from '../client/v2/shell/menu-runner.js';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';

describe('preview.back', () => {
  test('a shell command with no key, enabled only in Preview', () => {
    const def = ACTIONS_BY_ID.get('preview.back');
    expect(def?.exec).toBe('shell');
    expect(def?.label).toBe('Back');
    expect(def?.keys ?? []).toEqual([]);
    expect(def?.enabled?.mode).toEqual(['preview']);
  });

  test('the menu runner runs the mounted host’s back; nothing mounted does nothing', () => {
    const handlers = createMenuHandlers({} as never);
    expect(runnableIds(handlers).has('preview.back')).toBe(true);
    expect(handlers['preview.back']()).toBeNull();
    let n = 0;
    const mine = () => ++n;
    setPreviewBack(mine);
    handlers['preview.back']();
    expect(runPreviewBack()).toBe(2);
    clearPreviewBack(() => 0); // a late unmount of another host clears nothing
    runPreviewBack();
    expect(n).toBe(3);
    clearPreviewBack(mine);
    expect(runPreviewBack()).toBeNull();
  });
});

describe('element.set-link / element.clear-link', () => {
  test('registered for Can edit on an object, with the edit-op route and the file-format agent path', () => {
    for (const id of ['element.set-link', 'element.clear-link']) {
      const def = ACTIONS_BY_ID.get(id);
      expect(def, id).toBeTruthy();
      expect(def?.enabled?.minRole).toBe('edit');
      expect(def?.enabled?.selection).toEqual(['object']);
      const ai = AGENT_PATHS[id];
      expect(ai.minRole).toBe('edit');
      expect(ai.undo).toBe('step');
      expect(ai.server).toEqual({ route: '/_api/edit-op', method: 'POST' });
      expect(ai.agent).toMatchObject({ path: 'file', format: 'canvas-tsx' });
      expect((ai.agent as { how: string }).how).toContain('data-cd-link');
    }
  });

  test('every action id that names a link writer is an op in EDIT_OPS (an op id is the action id)', () => {
    const ids = EDIT_OPS.map((o) => o.id);
    expect(ids).toContain('element.set-link');
    expect(ids).toContain('element.clear-link');
  });
});
