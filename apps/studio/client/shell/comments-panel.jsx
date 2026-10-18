// shell/comments-panel.jsx — S9.22: the panel moved to client/v2/comments/comments-panel.jsx (Comments v2:
// filters Open · Mine · Resolved · All, grouped by canvas, Reopen, delete your own). This module stays as
// the old import path so app.jsx and use-palette-and-panels.jsx keep working untouched, and every v1 test
// id (comment-filter-all|open|resolved, comment-item-<id>) is still emitted by the new component.

export { CommentsPanel } from '../v2/comments/comments-panel.jsx';
