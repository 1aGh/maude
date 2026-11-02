// G10 — a toast waits only for a tour that is RUNNING. The first-run tour OFFER is a dismissible callout
// (V2-4.9: top-centre, `v2/shell/callouts.css`) and it never overlaps the toasts (bottom-centre), so it must
// not hide them: on a new profile "Opened from a link — …", "Restored …" and every error stayed invisible
// until the person closed the offer (`paused` was the v1 rule, when the offer was a box in the corner).

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = readFileSync(join(import.meta.dir, '../client/app.jsx'), 'utf8');

test('G10: the notification host is paused by a running tour only, never by the offer', () => {
  const host = /<NotificationHost\b[^>]*?\/>/s.exec(app)?.[0] ?? '';
  expect(host).not.toBe('');
  const paused = /paused=\{([^}]*)\}/.exec(host)?.[1] ?? '';
  expect(paused).toContain('tourSteps');
  expect(paused).not.toContain('usageNudge');
  expect(paused).not.toContain('collabNudge');
});
