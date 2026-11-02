// P8 bug sweep B1 — copy that broke CONTRACT §3 (AI chat panel · AI — never Assistant / Claude; Version history —
// never Changes) or said something untrue, in the places a person meets first: Quick setup, the desktop
// notifications, the panel's folded icon. A tripwire over the source text: these strings are rendered by
// code that needs a desktop shell or a live server to run.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { facesOf } from '../client/v2/shell/save-status.js';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('P8 B1 — words', () => {
  test('Quick setup says "AI", not "the Assistant"', () => {
    expect(read('client/panels/SetupChecklist.jsx')).not.toMatch(/Ask the Assistant/);
    expect(read('client/panels/SetupChecklist.jsx')).toMatch(/Ask AI to build each\s+step/);
    expect(read('design-setup-readiness.ts')).not.toMatch(/ask the Assistant/);
  });

  test('Quick setup does not say a canvas is "open for editing" when it only exists', () => {
    // it read "Cut.tsx is open for editing." over an empty window with nothing open
    expect(read('design-setup-readiness.ts')).not.toMatch(/is open for editing/);
    expect(read('design-setup-readiness.ts')).toMatch(/is in this project\./);
  });

  test('desktop notifications name AI, and point at where Sync lives now', () => {
    const src = read('client/hooks/use-shell-core.jsx');
    expect(src).not.toMatch(/notifyDesktop\('Claude finished'/);
    expect(src).not.toMatch(/Claude is waiting/);
    expect(src).not.toMatch(/Open the Sync panel/);
    expect(src).toMatch(/Menu › Diagnostics › Sync/);
  });

  test('the AI face in the Share cluster is "AI · editing" — never "Claude" (CONTRACT §3)', () => {
    const faces = facesOf({ you: 'Michal', agentActive: true });
    expect(faces.find((f: { agent?: boolean }) => f.agent)?.name).toBe('AI · editing');
  });
});
