// V2-8.16 live journeys at the freeze: S2 asked for the heading "All saved" and the agent wrote it as
//   <h3 …>
//     All saved
//   </h3>
// which is the same heading. The `text` grader's needle `>All saved<` matched only the one-line form and called
// it a fail. Whitespace next to a tag's `>` / `<` is layout, not content; a missing word stays a fail.
import { expect, test } from 'bun:test';
// @ts-expect-error - plain .mjs
import { GRADERS } from './graders.mjs';

const grade = (src: string, spec: { has?: string[]; lacks?: string[] }) =>
  GRADERS.text(
    { path: 'ui/GitPanel.tsx', ...spec },
    { text: (p: string) => (p === 'ui/GitPanel.tsx' ? src : null) }
  );

const multiline = `<section>
  <h3 className="title">
    All saved
  </h3>
</section>`;

test('a needle around element text matches the element written over several lines', () => {
  expect(grade(multiline, { has: ['>All saved<'] })).toEqual({ pass: true, why: '' });
  expect(grade('<h3>All saved</h3>', { has: ['>All saved<'] }).pass).toBe(true);
  expect(grade('<h3>\tAll saved </h3>', { has: ['>All saved<'] }).pass).toBe(true);
});

test('a lacks needle sees the old text over several lines too', () => {
  const old = '<h3>\n    Nothing to save\n  </h3>';
  expect(grade(old, { lacks: ['>Nothing to save<'] }).pass).toBe(false);
});

test('the grader can still fail: a missing or changed word is a fail', () => {
  const r = grade(multiline.replace('All saved', 'All set'), { has: ['>All saved<'] });
  expect(r.pass).toBe(false);
  expect(r.why).toContain('no />All saved</');
  expect(grade('<h3>\n  All\n  saved more\n</h3>', { has: ['>All saved<'] }).pass).toBe(false);
  expect(grade('<h3>Allsaved</h3>', { has: ['>All saved<'] }).pass).toBe(false);
  expect(grade('', { has: ['>All saved<'] }).pass).toBe(false);
});

test('a missing file is a fail', () => {
  const r = GRADERS.text({ path: 'ui/Nope.tsx', has: ['x'] }, { text: () => null });
  expect(r).toEqual({ pass: false, why: 'ui/Nope.tsx is missing' });
});

test('a needle that already spells whitespace keeps working', () => {
  expect(grade('<h3>\n  All saved\n</h3>', { has: ['>\\s+All saved\\s+<'] }).pass).toBe(true);
  expect(grade('if (a > 0) return <b>x</b>;', { has: ['a > 0'] }).pass).toBe(true);
});

// V2-8 live journey S6 at the freeze: both agents followed the project's own GitPanel.tsx + GitPanel.css and put
// every style into `ui/Landing page.css`, which the canvas imports. The `text` grader read only the .tsx, so
// `design-system-tokens` saw no `var(--` and failed two correct runs. `withImportedCss` reads the canvas PLUS the
// CSS it imports by a relative specifier (inside the design root); `lacks` must hold across all of them.
const CANVAS = 'ui/Landing page.tsx';
const tsx = (imports: string) =>
  `${imports}\nexport default function P() { return <main className="p" />; }\n`;
const files = (m: Record<string, string>) => ({ text: (p: string) => m[p] ?? null });
const withCss = (m: Record<string, string>, spec: Record<string, unknown> = {}) =>
  GRADERS.text(
    {
      path: CANVAS,
      withImportedCss: true,
      has: ['var\\(--'],
      lacks: ['#[0-9a-fA-F]{6}\\b'],
      ...spec,
    },
    files(m)
  );

test('withImportedCss: tokens that live only in the imported CSS pass', () => {
  const m = {
    [CANVAS]: tsx('import "./Landing page.css";'),
    'ui/Landing page.css': '.p { color: var(--fg-0); background: var(--bg-1); }',
  };
  expect(withCss(m)).toEqual({ pass: true, why: '' });
  expect(withCss({ ...m, [CANVAS]: tsx("import './Landing page.css';") }).pass).toBe(true);
  expect(
    withCss({
      [CANVAS]: tsx('import styles from "../shared/y.css";'),
      'shared/y.css': '.p { color: var(--fg-0); }',
    }).pass
  ).toBe(true);
});

test('withImportedCss: a hex in the imported CSS still fails `lacks`', () => {
  const r = withCss({
    [CANVAS]: tsx('import "./Landing page.css";'),
    'ui/Landing page.css': '.p { color: var(--fg-0); background: #6d5dfc; }',
  });
  expect(r.pass).toBe(false);
  expect(r.why).toContain('still /#[0-9a-fA-F]{6}\\b/');
});

test('withImportedCss: a hex in the canvas fails even when the CSS is clean', () => {
  const r = withCss({
    [CANVAS]: `${tsx('import "./Landing page.css";')}const c = "#6d5dfc";`,
    'ui/Landing page.css': '.p { color: var(--fg-0); }',
  });
  expect(r.pass).toBe(false);
});

test('withImportedCss: no tokens anywhere is still a fail', () => {
  const r = withCss({
    [CANVAS]: tsx('import "./Landing page.css";'),
    'ui/Landing page.css': '.p { color: red; }',
  });
  expect(r.pass).toBe(false);
  expect(r.why).toContain('no /var\\(--/');
});

test('withImportedCss: bare specifiers, other file types and paths outside the design root are ignored', () => {
  const css = { 'ui/Landing page.css': '.p { color: var(--fg-0); }' };
  expect(
    withCss({ [CANVAS]: tsx('import "normalize.css";'), 'normalize.css': 'a{color:var(--x)}' }).pass
  ).toBe(false);
  expect(withCss({ [CANVAS]: tsx('import "./data.json";'), 'ui/data.json': 'var(--x)' }).pass).toBe(
    false
  );
  expect(
    withCss({
      [CANVAS]: tsx('import "../../outside.css";'),
      '../outside.css': 'a{color:var(--x)}',
    }).pass
  ).toBe(false);
  expect(withCss({ [CANVAS]: tsx('import "./Missing.css";'), ...css }).pass).toBe(false);
});

test('without withImportedCss the grader reads the canvas file only (other journeys unchanged)', () => {
  const m = {
    [CANVAS]: tsx('import "./Landing page.css";'),
    'ui/Landing page.css': '.p { color: var(--fg-0); }',
  };
  expect(withCss(m, { withImportedCss: undefined }).pass).toBe(false);
  expect(withCss(m, { withImportedCss: false }).pass).toBe(false);
});

test('withImportedCss on a non-canvas path behaves as before', () => {
  const r = GRADERS.text(
    { path: 'ui/Landing page.css', withImportedCss: true, has: ['var\\(--'] },
    files({
      'ui/Landing page.css': '@import "./other.css"; .p{color:var(--a)}',
      'ui/other.css': 'x',
    })
  );
  expect(r.pass).toBe(true);
});
