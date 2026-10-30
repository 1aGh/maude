// client/v2/comments/comment-tool.js — P8 C5 (04 md-comment, 10 co-comment-*): the Comment tool in hand docks
// the Comments panel (the board draws the panel open beside the pins).
//
// The canvas tells the shell which tool is armed with a `tool-cursor` token (use-canvas-bridge.jsx). The
// panel is asked for on the EDGE — the token turning into 'comment' — never on every repeat, so a person who
// closes the panel with the tool still in hand is not fought, and the next arming docks it again.

/** One watch per shell: `armed(tool)` is true exactly when `tool` is 'comment' and the last token was not. */
export function createCommentToolWatch() {
  let last = null;
  return {
    armed(tool) {
      const was = last;
      last = typeof tool === 'string' ? tool : null;
      return last === 'comment' && was !== 'comment';
    },
  };
}
