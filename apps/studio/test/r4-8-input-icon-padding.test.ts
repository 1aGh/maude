// r4 #8 (Michal: "placeholders se prekryvaji s ikonami v inputech"): the sign-in form's inputs carry a
// leading icon (`.ob-field-wrap > .ob-field-pre`) and `.ob-field-wrap .ob-input` moves the text past it.
// The rule sat in `@layer shell` while the base `.ob-input { padding: 0 var(--space-2) }` is in
// `@layer components`; the layer order is reset, tokens, layout, shell, components, so the later layer
// won whatever the specificity and the placeholder rendered under the icon. The padding rule must live in
// a layer that is not earlier than the base rule's, and after it.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '../client/v2/onboarding/onboarding.css'), 'utf8');
const ORDER = ['reset', 'tokens', 'layout', 'shell', 'components', 'utilities'];

/** The top-level layer a character offset sits in (depth-1 `@layer name {` blocks). */
function layerAt(offset: number): string | null {
  const re = /@layer\s+([a-z]+)\s*\{/g;
  let m: RegExpExecArray | null = re.exec(css);
  while (m) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    if (offset >= m.index && offset < i) return m[1];
    m = re.exec(css);
  }
  return null;
}

test('the icon padding rule is not in an earlier layer than the base .ob-input padding, and follows it', () => {
  const base = css.indexOf('\n  .ob-input {\n    box-sizing: border-box;');
  expect(base).toBeGreaterThan(0);
  const withIcon = [...css.matchAll(/\.ob-field-wrap \.ob-input \{[^}]*padding-left:[^}]*\}/g)];
  expect(withIcon.length).toBe(1);
  const at = withIcon[0].index ?? -1;
  const baseLayer = layerAt(base) as string;
  const iconLayer = layerAt(at) as string;
  expect(ORDER).toContain(baseLayer);
  expect(ORDER).toContain(iconLayer);
  expect(ORDER.indexOf(iconLayer)).toBeGreaterThanOrEqual(ORDER.indexOf(baseLayer));
  if (iconLayer === baseLayer) expect(at).toBeGreaterThan(base);
});

test('the padding clears the icon: the icon sits at space-2 and is 16px wide', () => {
  const rule = css.match(/\.ob-field-wrap \.ob-input \{[^}]*\}/)?.[0] ?? '';
  expect(rule).toContain('padding-left: calc(var(--space-2) * 2 + 16px)');
  const pre = css.match(/\.ob-field-pre \{[^}]*\}/)?.[0] ?? '';
  expect(pre).toContain('left: var(--space-2)');
});

test('every input in the team-server form that has a leading icon sits in .ob-field-wrap', () => {
  const jsx = readFileSync(join(import.meta.dir, '../client/panels/TeamProjects.jsx'), 'utf8');
  const pres = jsx.match(/className="ob-field-pre"/g) ?? [];
  const inputs =
    jsx.match(
      /<span className="ob-field-wrap">\s*<Icon[^>]*ob-field-pre[^>]*\/>\s*<input\s+className="input ob-input"/g
    ) ?? [];
  expect(pres.length).toBe(3);
  expect(inputs.length).toBe(3);
});
