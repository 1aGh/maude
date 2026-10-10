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
 * Empty during V2-2.4 (the pure swap removes no binding); Phase 4 adds the D1–D4 rows.
 */
export const MOVED_KEYS: readonly MovedKey[] = [];
