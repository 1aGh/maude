import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser';

const app = readFileSync(new URL('../client/app.jsx', import.meta.url), 'utf8');
const parsed = parseSync('app.jsx', app, { sourceType: 'module' });
type Node = { type?: string; [key: string]: unknown };
const openings: Node[] = [];
function walk(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) walk(child);
    return;
  }
  const node = value as Node;
  if (node.type === 'JSXOpeningElement') openings.push(node);
  for (const child of Object.values(node)) walk(child);
}
walk(parsed.program);
function attribute(node: Node, name: string): Node | undefined {
  return (node.attributes as Node[]).find(
    (attr) => attr.type === 'JSXAttribute' && (attr.name as Node).name === name
  )?.value as Node | undefined;
}
function byClass(name: string): Node {
  const node = openings.find((opening) => attribute(opening, 'className')?.value === name);
  if (!node) throw new Error(`Missing ${name}`);
  return node;
}

// The actual-cloud axe scan found menuitems below a navigation landmark,
// while the outer menubar owned unrelated project/account controls instead.
test('only the menu trigger group has the menubar role', () => {
  expect(parsed.errors).toHaveLength(0);
  expect(attribute(byClass('st-menus'), 'role')?.value).toBe('menubar');
  expect(attribute(byClass('st-menubar'), 'role')).toBeUndefined();
});

test('studio declares the language of its English interface', () => {
  const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  expect(html.match(/<html\b[^>]*\blang="([^"]+)"/)?.[1]).toBe('en');
});

test('each open canvas frame has a name identifying its file', () => {
  const frame = openings.find(
    (node) => (node.name as Node).name === 'iframe' && attribute(node, 'data-path')
  );
  expect(frame).toBeDefined();
  if (!frame) throw new Error('Missing open-canvas iframe');
  const title = attribute(frame, 'title');
  expect(title).toBeDefined();
  if (!title) throw new Error('Unnamed canvas iframe');
  const expression = title.expression as Node;
  expect(expression.type).toBe('TemplateLiteral');
  const path = (expression.expressions as Node[])[0];
  expect(app.slice(path.start as number, path.end as number)).toBe('t.path');
  expect(((expression.quasis as Node[])[0].value as Node).cooked).toBe('Canvas: ');
});

test('file tree rows use the shared named item that owns actions and child groups', () => {
  for (const name of ['DirRow', 'DsFolderRow', 'FileRow', 'CanvasRow', 'Sidebar']) {
    const start = app.indexOf(`function ${name}(`);
    const end = app.indexOf('\nfunction ', start + 1);
    const source = app.slice(start, end < 0 ? app.length : end);
    expect(source).toContain('<FileTreeItem');
  }
  expect(app).toContain('<FileTree aria-label="Project file tree"');
});
