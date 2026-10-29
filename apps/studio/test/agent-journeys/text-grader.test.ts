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
