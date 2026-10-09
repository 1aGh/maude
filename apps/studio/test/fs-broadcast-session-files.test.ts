// V2-2.8 S7 (follow-up) — the shell's socket feed does not name other
// members' session files either.
//
// S7 dropped other members' `_active.<session>.json` from `/_index-data`. The
// same names also reached every member through the inspector socket: fs-watch
// emits `fs:json` for any JSON write it does not skip (it skips `_active.json`,
// not its per-member siblings), and ws.ts broadcast it to every shell — so each
// member's selection change or camera pan (`_canvas-state/<session>/…`) told
// every other member that member's session key and when they were active.
// Found by the V2-2.8 ethical-hacker review.
//
// Runtime-state paths (the DDR-115 classifier) no longer ride the `fs:*`
// socket broadcasts. Nothing in the shell acts on them (client/hmr.mjs reacts
// to a canvas `.meta.json` only), and server-side bus subscribers still see
// every event — only the socket push is filtered.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const ALICE = 'aaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbb';

const as = (session: string) => ({
  'x-maude-session': session,
  'x-maude-role': 'member',
  'x-maude-readonly': '0',
});

describe('fs:* socket broadcasts skip runtime state (V2-2.8 S7 follow-up)', () => {
  test("a member's socket never hears another member's session files; canvas meta still arrives", async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      MAUDE_NO_AUTOBUILD: '1',
    });
    try {
      const frames: string[] = [];
      const ws = new WebSocket(`ws://localhost:${port}/_ws`, {
        headers: as(ALICE),
      } as unknown as string[]);
      await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()));
      ws.addEventListener('message', (ev) => frames.push(String(ev.data)));
      await Bun.sleep(300); // let the watcher settle past boot writes

      // Bob's runtime state changes on disk (what his own requests write).
      writeFileSync(join(designRoot, `_active.${BOB}.json`), '{"active":null}');
      mkdirSync(join(designRoot, '_canvas-state', BOB), { recursive: true });
      writeFileSync(
        join(designRoot, '_canvas-state', BOB, 'ui-fixture.view.json'),
        '{"viewport":{"x":1,"y":2,"zoom":1}}'
      );
      // Positive control: a versioned canvas sidecar still reaches the shell.
      writeFileSync(join(designRoot, 'ui', 'fixture.meta.json'), '{"layout":{}}');

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !frames.some((f) => f.includes('fixture.meta.json'))) {
        await Bun.sleep(50);
      }
      await Bun.sleep(500); // anything else in flight lands too
      ws.close();

      expect(frames.some((f) => f.includes('fixture.meta.json'))).toBe(true);
      const leaked = frames.filter((f) => f.includes(BOB));
      expect(leaked).toEqual([]);
    } finally {
      await killProc(proc);
    }
  }, 30_000);
});
