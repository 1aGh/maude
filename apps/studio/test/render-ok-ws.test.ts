// S6.12 — the inspector socket's `render-ok` frame reaches `_state/render-ok.json`, and ONLY as the server
// reads it: the frame names a canvas; the hash comes from the file on disk. A read-only session writes nothing.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { srcHashOf } from '../history/last-good.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const GOOD = 'export default function A() { return <div>hi</div>; }\n';
const BROKEN = 'export default function A() { return <div>hi</div ; }\n';

async function open(port: number, headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://localhost:${port}/_ws`, { headers } as unknown as string[]);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no socket')), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener('error', (e) => reject(e));
  });
  return ws;
}

const read = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, { srcHash: string }>;
  } catch {
    return null;
  }
};

describe('render-ok over the inspector socket', () => {
  test('records the canvas by its DISK source; a broken one and a viewer record nothing', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'good.tsx'), GOOD);
    writeFileSync(join(designRoot, 'ui', 'broken.tsx'), BROKEN);
    const record = join(designRoot, '_state', 'render-ok.json');
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    });
    try {
      // a viewer's socket: the frame is refused before it touches disk
      const viewer = await open(port, {
        'x-maude-session': 'bbbbbbbbbbbbbbbb',
        'x-maude-role': 'viewer',
        'x-maude-readonly': '1',
        'x-maude-user': 'v@team.test',
      });
      viewer.send(JSON.stringify({ type: 'render-ok', file: '.design/ui/good.tsx' }));
      await Bun.sleep(400);
      expect(existsSync(record)).toBe(false);
      viewer.close();

      const ws = await open(port, {
        'x-maude-session': 'aaaaaaaaaaaaaaaa',
        'x-maude-role': 'member',
        'x-maude-readonly': '0',
        'x-maude-user': 'm@team.test',
      });
      // the frame carries no hash we would believe — a forged one is ignored
      ws.send(
        JSON.stringify({
          type: 'render-ok',
          file: '.design/ui/broken.tsx',
          srcHash: srcHashOf(BROKEN),
        })
      );
      ws.send(
        JSON.stringify({ type: 'render-ok', file: '.design/ui/good.tsx', srcHash: 'f'.repeat(64) })
      );
      const deadline = Date.now() + 5000;
      while (!read(record)?.['ui/good.tsx'] && Date.now() < deadline) await Bun.sleep(50);
      const all = read(record);
      expect(all?.['ui/good.tsx']?.srcHash).toBe(srcHashOf(GOOD));
      expect(all?.['ui/broken.tsx']).toBeUndefined();
      ws.close();
    } finally {
      await killProc(proc);
    }
  }, 30_000);
});
