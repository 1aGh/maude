// actions/index.ts — the registry aggregate (V2-1.3 contract §5.1): every area's entries,
// concatenated and frozen. Lanes add entries to `defs/<area>.ts`; the lead owns this file.

import { ANNOTATION_ACTIONS } from './defs/annotation.ts';
import { APP_ACTIONS } from './defs/app.ts';
import { CANVAS_ACTIONS } from './defs/canvas.ts';
import { EDIT_ACTIONS } from './defs/edit.ts';
import { EXPORT_ACTIONS } from './defs/export.ts';
import { NATIVE_ACTIONS } from './defs/native.ts';
import { SEARCH_ACTIONS } from './defs/search.ts';
import { TIMELINE_ACTIONS } from './defs/timeline.ts';
import { TOOL_ACTIONS } from './defs/tool.ts';
import { UI_ACTIONS } from './defs/ui.ts';
import { VIEW_ACTIONS } from './defs/view.ts';
import type { ActionDef, ActionId } from './types.ts';

export const ACTIONS: readonly ActionDef[] = Object.freeze([
  ...SEARCH_ACTIONS,
  ...CANVAS_ACTIONS,
  ...EDIT_ACTIONS,
  ...VIEW_ACTIONS,
  ...TOOL_ACTIONS,
  ...UI_ACTIONS,
  ...TIMELINE_ACTIONS,
  ...EXPORT_ACTIONS,
  ...APP_ACTIONS,
  ...ANNOTATION_ACTIONS,
  ...NATIVE_ACTIONS,
]);

export const ACTIONS_BY_ID: ReadonlyMap<ActionId, ActionDef> = new Map(
  ACTIONS.map((a) => [a.id, a])
);
