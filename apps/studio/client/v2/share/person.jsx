// client/v2/share/person.jsx — P8 C7: a person's face wherever the collaboration surfaces draw one
// (the Share sheet's rows, the comment rows, the conflict's who-lines, Version history). A tone
// FILL with the object ink and ONE letter (kit `.k-av`, 10 Share and Collaboration), never a grey
// disc: people wear sky · green · yellow · lilac · grey, "You" is yellow, coral is the AI's.

import { toneFor, YOU_TONE } from '../../../presence/tones.ts';

/** The one letter a face shows. */
export const letterOf = (name) =>
  (
    String(name ?? '')
      .trim()
      .charAt(0) || '?'
  ).toUpperCase();

/**
 * @param {{ name?: string, tone?: string, you?: boolean, initial?: string, size?: 'sm'|'md'|'lg', className?: string }} p
 */
export function Person({ name = '', tone, you = false, initial, size = 'md', className = '' }) {
  const t = tone || (you ? YOU_TONE : toneFor(name));
  return (
    <span className={`k-av k-av--${size} k-av--${t} ${className}`.trim()} aria-hidden="true">
      {initial || letterOf(name)}
    </span>
  );
}
