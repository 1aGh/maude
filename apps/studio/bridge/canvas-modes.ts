// apps/studio/bridge/canvas-modes.ts — the v2 canvas mode vocabulary (V2-1.2 §5.4). Data only: a
// leaf module with no React and no DOM, imported by the shell, the canvas runtime and the
// comment-mount bundle (contract §5.1).
//
// V2-2.10 lands the TYPES and the runtime lists the dgn table's validators need. The state machine
// helpers (`toolKeyAction`, `escStep`, `baseMode`, `initialMode`, `clampMode`,
// `holdsModuleUpdates`) and `MODE_TOOLS` land with the dormant governed path (V2-2.10e, T8).

export const CANVAS_MODES = ['edit', 'viewing', 'preview', 'present'] as const;
export type CanvasModeV2 = (typeof CANVAS_MODES)[number];

export const PRESENT_KINDS = ['artboards', 'canvas'] as const;
export interface PresentSpec {
  kind: (typeof PRESENT_KINDS)[number];
  /** A DCArtboard id, or 'start'. */
  from?: string;
}

/** owner/editor → all true · Can comment (today's `viewer`) → comment only · Can view → none. */
export interface ModeCaps {
  edit: boolean;
  annotate: boolean;
  comment: boolean;
}

/** minRole per tool row (the V2-1.3 condition). */
export type Role = 'view' | 'comment' | 'edit';

/** v1 ids keep their v1 meaning (input-router posture tables, annotations-layer, TOOL_CURSORS);
 *  the v2 ids are new tools only (S2 builds the Edit ones, S3 `inspect` + `pointer`). Never rename
 *  a v1 id (contract §8). */
export const V1_TOOL_IDS = [
  'browse',
  'move',
  'hand',
  'comment',
  'pen',
  'highlighter',
  'eraser',
  'shape',
  'sticky',
  'section',
  'arrow',
  'text',
] as const;
export const V2_TOOL_IDS = [
  'inspect',
  'frame',
  'el-shape',
  'el-pen',
  'el-text',
  'image',
  'component',
  'line',
  'ellipse',
  'polygon',
  'crop',
  'slice',
  'pointer',
] as const;
export const TOOL_IDS = [...V1_TOOL_IDS, ...V2_TOOL_IDS] as const;
export type ToolId = (typeof TOOL_IDS)[number];

const MODE_SET: ReadonlySet<string> = new Set(CANVAS_MODES);
const TOOL_SET: ReadonlySet<string> = new Set(TOOL_IDS);
export const isCanvasMode = (v: unknown): v is CanvasModeV2 =>
  typeof v === 'string' && MODE_SET.has(v);
export const isToolId = (v: unknown): v is ToolId => typeof v === 'string' && TOOL_SET.has(v);
