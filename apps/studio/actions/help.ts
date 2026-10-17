// actions/help.ts — the "?" sheet layout (V2-1.3 contract §5.10): the v2 groups (06 ad-search +
// Q2's Objects / Timeline / Present rows) and the rule-13 "Keys and tools that moved" table.
// Phase 4 (V2-4.9) renders "?" from these.

import type { HelpGroup, MovedKey } from './types.ts';

export interface HelpGroupDef {
  id: HelpGroup;
  label: string;
  /** Shown under the group heading. */
  note?: string;
}

/** Main-grid groups, in order. Each lists the visible actions whose `help.group` matches. */
export const HELP_GROUPS: readonly HelpGroupDef[] = [
  { id: 'edit-tools', label: 'Edit tools' },
  { id: 'preview-tools', label: 'Preview tools', note: 'The key switches to Preview' },
  { id: 'file', label: 'File' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'panels-ai', label: 'Panels and AI' },
  // Q2 default: below the drawn groups, in the main grid — nothing about them is Advanced.
  { id: 'objects', label: 'Objects' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'present', label: 'Present' },
];

/**
 * Rule 13 — every v1 binding a v2 commit removes gets a row here IN THAT COMMIT. Append-only.
 * Empty during V2-2.4 (the pure swap removes no binding). CONTRACT §2 "Keys and tools that moved"
 * is the copy; V2-4.1 moved T (its row landed with V2-4.5b, which bound T to Text), V2-3.11 ⌘1.
 */
export const MOVED_KEYS: readonly MovedKey[] = [
  // D1 — V2-4.3 / V2-4.5
  {
    was: 'Browse tool',
    now: 'Preview',
    note: 'Hand, and a click uses the design',
    to: 'tool.browse',
  },
  // D2 — V2-4.5b (the two toolbars)
  { was: 'Pen B', now: 'Marker M', note: 'P is the design Pen in Edit', to: 'tool.pen' },
  {
    was: 'Rect R',
    now: 'Shape R',
    note: 'Preview draws annotation shapes, Edit design ones',
    to: 'tool.shape',
  },
  { was: 'Ellipse O', now: 'Edit › More › Ellipse', to: 'tool.ellipse' },
  {
    was: 'Highlighter I',
    now: 'Marker › Highlighter tip',
    note: 'I is Image',
    to: 'tool.highlighter',
  },
  { was: 'Eraser E', now: 'Marker › Eraser tip', note: 'E is Stickers', to: 'tool.eraser' },
  { was: 'Section ⇧S', now: 'S', to: 'tool.section' },
  // D3
  {
    was: 'Export ⌘E (canvas palette)',
    now: '⇧⌘E',
    note: '⌘E is unbound; "Export again" sits on every Exports row',
    to: 'export.open',
  },
  // D4 / D17 — the shell's letters (T: V2-4.1; H S N: V2-4.5b)
  { was: 'T toggle tree', now: '⌘\\', note: 'or the panel icon; T is Text', to: 'view.panels' },
  {
    was: 'H hidden files',
    now: 'Canvases › Advanced',
    note: 'a switch, no key; H is Hand',
    to: 'view.hidden-files',
  },
  {
    was: 'S design-system view',
    now: 'the pinned Design system row',
    note: 'S is Section',
    to: 'view.design-system',
  },
  { was: 'N new board', now: '⌘N', note: 'N is Sticky', to: 'canvas.new' },
  { was: 'Actual size ⌘1', now: '⇧0', note: '⌘1–9 pick a tab', to: 'view.zoom-actual' },
  // ⇧⌘A is Select all annotations in v2
  { was: 'Assistant ⇧⌘A', now: '⌘/', note: 'Ask AI, the AI chat panel', to: 'ai.chat' },
  { was: 'Search canvases ⌘/', now: '/', note: '⌘/ asks AI', to: 'canvases.search' },
  // V2-4 gate (design blocker 6) — CONTRACT §1 Version history ⌥⌘H
  {
    was: 'Changes ⇧⌘G',
    now: 'Version history ⌥⌘H',
    note: '⇧⌘G is Remove frame in Edit',
    to: 'history.open',
  },
];
