// Wave-B gate design polish 1 — the standalone blockers (design-critic-1/-2, waveB-gate): the Export sheet's
// Other… list escapes the sheet's scroll box (09 B3), the Share sheet titles the canvas by its name (10 B2), a
// Timeline clip's inspector draws only what applies to a clip (07), and the copy names neither the app, the tool
// nor a design board (RC-F, CONTRACT §4).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const roots: Array<{ unmount: () => void }> = [];
afterEach(async () => {
  const { act } = await import('react');
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

async function mount(el: unknown): Promise<HTMLElement> {
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el as never));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  return host;
}

describe('09 B3 · the Other… list is fixed to the window, not clipped by the sheet', () => {
  test('menuPlace: below the button when it fits, above when the window has no room, never taller than the room', async () => {
    const { menuPlace } = await import('../client/v2/export/other-formats.jsx');
    expect(menuPlace(null, 800)).toBeNull();
    const below = menuPlace({ top: 100, bottom: 128, left: 40 }, 800);
    expect(below?.side).toBe('below');
    expect(below?.style).toMatchObject({ position: 'fixed', top: 132, left: 40 });
    expect(below?.style.maxHeight).toBeLessThanOrEqual(800 - 132 - 16);
    const above = menuPlace({ top: 700, bottom: 728, left: 40 }, 800);
    expect(above?.side).toBe('above');
    expect(above?.style).toMatchObject({ position: 'fixed', top: 'auto', bottom: 104 });
    expect(above?.style.maxHeight).toBeLessThanOrEqual(700 - 4 - 16);
  });

  test('the open list carries the fixed placement', async () => {
    const { createElement: h } = await import('react');
    const { OtherFormats } = await import('../client/v2/export/other-formats.jsx');
    const host = await mount(
      h(OtherFormats, {
        groups: [
          { group: 'Images', items: [{ id: 'png', label: 'PNG', format: 'png', note: 'n' }] },
        ],
        format: 'png',
        onPick: () => {},
        open: true,
        setOpen: () => {},
      })
    );
    const pop = host.querySelector('[data-testid="export-other-menu"]') as HTMLElement;
    expect(pop.style.position).toBe('fixed');
  });
});

describe('10 B2 · the Share sheet names the canvas, not its file', () => {
  test('"Share Smoke", never "Share Smoke.tsx"', async () => {
    const { sheetView } = await import('../client/v2/share/share-model.js');
    const v = sheetView({
      posture: { linked: true, reachable: true },
      me: { role: 'owner' },
      target: { path: '.design/ui/Smoke.tsx', label: 'Smoke.tsx' },
      project: 'Studio site',
    } as never);
    expect(v.title).toBe('Share Smoke');
  });
});

describe('07 · a Timeline clip draws only what applies to a clip', () => {
  test('no Interaction, no PNG/SVG Export — the Clip section only', async () => {
    const { createElement: h } = await import('react');
    // the canvas-element sections a clip used to inherit, registered as in the app
    await import('../client/v2/inspector/sections/interaction.jsx');
    await import('../client/v2/inspector/sections/export-slot.jsx');
    await import('../client/v2/inspector/kinds/clip.jsx');
    const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
    const { timelineSelectionElement } = await import('../client/v2/timeline/selection.js');
    const sel = {
      kind: 'clip',
      canvas: '.design/ui/Reel.tsx',
      artboardId: 'reel',
      fps: 30,
      stableId: 'name:dron',
      label: 'Dron nad lajnou',
      seq: {
        from: 0,
        duration: 75,
        label: 'Video',
        series: true,
        mediaTag: 'Video',
        mediaSrc: 'assets/dron.mp4',
        mediaProps: { playbackRate: 1, volume: 0.7, muted: false, trimBefore: 0 },
        rowKind: 'video',
      },
      transitionAfter: null,
      onVerb: () => {},
      onOp: () => {},
      onJoin: () => {},
      onRemoveJoin: () => {},
      deselect: () => {},
    };
    const host = await mount(
      h(InspectorFrame, {
        selected: timelineSelectionElement(sel as never),
        layersTree: null,
        cfg: { designRel: '.design' },
        canvasFile: '.design/ui/Reel.tsx',
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)
    );
    expect(host.querySelector('[data-testid="inspector-kind"]')?.textContent).toBe('Clip');
    expect(host.querySelector('[data-testid="insp-sec-clip"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="insp-sec-interaction"]')).toBeNull();
    expect(host.querySelector('[data-testid="insp-sec-export"]')).toBeNull();
    expect(host.textContent).not.toContain('PNG · 2×');
  });
});

describe('RC-F · the copy names neither the app, the tool nor a design board (CONTRACT §4)', () => {
  const STUDIO = join(import.meta.dir, '..');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (n !== 'node_modules' && n !== 'contracts') walk(p, out);
      } else if (/\.(jsx|js|tsx|ts)$/.test(n) && !/\.test\./.test(n)) out.push(p);
    }
    return out;
  };
  // fixed v1 phrases the critics found on screen; a comment may still say them
  const BANNED = [
    /as in \d\d [A-Z]/, // "— as in 04 Modes."
    /changed outside Maude/,
    /\(the `claude` CLI\)/,
    /shell chrome'/,
    /while Maude is closed/,
    /How the CSS panel labels/,
  ];
  const code = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .map((l) => l.replace(/\s\/\/\s.*$/, '')) // a trailing `// …` comment
      .join('\n');
  test('no banned phrase in a string the client, the history titles or the AI readiness check renders', () => {
    const files = [
      ...walk(join(STUDIO, 'client')),
      join(STUDIO, 'history/titles.ts'),
      join(STUDIO, 'readiness.ts'),
      join(STUDIO, 'ds/engine.ts'),
      join(STUDIO, 'ds/library.ts'),
    ];
    const hits: string[] = [];
    for (const f of files) {
      const src = code(readFileSync(f, 'utf8'));
      for (const re of BANNED) if (re.test(src)) hits.push(`${f.slice(STUDIO.length + 1)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });
});
