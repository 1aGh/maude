// S4.18 — canvas 15 fidelity fixes found by the S4.V verifier.
//   an-sticky:      a sticky's words are set in the rounded face (`--font-rounded`), not monospace.
//   an-stk-gallery: the Stamps row carries its line, "vote · one each · they count".

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { slotTextStyle } from '../annotations/ui/text-style.ts';
import StickersGallery from '../client/v2/annotations/stickers-gallery.jsx';
import { createAnnotationPrefsStore } from '../client/v2/shell/annotation-prefs-store.js';

test('an-sticky: sticky words use --font-rounded; standalone text keeps its face', () => {
  expect(String(slotTextStyle('sticky', { fontSize: 14 }).fontFamily)).toContain('--font-rounded');
  expect(String(slotTextStyle('sticky', { fontSize: 14 }).fontFamily)).not.toContain('monospace');
  expect(String(slotTextStyle('text', { fontSize: 14 }).fontFamily)).toContain('monospace');
});

test('an-stk-gallery: the Stamps row says how stamps work', async () => {
  const DIR = join(import.meta.dir, '..', 'stickers');
  const packs = readdirSync(DIR).map((slug) => {
    const m = JSON.parse(readFileSync(join(DIR, slug, 'manifest.json'), 'utf8'));
    return {
      slug,
      name: m.name,
      author: m.author,
      stickers: m.stickers.map((s: { file: string }) => ({
        ...s,
        url: `/_stickers/${slug}/${s.file}`,
      })),
    };
  });
  (globalThis as { fetch?: unknown }).fetch = async () => ({
    json: async () => ({ ok: true, packs }),
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const prefs = createAnnotationPrefsStore({ persist: () => {}, storage: null });
  await act(async () => {
    root.render(<StickersGallery prefs={prefs} onPick={() => {}} onClose={() => {}} />);
  });
  await act(async () => {});
  const stamps = host.querySelector('[data-testid="stickers-stamps"] .sg-ph');
  expect(stamps?.textContent).toBe('Stampsvote · one each · they count');
  await act(async () => root.unmount());
  host.remove();
});
