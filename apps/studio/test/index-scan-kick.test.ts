// S8.12 — the history scan behind "Not used" needs a home to read versions from, and server.ts attaches the sync
// runtime AFTER http.ts builds the index. Without a nudge the scan stays 'idle' for the whole session. `kickWhenReady`
// starts it the moment a home answers, a bounded number of tries, never for ever.
import { describe, expect, test } from 'bun:test';

import { kickWhenReady } from '../index/scan-kick.ts';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('kickWhenReady', () => {
  test('kicks once, when the home first answers', async () => {
    let up = false;
    let kicks = 0;
    const stop = kickWhenReady({ ready: () => up, kick: () => kicks++, everyMs: 5, tries: 50 });
    await tick(20);
    expect(kicks).toBe(0);
    up = true;
    await tick(30);
    expect(kicks).toBe(1);
    await tick(30);
    expect(kicks).toBe(1);
    stop();
  });

  test('kicks at once when a home is already there', async () => {
    let kicks = 0;
    kickWhenReady({ ready: () => true, kick: () => kicks++, everyMs: 5, tries: 5 });
    await tick(15);
    expect(kicks).toBe(1);
  });

  test('gives up after its tries (a project with no home never keeps a timer alive)', async () => {
    let asked = 0;
    let kicks = 0;
    kickWhenReady({
      ready: () => {
        asked++;
        return false;
      },
      kick: () => kicks++,
      everyMs: 3,
      tries: 4,
    });
    await tick(60);
    expect(kicks).toBe(0);
    expect(asked).toBe(4);
  });

  test('stop() ends it', async () => {
    let kicks = 0;
    const stop = kickWhenReady({ ready: () => false, kick: () => kicks++, everyMs: 5, tries: 50 });
    stop();
    await tick(30);
    expect(kicks).toBe(0);
  });
});
