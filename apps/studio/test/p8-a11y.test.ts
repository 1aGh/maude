// V2-8.7 — the regression pins for the blockers the phase-8 a11y audit found
// (.ai/plans/notes/v2-evidence/V2-8.7-a11y.md). Each test is named for the axe rule it stands for; the live proof
// is the re-scan in the evidence note.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contrastRatio, oklchToRgb, parseOklch, type Rgb } from '../draw/palette';
import { TONE_COLOR } from '../presence/tones';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** `fg` at `alpha` composited over `bg`. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const mix = (a: number, b: number) => a * alpha + b * (1 - alpha);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

describe('color-contrast', () => {
  // The canvas HUD's selection tag: the size after the name was `opacity: .86` on the accent — 3.92:1 at 11 px.
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: the selection tag's quiet size ("· 480 × 258") holds 4.5:1 on the HUD accent`, () => {
      const tokens = read('../canvas-hud-tokens.gen.ts');
      const start = tokens.indexOf(
        theme === 'dark' ? ':root[data-maude-theme="dark"] {' : ':root[data-maude-theme="light"] {'
      );
      expect(start).toBeGreaterThan(0);
      const block = tokens.slice(start, tokens.indexOf('}', start));
      const get = (name: string) => {
        const m = new RegExp(`${name}:\\s*(oklch\\([^)]+\\))`).exec(block);
        if (!m) throw new Error(`${theme}: ${name} not declared`);
        return oklchToRgb(parseOklch(m[1]));
      };
      const accent = get('--maude-hud-accent');
      const fg = get('--maude-hud-accent-fg');
      const sel = read('../editing/selection.tsx');
      const rule = /\.ed-name-tag > \.ed-tag-q \{([^}]*)\}/.exec(sel);
      expect(rule).not.toBeNull();
      const opacity = Number(/opacity:\s*([\d.]+)/.exec(rule?.[1] ?? '')?.[1] ?? '1');
      expect(contrastRatio(over(fg, opacity, accent), accent)).toBeGreaterThanOrEqual(4.5);
    });
  }

  // A peer's cursor label and the co-edit hold tag are text on a person tone (L .70–.82). The label wore the HUD's
  // accent-fg (white): 2.2:1 on lilac.
  const ruleOf = (src: string, selector: string) => {
    const at = src.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no rule ${selector}`);
    return src.slice(at, src.indexOf('}', at));
  };
  const inkOf = (decl: string): Rgb => {
    // the HUD's accent-fg is white in both themes (canvas-hud-tokens.gen.ts) — a var() to it IS white, whatever its fallback says
    if (/color:\s*var\(--maude-hud-accent-fg/.test(decl)) return { r: 255, g: 255, b: 255 };
    const raw = /(?:^|[\s;{])color:\s*(?:var\([^,]+,\s*)?(oklch\([^)]+\)|#[0-9a-f]{3,6})\)?/i.exec(
      decl
    )?.[1];
    if (!raw) throw new Error(`no colour in: ${decl}`);
    return raw.startsWith('#') ? hexRgb(raw) : oklchToRgb(parseOklch(raw));
  };
  const hexRgb = (h: string): Rgb => {
    const x = h.length === 4 ? [...h.slice(1)].map((c) => c + c).join('') : h.slice(1);
    return {
      r: Number.parseInt(x.slice(0, 2), 16),
      g: Number.parseInt(x.slice(2, 4), 16),
      b: Number.parseInt(x.slice(4, 6), 16),
    };
  };
  for (const [name, file, selector] of [
    ['the peer cursor label', '../cursors-overlay.tsx', '.dc-cursor-label'],
    ['the co-edit hold tag', '../editing/hold-rings.tsx', '.ed-hold-ring .ed-hold-tag'],
    ['the peer selection label', '../cursors-overlay.tsx', '.dc-peer-selection__label'],
    ['the participant avatar initials', '../participants-chrome.tsx', '.dc-participant'],
  ] as const) {
    test(`${name}: its ink holds 4.5:1 on every person tone`, () => {
      const ink = inkOf(ruleOf(read(file), selector));
      for (const [tone, color] of Object.entries(TONE_COLOR)) {
        const bg = oklchToRgb(parseOklch(color));
        expect({ tone, ratio: contrastRatio(ink, bg) >= 4.5 }).toEqual({ tone, ratio: true });
      }
    });
  }
});
