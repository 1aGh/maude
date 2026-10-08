import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser';

import { clientFiles, clientSource, fnBody } from './_client-source.ts';

// Every client module is parsed and its JSX openings collected, so these hold
// whichever file a component lives in (app.jsx before the V2-0.2 split, its
// modules after) — see `_client-source.ts`.
type Node = { type?: string; [key: string]: unknown };
type Opening = { node: Node; src: string };
const parsedFiles = clientFiles().map((f) => ({
  ...f,
  parsed: parseSync(f.path, f.src, { sourceType: 'module' }),
}));
const openings: Opening[] = [];
for (const { src, parsed } of parsedFiles) {
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    const node = value as Node;
    if (node.type === 'JSXOpeningElement') openings.push({ node, src });
    for (const child of Object.values(node)) walk(child);
  };
  walk(parsed.program);
}
function attribute(node: Node, name: string): Node | undefined {
  return (node.attributes as Node[]).find(
    (attr) => attr.type === 'JSXAttribute' && (attr.name as Node).name === name
  )?.value as Node | undefined;
}
/** Every opening element carrying exactly this className, across the client. */
function byClass(name: string): Node[] {
  const nodes = openings
    .filter(({ node }) => attribute(node, 'className')?.value === name)
    .map(({ node }) => node);
  if (nodes.length === 0) throw new Error(`Missing ${name}`);
  return nodes;
}

// The actual-cloud axe scan found menuitems below a navigation landmark,
// while the outer menubar owned unrelated project/account controls instead.
test('only the menu trigger group has the menubar role', () => {
  for (const { path, parsed } of parsedFiles) expect(parsed.errors, path).toHaveLength(0);
  for (const node of byClass('st-menus')) expect(attribute(node, 'role')?.value).toBe('menubar');
  for (const node of byClass('st-menubar')) expect(attribute(node, 'role')).toBeUndefined();
});

test('studio declares the language of its English interface', () => {
  const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  expect(html.match(/<html\b[^>]*\blang="([^"]+)"/)?.[1]).toBe('en');
});

test('each open canvas frame has a name identifying its file', () => {
  const frames = openings.filter(
    ({ node }) => (node.name as Node).name === 'iframe' && attribute(node, 'data-path')
  );
  expect(frames.length).toBeGreaterThan(0);
  for (const { node: frame, src } of frames) {
    const title = attribute(frame, 'title');
    expect(title).toBeDefined();
    if (!title) throw new Error('Unnamed canvas iframe');
    const expression = title.expression as Node;
    expect(expression.type).toBe('TemplateLiteral');
    const path = (expression.expressions as Node[])[0];
    expect(src.slice(path.start as number, path.end as number)).toBe('t.path');
    expect(((expression.quasis as Node[])[0].value as Node).cooked).toBe('Canvas: ');
  }
});

test('file tree rows use the shared named item that owns actions and child groups', () => {
  for (const name of ['DirRow', 'DsFolderRow', 'FileRow', 'CanvasRow', 'Sidebar']) {
    expect(fnBody(name)).toContain('<FileTreeItem');
  }
  expect(clientSource()).toContain('<FileTree aria-label="Project file tree"');
});
