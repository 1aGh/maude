// rc.1 F16 — one comment icon everywhere. The Comment tool (Edit's and Preview's toolbar slot), the Comments
// panel button and the share cluster all draw the SAME speech bubble; the tool used to wear a rounded square
// that read as Shape.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DsIcon } from '../canvas-ds-icons.tsx';
import { StIcon } from '../client/shell/icons.jsx';

const pathsOf = (html: string) => [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

describe('the comment glyph', () => {
  const tool = pathsOf(renderToStaticMarkup(<DsIcon name="comment" />));

  test('the canvas tool, the shell icon and the panel/cluster icon are one drawing', () => {
    expect(tool.length).toBe(1);
    expect(pathsOf(renderToStaticMarkup(<StIcon name="comment" />))).toEqual(tool);
    expect(pathsOf(renderToStaticMarkup(<StIcon name="comment-bubble" />))).toEqual(tool);
  });

  test('it is a speech bubble — it has a tail below the body, not a closed rounded square', () => {
    // the tail: a line to the pin's foot (8,11 → 5,13.5 → 5,11); a rounded square has no such segment
    expect(tool[0]).toContain('H8l-3 2.5');
  });
});
