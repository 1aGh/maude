// S3.10a — a v1 peer meets a canvas with links (V2-1.12: versioned files never break a v1 reader).
// `data-cd-link` is one more JSX string attribute to every writer that predates it: v1's /_api/edit-css and
// /_api/edit-text writers (`applyEdit`, `applyTextEdit`) parse the TSX, change what they were asked to change and
// leave the link byte for byte; v1's element listing still finds every element; v1's handoff strip
// (`stripDataCdId`) and the v2 export strip both drop the link from what leaves the project.

import { describe, expect, test } from 'bun:test';

import { applyEdit, applyTextEdit, listElements } from '../canvas-edit.ts';
import { stripCanvasOnly } from '../element-ids.ts';
import { stripDataCdId } from '../handoff.ts';

const CANVAS = '/x/Home.tsx';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <button data-cd-id="see-pricing" data-cd-link="#pricing" className="cta">See pricing</button>
        <a data-cd-id="book" data-cd-link="https://cal.com/studio" href="#x">Book a call</a>
        <a data-cd-id="docs" data-cd-link="docs/index.tsx#start">Docs</a>
      </DCArtboard>
      <DCArtboard id="pricing" label="Pricing" width={800} height={500}>
        <p>Plans</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const links = (s: string) => [...s.matchAll(/data-cd-link="([^"]*)"/g)].map((m) => m[1]);

describe('v1 writers leave links alone', () => {
  test('a v1 style write changes the style and nothing else: every link stays, byte for byte', () => {
    const out = applyEdit(CANVAS, SRC, 'see-pricing', 'style.color', "'red'").source;
    expect(out).not.toBe(SRC);
    expect(out).toContain("style={{ color: 'red' }}");
    expect(links(out)).toEqual(links(SRC));
    expect(out.replace(" style={{ color: 'red' }}", '')).toBe(SRC);
  });

  test('a v1 text write on a linked element keeps its link', () => {
    const out = applyTextEdit(CANVAS, SRC, 'book', 'Talk to us').source;
    expect(out).toContain('Talk to us');
    expect(links(out)).toEqual(links(SRC));
  });

  test('v1’s element listing still finds every element of a canvas with links', () => {
    const tags = listElements(CANVAS, SRC).map((e) => e.print.tag);
    expect(tags).toEqual(expect.arrayContaining(['button', 'a', 'p']));
    expect(listElements(CANVAS, SRC).filter((e) => e.print.tag === 'a')).toHaveLength(2);
  });
});

describe('what leaves the project carries no link', () => {
  test('the v1 handoff strip and the v2 export strip agree: ids and links are gone, the rest is intact', () => {
    const v1 = stripDataCdId(CANVAS, SRC);
    expect(v1).not.toContain('data-cd-link');
    expect(v1).not.toContain('data-cd-id');
    expect(stripCanvasOnly(SRC, CANVAS)).toBe(v1);
    expect(v1).toContain('<button className="cta">See pricing</button>');
  });
});
