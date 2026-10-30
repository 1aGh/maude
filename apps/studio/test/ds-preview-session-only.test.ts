// S10.14 (13 · ds-many-switch) — "Preview in …" stores nothing. ↑↓ re-renders every open canvas through the
// session-only `?dsPreview=<ds>` override; closing the window ends it. Pinned three ways: the session is a module
// variable that steps, wraps and stops; the module (and the shell's frames) contain no storage, cookie, network or
// file call at all; and the canvas URL is the ONLY thing that carries the system's name, byte-identical to today's
// once the preview ends.
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { canvasUrl } from '../client/canvas-url.js';
import {
  beginDsPreview,
  getDsPreview,
  PREVIEW_WORDS,
  pickDsPreview,
  resetDsPreview,
  stepDsPreview,
  stopDsPreview,
  subscribeDsPreview,
  withDsPreview,
} from '../client/v2/ds/preview-mode.js';

afterEach(resetDsPreview);

const SYSTEMS = ['studio', 'warm', 'gator'];

describe('the preview session', () => {
  test('starts on the system after the row’s own, steps and wraps, and stops', () => {
    expect(getDsPreview()).toBeNull();
    const s = beginDsPreview({ from: 'studio', systems: SYSTEMS });
    expect(s).toMatchObject({ from: 'studio', target: 'warm' });
    expect(stepDsPreview(1)?.target).toBe('gator');
    expect(stepDsPreview(1)?.target).toBe('studio'); // wraps; ↑ can come back to the one in use
    expect(stepDsPreview(-1)?.target).toBe('gator');
    expect(pickDsPreview('warm')?.target).toBe('warm');
    expect(pickDsPreview('nope')?.target).toBe('warm'); // an unknown name changes nothing
    expect(stopDsPreview()).toBe(true);
    expect(getDsPreview()).toBeNull();
    expect(stopDsPreview()).toBe(false);
    expect(stepDsPreview(1)).toBeNull();
  });

  test('one system is nothing to look at', () => {
    expect(beginDsPreview({ from: 'studio', systems: ['studio'] })).toBeNull();
    expect(beginDsPreview({ from: 'studio', systems: [] })).toBeNull();
    expect(getDsPreview()).toBeNull();
  });

  test('every change is announced, once', () => {
    const seen: (string | undefined)[] = [];
    const off = subscribeDsPreview(() => seen.push(getDsPreview()?.target));
    beginDsPreview({ from: 'studio', systems: SYSTEMS });
    stepDsPreview(1);
    stopDsPreview();
    off();
    stepDsPreview(1);
    expect(seen).toEqual(['warm', 'gator', undefined]);
  });
});

describe('it stores nothing', () => {
  test('a whole session touches no storage, cookie, IndexedDB or network', () => {
    const touched: string[] = [];
    const g = globalThis as Record<string, unknown>;
    const trap = (name: string) =>
      new Proxy(
        {},
        {
          get: (_t, k) => {
            touched.push(`${name}.${String(k)}`);
            return () => undefined;
          },
        }
      );
    const keep = { localStorage: g.localStorage, sessionStorage: g.sessionStorage, fetch: g.fetch };
    Object.defineProperty(g, 'localStorage', { value: trap('localStorage'), configurable: true });
    Object.defineProperty(g, 'sessionStorage', {
      value: trap('sessionStorage'),
      configurable: true,
    });
    g.fetch = () => {
      touched.push('fetch');
      return Promise.reject(new Error('no network'));
    };
    try {
      beginDsPreview({ from: 'studio', systems: SYSTEMS });
      stepDsPreview(1);
      stepDsPreview(-1);
      pickDsPreview('gator');
      stopDsPreview();
    } finally {
      for (const [k, v] of Object.entries(keep))
        Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
    }
    expect(touched).toEqual([]);
  });

  test('the sources that hold the preview name no storage and no network call', () => {
    const root = path.join(import.meta.dir, '..', 'client');
    // the store, the bar, and the shell frame builder: the three places a preview target travels through
    for (const f of ['v2/ds/preview-mode.js', 'v2/ds/preview-bar.jsx']) {
      const src = readFileSync(path.join(root, f), 'utf8');
      const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const bad of [
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'document.cookie',
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        'postMessage',
        'navigator.sendBeacon',
      ])
        expect({ f, bad, hit: code.includes(bad) }).toEqual({ f, bad, hit: false });
    }
  });
});

describe('the canvas URL is the only carrier', () => {
  const cfg = {
    designRel: '.design',
    designSystems: [
      {
        name: 'studio',
        path: 'system/studio',
        rootClass: 'studio',
        tokensCssRel: 'system/studio/colors_and_type.css',
      },
      {
        name: 'warm',
        path: 'system/warm',
        rootClass: 'warm',
        tokensCssRel: 'system/warm/colors_and_type.css',
      },
    ],
    canvasDesignSystems: { 'ui/Home.tsx': 'studio' },
    dsConverted: {},
  };

  test('while previewing, every canvas asks for the previewed system’s files; afterwards, today’s URL', () => {
    const before = canvasUrl('ui/Home.tsx', cfg);
    expect(before).toContain('tokens=system%2Fstudio%2Fcolors_and_type.css');
    const s = beginDsPreview({ from: 'studio', systems: ['studio', 'warm'] });
    const during = canvasUrl('ui/Home.tsx', cfg, withDsPreview(undefined, s?.target));
    expect(during).toContain('tokens=system%2Fwarm%2Fcolors_and_type.css');
    expect(during).not.toContain('dsPreview'); // the name rides as the system's own files, not a parameter
    stopDsPreview();
    const after = canvasUrl('ui/Home.tsx', cfg, withDsPreview(undefined, getDsPreview()?.target));
    expect(after).toBe(before);
    // nothing in the config moved: the canvas still belongs to its own system
    expect(cfg.canvasDesignSystems['ui/Home.tsx']).toBe('studio');
  });

  test('an unknown system is ignored — the override never invents a path', () => {
    expect(canvasUrl('ui/Home.tsx', cfg, { dsPreview: '../../etc' })).toBe(
      canvasUrl('ui/Home.tsx', cfg)
    );
  });

  test('the shell’s frames build their URL through the preview target', () => {
    const src = readFileSync(
      path.join(import.meta.dir, '..', 'client', 'shell', 'viewport.jsx'),
      'utf8'
    );
    expect(src).toContain("from '../v2/ds/preview-mode.js'");
    expect(src).toContain('withDsPreview(held, dsPreview)');
  });

  test('the words are the artboard’s', () => {
    expect(PREVIEW_WORDS.banner('Studio site', 'Warm paper')).toBe(
      'Previewing Studio site in Warm paper.'
    );
    expect(PREVIEW_WORDS.shown(5)).toBe('5 canvases shown in it · esc to stop');
    expect(PREVIEW_WORDS.action).toBe('Switch…');
  });
});
