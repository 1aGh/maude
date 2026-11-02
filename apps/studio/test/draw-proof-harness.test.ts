// V2-2.4b gate — `maude design draw-proof` must never splice a caller value into
// the generated proof TSX as code. `--name` used to land raw in a JSX attribute
// (`name="<NAME>"`), so a name carrying `"` / `{` / `}` ran as code in the
// proof page. Every value now reaches the module as base64 and is decoded at
// runtime: whatever the caller passes renders as the same text, and nothing runs.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeSandbox } from './_helpers.ts';

const SCRIPT = join(import.meta.dir, '..', 'bin', 'draw-proof.sh');
// Under apps/studio so the transpiled JSX resolves `react` from its node_modules.
const MODULES = mkdtempSync(join(import.meta.dir, '.tmp-draw-proof-'));
afterAll(() => rmSync(MODULES, { recursive: true, force: true }));

const STUB = `export const DrawProof = (props: Record<string, unknown>) => props;\n`;
writeFileSync(join(MODULES, 'canvas-lib-stub.ts'), STUB);

/** Run the helper against a sandbox; the capture step fails fast on purpose. */
function runProof(args: string[]) {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, '_server.json'), JSON.stringify({ port: 1 }));
  const res = spawnSync('bash', [SCRIPT, '--root', root, '--engine', 'agent-browser', ...args], {
    encoding: 'utf8',
    env: { ...process.env, MAUDE_AGENT_BROWSER: '/usr/bin/false', NO_OPEN: '1' },
    timeout: 60_000,
  });
  return { ...res, root, designRoot };
}

let n = 0;
/** Import a generated proof with `@maude/canvas-lib` swapped for a props-echo stub. */
async function loadProof(src: string): Promise<{ name: unknown; html: unknown }> {
  const file = join(MODULES, `proof-${n++}.tsx`);
  writeFileSync(file, src.replace("'@maude/canvas-lib'", "'./canvas-lib-stub.ts'"));
  const mod = (await import(file)) as { default: () => { props: Record<string, unknown> } };
  const props = mod.default().props as {
    name: unknown;
    mark: { props: { dangerouslySetInnerHTML: { __html: unknown } } };
  };
  return { name: props.name, html: props.mark.props.dangerouslySetInnerHTML.__html };
}

describe('draw-proof generates an inert harness (V2-2.4b gate)', () => {
  const NAMES = [
    'x" onClick={globalThis.__pwn = 1} data-y="',
    '"}{(globalThis.__pwn = 1)}{"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the payload is a literal `${`
    '`${(globalThis.__pwn = 1)}` </span> {} \\" \\\\',
    'Žluťoučký kůň — 標識',
  ];
  const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>\`\${(globalThis.__pwn = 1)}\` "q" '</title><path d="M0 0h24v24H0z"/></svg>\n`;

  for (const name of NAMES) {
    test(`--name ${JSON.stringify(name)} renders as that exact text`, async () => {
      const assetDir = mkdtempSync(join(MODULES, 'asset-'));
      const asset = join(assetDir, 'mark.svg');
      writeFileSync(asset, MARK);
      const res = runProof(['--asset', asset, '--slug', 'mark', '--name', name]);
      // The capture step fails (no server) — generation happened before it.
      expect(res.status).toBe(3);
      const src = readFileSync(join(res.designRoot, '_draw', 'mark.proof.tsx'), 'utf8');
      // Neither value appears in the source at all…
      expect(src).not.toContain('__pwn');
      // …and the module evaluates to exactly what was passed.
      const got = await loadProof(src);
      expect(got.name).toBe(name);
      expect(got.html).toBe(MARK);
      expect((globalThis as { __pwn?: unknown }).__pwn).toBeUndefined();
    }, 60_000);
  }

  test('a slug that does not normalize to the harness shape is refused before any write', () => {
    const assetDir = mkdtempSync(join(MODULES, 'asset-'));
    const asset = join(assetDir, 'mark.svg');
    writeFileSync(asset, MARK);
    for (const slug of ['a"b', "a'b", 'a{b}', '..']) {
      const res = runProof(['--asset', asset, '--slug', slug]);
      expect(`${slug} ${res.status}`).toBe(`${slug} 2`);
    }
  });

  test('a planted symlink at the proof path is replaced, not followed', () => {
    const assetDir = mkdtempSync(join(MODULES, 'asset-'));
    const asset = join(assetDir, 'mark.svg');
    writeFileSync(asset, MARK);
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, '_server.json'), JSON.stringify({ port: 1 }));
    const victim = join(designRoot, 'ui', 'Real.tsx');
    writeFileSync(victim, 'export default function Real() { return null; }\n');
    mkdirSync(join(designRoot, '_draw'), { recursive: true });
    spawnSync('ln', ['-s', victim, join(designRoot, '_draw', 'mark.proof.tsx')]);
    spawnSync(
      'bash',
      [SCRIPT, '--root', root, '--engine', 'agent-browser', '--asset', asset, '--slug', 'mark'],
      { env: { ...process.env, MAUDE_AGENT_BROWSER: '/usr/bin/false' }, timeout: 60_000 }
    );
    expect(readFileSync(victim, 'utf8')).toBe('export default function Real() { return null; }\n');
  }, 60_000);
});
