// V2-7.3 — the What's New panel offers "Take tour" only for an entry that can still be replayed: an entry
// marked `replayable: false` spotlights chrome that v2 removed, so its tour is not offered again. The
// committed feed carries the v2.0 entry as a pending one (stamped later by scripts/bump-version.sh).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhatsNewPanel } from '../client/whats-new.jsx';

const STEP = { target: "[data-testid='project-pill']", title: 'T', body: 'B' };
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  version: '1.0.0',
  date: '2026-01-01',
  kind: 'feature',
  title: `Title ${id}`,
  summary: `Summary ${id}`,
  ...extra,
});

function panel(entries: unknown[]) {
  const wn = { panelOpen: true, closePanel: () => {}, unseen: [], entries };
  return renderToStaticMarkup(<WhatsNewPanel wn={wn} onStartTour={() => {}} />);
}

describe('What’s New panel — replayable tours', () => {
  test('a replayable entry offers Take tour; a non-replayable one does not', () => {
    const html = panel([
      entry('live', { tour: [STEP] }),
      entry('frozen', { tour: [STEP], replayable: false }),
      entry('no-tour'),
    ]);
    const li = (id: string) =>
      html.split('<li').find((chunk) => chunk.includes(`Title ${id}`)) ?? '';
    expect(li('live')).toContain('Take tour');
    expect(li('frozen')).not.toContain('Take tour');
    expect(li('frozen')).toContain('Summary frozen'); // the entry itself still reads
    expect(li('no-tour')).not.toContain('Take tour');
  });
});

describe('the committed feed', () => {
  const feed = JSON.parse(
    readFileSync(path.resolve(import.meta.dir, '../whats-new.json'), 'utf8')
  ) as {
    entries: Array<{
      id: string;
      version: string | null;
      date: string | null;
      kind: string;
      replayable?: unknown;
      tour?: unknown[];
    }>;
  };

  test('carries the v2.0 entry as the newest one — pending on an rc, stamped by the 2.0.0 release', () => {
    const v2 = feed.entries.find((e) => e.id === 'maude-v2-canvas-window');
    expect(v2).toBeDefined();
    const pkgVersion: string = JSON.parse(
      readFileSync(path.join(import.meta.dir, '..', 'package.json'), 'utf8')
    ).version;
    if (/-/.test(pkgVersion)) {
      expect(v2?.version).toBeNull();
      expect(v2?.date).toBeNull();
    } else {
      expect(v2?.version).toMatch(/^2\.\d+\.\d+$/);
      expect(typeof v2?.date).toBe('string');
    }
    expect(v2?.kind).toBe('feature');
    // Newest of the 1.x → 2.0 line: only 2.x entries (stamped or pending) may sit above it.
    const at = feed.entries.findIndex((e) => e.id === 'maude-v2-canvas-window');
    for (const e of feed.entries.slice(0, at))
      expect(e.version === null || /^2\./.test(String(e.version)), e.id).toBe(true);
    expect(feed.entries.slice(at + 1).some((e) => /^2\./.test(String(e.version)))).toBe(false);
  });

  test('`replayable`, when present, is the boolean false (the default is true, so true is never written)', () => {
    for (const e of feed.entries) if ('replayable' in e) expect(e.replayable, e.id).toBe(false);
  });
});
