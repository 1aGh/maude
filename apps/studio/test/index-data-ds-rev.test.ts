// S10.4 (V2-1.6 §5.8) — `/_index-data` says which revision each canvas renders once a system is converted:
// `canvasDsRevs`, `systemHeads`, `dsConverted`, `dsRevGaps`. A project with no converted system gets the
// payload it always had (no new key).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newHead, serializeHead } from '../ds/head.ts';
import { buildRevision, revisionSiblings } from '../ds/revision.ts';
import { bootServer, killProc, nextPort } from './_helpers.ts';

const TSX = 'export default function C(){return <main/>}\n';

function sandbox(opts: { convert: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'mdcc-ds-rev-'));
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({
      name: 'ds-rev-test',
      designRoot: '.design',
      canvasGroups: [
        { label: 'Design system', path: 'system' },
        { label: 'UI kit', path: 'ui' },
      ],
      designSystems: [
        { name: 'studio-site', path: 'system/studio-site', rootClass: 'ds' },
        { name: 'plain', path: 'system/plain', rootClass: 'ds' },
      ],
      defaultDesignSystem: 'studio-site',
    })
  );
  const dsAbs = join(designRoot, 'system', 'studio-site');
  mkdirSync(join(dsAbs, 'revisions'), { recursive: true });
  mkdirSync(join(designRoot, 'system', 'plain'), { recursive: true });
  const make = (n: number) => {
    const rev = buildRevision('studio-site', {
      'colors_and_type.css': `:root{--n:${n}}`,
      'preview/_components.css': `.btn{order:${n}}`,
    });
    writeFileSync(join(dsAbs, 'revisions', `${rev.id}.json`), rev.bytes);
    for (const s of revisionSiblings(rev.id, rev.body)) writeFileSync(join(dsAbs, s.path), s.text);
    return rev.id;
  };
  const old = make(1);
  const head = make(2);
  const gone = 'e'.repeat(64);
  if (opts.convert) {
    const doc = newHead('studio-site', { head, base: head });
    writeFileSync(join(dsAbs, 'revisions', 'head.json'), serializeHead(doc));
  }
  const canvases: Array<[string, Record<string, unknown>]> = [
    ['Pricing', { designSystem: 'studio-site' }],
    ['Landing', { designSystem: 'studio-site', dsRev: old }],
    ['Lost', { designSystem: 'studio-site', dsRev: gone }],
    ['Elsewhere', { designSystem: 'plain', dsRev: old }],
  ];
  for (const [name, meta] of canvases) {
    writeFileSync(join(designRoot, 'ui', `${name}.tsx`), TSX);
    writeFileSync(join(designRoot, 'ui', `${name}.meta.json`), JSON.stringify(meta));
  }
  return { root, old, head, gone };
}

interface IndexData {
  canvasDsRevs?: Record<string, string>;
  systemHeads?: Record<string, string | null>;
  dsConverted?: Record<string, boolean>;
  dsRevGaps?: Record<string, string | null>;
}

async function indexOf(root: string): Promise<IndexData> {
  const port = nextPort();
  const proc = await bootServer(root, port);
  try {
    const r = await fetch(`http://localhost:${port}/_index-data`);
    expect(r.status).toBe(200);
    return (await r.json()) as IndexData;
  } finally {
    await killProc(proc);
  }
}

describe('/_index-data — which revision each canvas renders', () => {
  test('a converted system: heads, left-out canvases, and the revision that is not here', async () => {
    const s = sandbox({ convert: true });
    const data = await indexOf(s.root);
    expect(data.dsConverted).toEqual({ 'studio-site': true, plain: false });
    expect(data.systemHeads).toEqual({ 'studio-site': s.head });
    expect(data.canvasDsRevs).toEqual({
      '.design/ui/Landing.tsx': s.old,
      '.design/ui/Lost.tsx': s.gone,
    });
    expect(data.dsRevGaps).toEqual({ [s.gone]: null });
  });

  test('a project with nothing converted gets none of the new keys', async () => {
    const s = sandbox({ convert: false });
    const data = await indexOf(s.root);
    for (const k of ['canvasDsRevs', 'systemHeads', 'dsConverted', 'dsRevGaps'])
      expect(Object.hasOwn(data, k)).toBe(false);
  });
});
