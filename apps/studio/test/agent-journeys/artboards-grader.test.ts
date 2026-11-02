// S12.16 live (run 2): S6 drafted three web artboards that each render one shared <Page /> component.
// The `artboards` grader counted only the JSX written inside each artboard (1 element) and called the
// draft empty. An artboard is filled by the local components it renders, as the lease zones are (S5).
import { expect, test } from 'bun:test';
// @ts-expect-error - plain .mjs
import { GRADERS } from './graders.mjs';

const canvas = (
  body: string,
  boards: string
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
${body}
export default function C() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="S">
${boards}
      </DCSection>
    </DesignCanvas>
  );
}
`;
const run = (src: string) =>
  GRADERS.artboards(
    { path: 'ui/C.tsx', min: 3, minElements: 4 },
    { text: (p: string) => (p === 'ui/C.tsx' ? src : null) }
  );
const boards = (inner: string) =>
  ['a', 'b', 'c']
    .map(
      (id) =>
        `        <DCArtboard id="${id}" label="${id}" kind="web" width={400} height={300}>${inner}</DCArtboard>`
    )
    .join('\n');

test('artboards that render a filled local component are filled', () => {
  const page = `function Page() {
  return (
    <main>
      <header><h1>Roast</h1><nav><a href="#x">Coffee</a></nav></header>
      <section><p>Fresh</p><Button />Buy</section>
    </main>
  );
}
function Button() { return <button>Order</button>; }`;
  expect(run(canvas(page, boards('<Page />'))).pass).toBe(true);
});

test('empty shells are still empty, and a component with no content does not fill an artboard', () => {
  expect(run(canvas('', boards('<div />'))).pass).toBe(false);
  expect(run(canvas('function Page() { return <div />; }', boards('<Page />'))).pass).toBe(false);
});
