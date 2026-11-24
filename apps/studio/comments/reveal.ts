// apps/studio/comments/reveal.ts — #229: "bring this comment into view".
//
// The comments overlay knows the comment (where its pin sits, which artboard it is on); canvas-shell.tsx
// holds the camera. The overlay asks over a document event so neither imports the other.

export const COMMENT_REVEAL_EVENT = 'cm:reveal';

export interface CommentRevealDetail {
  /** The artboard the comment is on, when known (Pages turns to its page first). */
  artboard: string | null;
  /** Where the comment sits NOW, client px — measured by the camera's owner after any page turn. */
  locate: () => { x: number; y: number; w: number; h: number } | null;
}
