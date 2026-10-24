// P8 C4: cheap CSS-rule pins for the nav / panel fixes that are pure CSS (11 pn-organise list end, 12 ia-assets-tidy).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = join(import.meta.dir, '..', 'client', 'v2');
const lp = readFileSync(join(CLIENT, 'left-panel', 'left-panel.css'), 'utf8');
const cv = readFileSync(join(CLIENT, 'canvases', 'canvases.css'), 'utf8');

const rule = (css: string, sel: string): string => {
  const i = css.indexOf(`${sel} {`);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
};

describe('pure-CSS fixes', () => {
  test('the Not used foot wraps its button under the numbers instead of running past the panel edge', () => {
    expect(rule(lp, '.lp-tidy-foot')).toContain('flex-wrap: wrap');
    expect(rule(lp, '.lp-tidy-foot')).not.toContain('white-space: nowrap');
  });

  test('the list is as tall as its rows, so "+ New canvas" ends it; Trash rides the panel bottom', () => {
    expect(rule(cv, '.cv-listwrap')).toContain('flex: 0 1 auto');
    expect(rule(cv, '.cv-tree.st-tree')).toContain('flex: 0 1 auto');
    expect(rule(lp, '.lp-trashrow')).toContain('margin: auto');
  });
});
