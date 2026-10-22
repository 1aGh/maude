// gate-b-c4c (security-auditor, medium) — the canvas shell DOCUMENT is frame-less (it names
// nobody's project: its data comes through capability-carrying requests), but `serveCanvasShell`
// inlined two things about whatever canvas the query named without asking who asked:
//
//   - `?canvas=B&sha=<ref>` → B's `.meta.json` at that ref, as the version-meta global;
//   - `?canvas=B&tokens=<css>` → B's `dsPairing` aliases in the fallback slot.
//
// So canvas A's code could `fetch('/_canvas-shell.html?canvas=ui/b.tsx&sha=HEAD')` on its own
// origin (or the capture origin) and read B's meta — with no capability or with A's. Now both are
// injected only when the request's frame-narrowed access sees the named canvas; otherwise the
// shell is bare. (The git reader takes a literal `HEAD` as the ref — the guard is positional.)

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const MARKER = 'B-PAST-META-7f3c';
const ALIAS = '--secret-b-alias';
const TOKENS = 'system/beta/colors_and_type.css';

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(
    ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }
  );
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
}

describe('gate-b-c4c — the shell document carries a canvas meta only for a frame that sees it', () => {
  test("canvas A's frame (or none) gets neither B's past meta nor B's pairing; B's frame gets both", async () => {
    const { root, designRoot } = makeSandbox();
    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    cfg.designSystems = [{ name: 'beta', path: 'system/beta' }];
    writeFileSync(join(designRoot, 'config.json'), JSON.stringify(cfg, null, 2));
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    mkdirSync(join(designRoot, 'system', 'beta'), { recursive: true });
    writeFileSync(join(designRoot, TOKENS), ':root { --accent: rgb(255, 0, 0); }\n');
    writeFileSync(join(designRoot, 'ui', 'a.tsx'), 'export default () => null;\n');
    writeFileSync(join(designRoot, 'ui', 'b.tsx'), 'export default () => null;\n');
    writeFileSync(
      join(designRoot, 'ui', 'b.meta.json'),
      JSON.stringify({ designSystem: 'beta', dsPairing: { [ALIAS]: '--accent' }, note: MARKER })
    );
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fixture');

    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    try {
      const main = `http://localhost:${port}`;
      const r = await fetch(`${main}/_canvas-shell.html?canvas=ui/a.tsx`, { redirect: 'manual' });
      const capture = new URL(r.headers.get('location') ?? '').origin;
      const canvas = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'))
        .canvasOrigin as string;
      expect(canvas).toBeTruthy();
      const fcA = await frameCap({ base: main }, {}, 'ui/a.tsx');
      const fcB = await frameCap({ base: main }, {}, 'ui/b.tsx');

      const shell = async (origin: string, q: string, fc: string | null) => {
        const url = `${origin}/_canvas-shell.html?${q}`;
        const res = await fetch(fc ? withFc(url, fc) : url, { signal: AbortSignal.timeout(5000) });
        expect(res.status).toBe(200);
        return res.text();
      };
      const asks = [
        'canvas=ui/b.tsx&sha=HEAD',
        `canvas=ui/b.tsx&tokens=${TOKENS}`,
        `canvas=.design/ui/b.tsx&tokens=${TOKENS}`,
        `canvas=x/ui/b.tsx&designRel=x&tokens=${TOKENS}`, // the pairing reader's own designRel
      ];
      for (const origin of [canvas, capture]) {
        for (const q of asks) {
          for (const [who, fc] of [
            ['none', null],
            ['A', fcA],
          ] as const) {
            const html = await shell(origin, q, fc);
            expect(`${origin} ${who} ${q} meta=${html.includes(MARKER)}`).toBe(
              `${origin} ${who} ${q} meta=false`
            );
            expect(`${origin} ${who} ${q} pairing=${html.includes(ALIAS)}`).toBe(
              `${origin} ${who} ${q} pairing=false`
            );
          }
        }
        // B's own frame still gets its version meta (literal HEAD is a ref) and its pairing.
        expect(await shell(origin, 'canvas=ui/b.tsx&sha=HEAD', fcB)).toContain(MARKER);
        expect(await shell(origin, `canvas=ui/b.tsx&tokens=${TOKENS}`, fcB)).toContain(ALIAS);
      }
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
