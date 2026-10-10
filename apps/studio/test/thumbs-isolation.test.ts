// V2-2.17 — R3: no IPC, no cookies (contract V2-1.17 §5.8). Every project server's renderer is its
// own Chromium process with its own non-persistent context. Cookies are keyed by HOST, not port,
// so two projects on localhost would share one jar if they shared a context — the planted canvas
// in project A sets a cookie during its render, and project B's renderer must not hold it.

import { afterAll, describe, expect, test } from 'bun:test';

import { killProc } from './_helpers.ts';
import { rig, settle, type ThumbRig } from './_thumbs-helpers.ts';

const cookieCanvas = (
  name: string
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
document.cookie = "${name}=1; path=/; max-age=3600";
export default function C() {
  return (<DesignCanvas><DCSection id="s" title="C">
    <DCArtboard id="one" label="One" width={200} height={100}><div style={{ background: "#333", height: "100%" }} /></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;
const COVER = { canvas: 'ui/C.tsx', artboard: null, size: 'card', priority: 'visible' } as const;

const rigs: ThumbRig[] = [];
afterAll(async () => {
  for (const r of rigs) {
    r.svc.stop();
    await killProc(r.proc);
  }
});

describe('R3 — one renderer process and one fresh context per project (V2-2.17)', () => {
  test('a cookie set while rendering project A is not in project B’s renderer', async () => {
    const a = await rig(() => ({ 'ui/C.tsx': cookieCanvas('leak_from_a') }));
    const b = await rig(() => ({ 'ui/C.tsx': cookieCanvas('own_b') }));
    rigs.push(a, b);
    expect((await settle(a.svc, COVER)).status).toBe('ready');
    expect((await settle(b.svc, COVER)).status).toBe('ready');
    const pa = await a.svc.probe();
    const pb = await b.svc.probe();
    expect(pa?.cookies).toContain('leak_from_a');
    expect(pb?.cookies).toContain('own_b');
    expect(pb?.cookies).not.toContain('leak_from_a');
    // separate OS processes, neither of them this one nor a server
    expect(pa?.pid).not.toBe(pb?.pid);
    for (const pid of [pa?.pid, pb?.pid]) {
      expect(pid).not.toBe(process.pid);
      expect(pid).not.toBe(a.proc.pid);
      expect(pid).not.toBe(b.proc.pid);
    }
  }, 90_000);
});
