// S3.6a — client/v2/present/audience-window.js, the page half of the audience window. The shell
// (present.rs) builds the follower URL itself, so the page must send exactly a display id, the
// canvas and the session id — never a URL — under the command names the Rust side registers
// (Tauri maps `displayId` to `display_id`). Outside the app the seam is inert.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  audienceDisplay,
  canPresentToAnotherDisplay,
  closeAudience,
  openAudience,
  presentDisplays,
} from '../client/v2/present/audience-window.js';

const g = globalThis as unknown as { window?: Record<string, unknown> };
const hadWindow = 'window' in g;
afterEach(() => {
  if (hadWindow && g.window) g.window.__TAURI__ = undefined;
  else Reflect.deleteProperty(g, 'window');
});

type Call = { cmd: string; args: unknown };
function shell(answer: (cmd: string) => unknown) {
  const calls: Call[] = [];
  if (!g.window) g.window = {};
  g.window.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: unknown) => {
        calls.push({ cmd, args });
        const a = answer(cmd);
        if (a instanceof Error) throw a;
        return a;
      },
    },
  };
  return calls;
}

const TWO = [
  { id: 'aaaaaaaaaaaaaaaa', name: 'Built-in Retina Display', primary: true, current: true },
  { id: 'bbbbbbbbbbbbbbbb', name: 'LG UltraFine', primary: false, current: false },
];

describe('audience window seam', () => {
  test('opens with display, canvas and session id only — the shell builds the URL', async () => {
    const calls = shell(() => null);
    await openAudience({ displayId: 'bbbbbbbbbbbbbbbb', canvas: 'ui/deck.tsx', sid: 'abcd1234' });
    expect(calls).toEqual([
      {
        cmd: 'present_audience_open',
        args: { displayId: 'bbbbbbbbbbbbbbbb', canvas: 'ui/deck.tsx', sid: 'abcd1234' },
      },
    ]);
    expect(Object.keys(calls[0].args as object)).not.toContain('url');
  });

  test('a refusal reaches the caller; close is idempotent and swallows a refusal', async () => {
    const calls = shell((cmd) =>
      cmd === 'present_audience_open' ? new Error('Switch to this tab first.') : new Error('x')
    );
    await expect(
      openAudience({ displayId: 'b', canvas: 'd.tsx', sid: 'abcd1234' })
    ).rejects.toThrow('Switch to this tab first.');
    await closeAudience();
    expect(calls.map((c) => c.cmd)).toEqual(['present_audience_open', 'present_audience_close']);
  });

  test('lists displays; the row exists only with more than one', async () => {
    shell((cmd) => (cmd === 'present_displays' ? TWO : null));
    const list = await presentDisplays();
    expect(list).toEqual(TWO);
    expect(canPresentToAnotherDisplay(list)).toBe(true);
    expect(canPresentToAnotherDisplay(list.slice(0, 1))).toBe(false);
    expect(audienceDisplay(list)?.id).toBe('bbbbbbbbbbbbbbbb');
    expect(audienceDisplay(list.slice(0, 1))).toBeNull();
    shell(() => new Error("This window isn't showing its project."));
    expect(await presentDisplays()).toEqual([]);
  });

  test('prefers a display the window is not on, non-primary first', () => {
    const three = [
      { id: 'a', name: 'A', primary: false, current: true },
      { id: 'p', name: 'P', primary: true, current: false },
      { id: 'c', name: 'C', primary: false, current: false },
    ];
    expect(audienceDisplay(three)?.id).toBe('c');
    expect(audienceDisplay([three[0], three[1]])?.id).toBe('p');
  });

  test('the command names and parameters are the ones the shell registers', () => {
    const tauri = join(import.meta.dir, '../../desktop/src-tauri');
    const build = readFileSync(join(tauri, 'build.rs'), 'utf8');
    const caps = JSON.parse(readFileSync(join(tauri, 'capabilities/default.json'), 'utf8'));
    const present = readFileSync(join(tauri, 'src/present.rs'), 'utf8');
    for (const cmd of ['present_displays', 'present_audience_open', 'present_audience_close']) {
      expect(build).toContain(`"${cmd}"`);
      expect(caps.permissions).toContain(`allow-${cmd.replaceAll('_', '-')}`);
    }
    const open = present.slice(present.indexOf('pub async fn present_audience_open('));
    expect(open.slice(0, open.indexOf(') -> Result')).replace(/\s+/g, ' ')).toContain(
      'webview: tauri::Webview, display_id: String, canvas: String, sid: String,'
    );
  });

  test('outside the desktop app it is inert', async () => {
    if (g.window) g.window.__TAURI__ = undefined;
    expect(await presentDisplays()).toEqual([]);
    expect(canPresentToAnotherDisplay(TWO)).toBe(false);
    await closeAudience();
    await expect(
      openAudience({ displayId: 'b', canvas: 'd.tsx', sid: 'abcd1234' })
    ).rejects.toThrow('Maude app');
  });
});
