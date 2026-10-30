// gate-a-polish — the wave-A gate's design-critic + a11y blockers, pinned.
//   · the vote sheet (aria-modal) traps Tab and gives focus back to its opener when it closes (a11y W1/W3);
//   · the Canvases Sort button is not a child of the role=tree element (a11y B1);
//   · --fg-3 text clears 4.5:1 in both themes on the surfaces it sits on (a11y B2);
//   · the source rules for the visual fixes: segmented-control font, `.island--pad`, the context-menu material,
//     the artboard name above the frame, the plain "Not now", no "Claude" in the banner / no "Ready · Claude Code" row.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import VoteSheet from '../client/v2/annotations/vote-sheet.jsx';
import { shellCss } from './_shell-css';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('vote sheet focus (a11y W1 / W3)', () => {
  const state = {
    artboards: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    mode: 'local',
    line: 'Anyone who can open this project can see the votes.',
    sheet: {},
  };

  test('Tab wraps inside the sheet and Esc returns focus to the opener', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let closed = 0;
    await act(async () =>
      root.render(
        <VoteSheet state={state} onStart={async () => ({ ok: true })} onClose={() => closed++} />
      )
    );
    const form = host.querySelector('form') as HTMLFormElement;
    const focusables = [
      ...form.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), button:not([disabled])'
      ),
    ];
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      last.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      (focusables[0] as HTMLElement).dispatchEvent(back);
    });
    expect(document.activeElement).toBe(last);
    // Esc closes (the host unmounts the sheet) and focus goes back
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(1);
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
    host.remove();
    opener.remove();
  });
});

// ── token contrast (a11y B2) ─────────────────────────────────────────────────────────────────
function oklchToRgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const lum = (c: [number, number, number]) => {
  const f = (x: number) => {
    const v = Math.min(1, Math.max(0, x));
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return g <= 0.04045 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
function tokenIn(block: string, name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(block);
  if (!m) throw new Error(`no --${name} in block`);
  return oklchToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
};

// P8 C0: the shell ladder is maude-v2, where --fg-3 is the DISABLED grade. The v1 chrome's --fg-3 (made text-safe by
// a11y B2) was re-pointed to --fg-2, so the text-safe pledge now sits on --fg-2 and the v1 files never say --fg-3.
/** Rules that put `--fg-3` on something. A control that IS disabled (`:disabled`, `[disabled]`, `[aria-disabled]`)
 *  wears the disabled grade on purpose — WCAG exempts inactive controls and the kit draws them so (03 AI panel:
 *  the send button at rest); what the pledge bans is meta TEXT on that grade. */
function textUsesOfDisabledGrade(css: string): string[] {
  const out: string[] = [];
  for (const chunk of css.split('}')) {
    const open = chunk.lastIndexOf('{');
    if (open < 0 || !/var\(--fg-3\b/.test(chunk.slice(open))) continue;
    const sel = chunk
      .slice(0, open)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    if (/:disabled|\[disabled|\[aria-disabled/.test(sel)) continue;
    out.push(sel);
  }
  return out;
}

describe("the v1 chrome's meta text grade (--fg-2, was --fg-3) is text-safe (a11y B2)", () => {
  const css = read('client/styles/1-tokens-shell.css');
  const dark = css.slice(
    css.indexOf('.maude[data-theme="dark"] {'),
    css.indexOf('@media (prefers-color-scheme: dark)')
  );
  const light = css.slice(
    css.indexOf('.maude[data-theme="light"] {'),
    css.indexOf('.maude[data-theme="dark"] {')
  );
  test('dark: >= 4.5:1 on --bg-1, --bg-2 and --bg-3', () => {
    for (const bg of ['bg-1', 'bg-2', 'bg-3']) {
      expect(ratio(tokenIn(dark, 'fg-2'), tokenIn(dark, bg))).toBeGreaterThanOrEqual(4.5);
    }
  });
  test('light: >= 4.5:1 on --bg-0..--bg-3', () => {
    for (const bg of ['bg-0', 'bg-1', 'bg-2', 'bg-3']) {
      expect(ratio(tokenIn(light, 'fg-2'), tokenIn(light, bg))).toBeGreaterThanOrEqual(4.5);
    }
  });
  // The whole shell stylesheet (test/_shell-css.ts), so the pin holds wherever a rule lives. These fg-3 uses are
  // decoration, off states and placeholders the v2 areas chose (the v1 chrome had none); a new one fails here.
  const KNOWN_FG3 = new Set([
    ':where(.maude) .k-sw--off i',
    '.sz-shape[data-k="print"]::after',
    '.sz-shape--custom',
    '.kf-chip[data-zero]',
    '.lp-newrow-folder',
    '.lp-live',
    '.lp-selector::placeholder',
    '.cv-head-aside',
    '.cv-menu-note',
    '.cv-foot',
    '.cmp-who.is-none',
    '.dsa-adv > summary > span',
    '.dsl-field em',
    '.sh-pm-status:is( [data-tone="ok"], [data-tone="warn"], [data-tone="error"], [data-tone="info"] )::before, .dg-word:is([data-tone], [data-state])::before',
    '.v2sh-mx-no',
    '.pon-row.is-skipped .pon-label',
    '.fi-sum-m--skip',
    '.sh-pal-item.is-dim .sh-pal-ltxt',
    '.so-mv svg',
    '.insp-crumb-ch',
    '.asset-absent-t strong::before',
    '.home-create-name',
    '.home-art--home > i:nth-child(2)',
    '.home-art--price > i:nth-child(1)',
    '.home-art--brand > i:nth-child(3)',
    '.si-door .btn.si-btn-off, .si-door .btn.si-btn-off:hover',
    '.tl-lab-b.is-off',
    '.tl-music-or',
    '.tl-flag.is-resolved',
  ]);
  test('the shell stylesheet never uses the disabled grade for text', () => {
    const uses = textUsesOfDisabledGrade(shellCss()).map((s) => s.replace(/\s+/g, ' '));
    expect(uses.filter((s) => !KNOWN_FG3.has(s))).toEqual([]);
  });
});

describe('the visual fixes are in the source', () => {
  test('segmented controls inherit the font (no UA 15px button face)', () => {
    const css = shellCss();
    const rule = css.slice(
      css.indexOf('.insp-cp-segbtn {'),
      css.indexOf('.insp-cp-segbtn:last-child')
    );
    expect(rule).toContain('font: inherit');
  });

  test('`.island--pad` has a rule', () => {
    expect(read('client/v2/shell/floating-panels.css')).toMatch(/\.island--pad\s*\{[^}]*padding:/);
  });

  test('the context menu is the popover plane: body face, token colours, no hard-coded mono / oklch', () => {
    const src = read('context-menu.tsx');
    const css = src.slice(src.indexOf('const MENU_CSS'), src.indexOf('`.trim();'));
    expect(css).toContain('--maude-chrome-font-body');
    expect(css).not.toContain('font-mono');
    expect(css).not.toMatch(/#c0392b;\s*\n\s*color: #fff/);
    const shell = shellCss();
    const block = shell.slice(shell.indexOf('.dc-context-menu {\n    --maude-chrome-bg-2'));
    expect(block.slice(0, 600)).not.toMatch(/oklch\(/);
  });

  test('the artboard name is out of flow above the frame, counter-scaled to a constant size', () => {
    const src = read('canvas-lib.tsx');
    const rule = src.slice(
      src.indexOf('.dc-canvas .dc-artboard.dc-positioned > .dc-artboard-label {'),
      src.indexOf('.dc-canvas .dc-artboard.dc-positioned > .dc-artboard-label:focus-visible')
    );
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('bottom: 100%');
    expect(rule).toContain('scale(calc(1 / var(--dc-zoom');
    expect(rule).toContain('font-size: 11px');
    expect(rule).toContain('--maude-chrome-font-body');
    expect(rule).not.toContain('uppercase');
  });

  test('"Not now" is drawn plain (0,3,0 beats `.maude .btn--danger`)', () => {
    expect(read('client/v2/ai/needs-you.css')).toContain('.ai-nc-a .btn.ai-nc-decline {');
  });

  test('the product never says Claude in the editing banner; no "Ready · Claude Code" row', () => {
    const banner = read('ai-banner.tsx');
    expect(banner).toContain("'AI'");
    expect(read('client/v2/ai/Feed.jsx')).not.toContain('Claude Code</span>');
  });

  test('the composer and the canvas context menu carry an accessible name', () => {
    expect(read('client/v2/ai/Composer.jsx')).toContain('aria-label="Message to AI"');
    expect(read('context-menu.tsx')).toContain("'Artboard actions'");
  });
});
