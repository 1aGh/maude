// Phase 8 C1-kit — the shell's primitives are the maude-v2 kit's (.design/system/maude-v2/preview/_components.css,
// .design/ui/v2/_kit.css), not local look-alikes. Text pins on the CSS: a computed-style pass needs a browser,
// and every one of these was a local rule that drifted from the kit (critic reports 06/07/08/09/10/11/12).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = (rel: string) => readFileSync(join(import.meta.dir, '..', 'client', rel), 'utf8');
/** The declaration block of the first rule whose selector list ends with `sel`. */
const rule = (src: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\n,}])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1] ?? '';
};
const KIT = css('styles/3-kit-maude-v2.css');
const RING = /inset 0 0 0 1px var\(--accent\)/;

describe('buttons are the kit button', () => {
  test('borderless, bg-3 rest, radius-md, semibold', () => {
    const r = rule(KIT, '.maude .btn');
    expect(r).toMatch(/border:\s*0/);
    expect(r).toMatch(/background:\s*var\(--bg-3\)/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(r).toMatch(/font-weight:\s*var\(--w-semibold\)/);
    expect(css('styles/4-components-maude.css')).not.toMatch(/\.maude \.btn\s*\{/);
  });
  test('a disabled primary is a muted bg-3 fill with fg-3 words, not an accent outline', () => {
    const r = rule(KIT, '.maude .btn--danger:disabled');
    expect(r).toMatch(/background:\s*var\(--bg-3\)/);
    expect(r).toMatch(/color:\s*var\(--fg-3\)/);
    expect(KIT).toMatch(/\.maude \.btn--primary:disabled,/);
  });
});

describe('every native select is the kit select', () => {
  test('appearance none + the kit caret, in @layer utilities so a surface background cannot drop it', () => {
    const at = KIT.indexOf('@layer utilities');
    expect(at).toBeGreaterThan(-1);
    const r = rule(KIT.slice(at), ':is(.maude, .maude-v2) select:not([multiple]):not([size])');
    expect(r).toMatch(/appearance:\s*none/);
    expect(r).toMatch(/background-image:\s*var\(--k-caret\)/);
    expect(r).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(KIT).toMatch(/--k-caret:\s*url\("data:image\/svg\+xml/);
  });
});

describe('one switch', () => {
  test('the four local switches have no rule of their own; the kit one uses --control-off', () => {
    for (const [file, cls] of [
      ['v2/left-panel/left-panel.css', '.lp-switch'],
      ['styles/3-shell-maude.css', '.st-switch'],
      ['styles/3-shell-maude.css', '.st-cp-switch'],
      ['v2/export/advanced/advanced.css', '.ex-switch'],
    ] as const) {
      expect(() => rule(css(file), cls)).toThrow();
    }
    const r = rule(
      KIT,
      ':where(.maude) :is(.switch, .lp-switch, .st-switch, .st-cp-switch, .ex-switch)'
    );
    expect(r).toMatch(/background:\s*var\(--control-off\)/);
    expect(r).toMatch(/width:\s*34px/);
    expect(r).toMatch(/height:\s*20px/);
  });
  test("an unchecked checkbox is edged --control-off (Export's was --border-strong, 2:1)", () => {
    expect(rule(css('v2/export/export.css'), '.ex-box')).toMatch(/var\(--control-off\)/);
  });
});

describe('a pressed segment carries the accent ring', () => {
  for (const [file, sel] of [
    ['v2/export/export.css', '.ex-seg-b[aria-checked="true"]'],
    ['v2/share/share.css', '.v2sh-seg-b[aria-pressed="true"]'],
    ['v2/history/history.css', '.vh-seg-b[aria-pressed="true"]'],
    ['v2/diagnostics/diagnostics.css', '.dg-seg-b[aria-pressed="true"]'],
    ['v2/left-panel/left-panel.css', '.lp-browse-size-b[aria-pressed="true"]'],
    ['styles/3-shell-maude.css', '.st-cp-segbtn[aria-checked="true"]'],
  ] as const) {
    test(`${file} ${sel}`, () => {
      const r = rule(css(file), sel);
      expect(r).toMatch(RING);
      expect(r).toMatch(/background:\s*var\(--bg-2\)/);
    });
  }
});

describe('sheets and dialogs are the kit dialog material (bg-2, radius-xl, the island edge)', () => {
  for (const [file, sel] of [
    ['v2/export/export.css', '.ex-sheet.island'],
    ['v2/settings/settings.css', '.v2s-sheet'],
    ['styles/3-shell-maude.css', '.cp-dialog'],
    ['v2/import/brand.css', '.bi-sheet'],
  ] as const) {
    test(`${file} ${sel}`, () => {
      const r = rule(css(file), sel);
      expect(r).toMatch(/background:\s*var\(--bg-2\)/);
      expect(r).toMatch(/border-radius:\s*var\(--radius-xl/);
      expect(r).toMatch(/inset 0 0 0 0\.5px var\(--island-edge\)/);
    });
  }
  test('the quit dialog has the kit padding (the shared .gi-dialog has none)', () => {
    expect(rule(css('v2/ai/quit.css'), '.ai-quit-dialog')).toMatch(/padding:\s*var\(--space-5\)/);
  });
});

describe('chips and status words', () => {
  test('a pressed filter chip is the soft chip, not a solid accent fill', () => {
    const r = rule(css('v2/left-panel/left-panel.css'), '.lp-chip[aria-pressed="true"]');
    expect(r).toMatch(/var\(--accent-muted\)/);
    expect(r).toMatch(/var\(--accent-text\)/);
  });
  test('a status word is a dot + the word in fg-1 (never a coloured word alone)', () => {
    const d = css('v2/diagnostics/diagnostics.css');
    expect(d).toMatch(
      /\.dg-word:is\(\[data-tone\], \[data-state\]\)::before\s*\{[^}]*width:\s*7px/
    );
    expect(d).not.toMatch(/\.dg-word\[data-tone="ok"\]\s*\{[^}]*color:/);
  });
});
