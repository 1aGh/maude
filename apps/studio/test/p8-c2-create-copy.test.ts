// p8-c2 create / onboarding / empty — the words and materials the 01, 02 and 05 critics listed that are
// model or CSS facts (CONTRACT §4: the app never names itself, the signed-in person is "You", the kit's
// field is a bg-3 well). Render-level states live in the area suites.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cloudRoleWord, ownerWord } from '../client/home/home-model.js';
import { INVITE_WORDS } from '../client/home/invite-flow.js';
import { SIGNIN_WORDS } from '../client/v2/signin/signin-model.js';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('02: words', () => {
  test('the code door says "Enter a code instead" (ob-signin-browser)', () => {
    expect(SIGNIN_WORDS.useCode).toBe('Enter a code instead');
  });
  test('the app does not name itself when the cloud is out of reach', () => {
    expect(SIGNIN_WORDS.unreachable).toContain('cloud.maude.sh');
    expect(SIGNIN_WORDS.unreachable).not.toContain('Maude Cloud');
    expect(INVITE_WORDS.unreachable).not.toContain('Maude Cloud');
  });
  test('your own project is "Yours · Owner", never "You\'s · Can edit"', () => {
    expect(ownerWord('You', 'owner')).toBe('Yours');
    expect(ownerWord('you', 'editor')).toBe('Yours');
    expect(ownerWord('Tereza', 'editor')).toBe("Tereza's");
    expect(ownerWord(null, 'editor')).toBeNull();
    expect(cloudRoleWord('owner')).toBe('Owner');
    expect(cloudRoleWord('editor')).toBe('Can edit');
  });
});

describe('02: material', () => {
  test('a sheet field is the bg-3 well on radius-md; the pressed segment has the accent ring', () => {
    const css = read('client/v2/onboarding/onboarding.css');
    expect(css).toMatch(/\.ob-input \{[^}]*var\(--bg-3\)[^}]*\}/);
    expect(css).toMatch(/\.ob-input \{[^}]*var\(--radius-md\)/);
    expect(rule(css, '.ob-seg-b[aria-pressed="true"]')).toContain('var(--accent)');
  });
  test('the offline line is warn text, not grey (ob-edge-offline)', () => {
    expect(rule(read('client/home/home.css'), '.home-ask-hint--off')).toContain(
      'var(--status-warn-text)'
    );
  });
  test('the ⌘K in the Advanced flyout foot is a Kbd chip', () => {
    expect(read('client/v2/signin/SignInCard.jsx')).toMatch(/<kbd className="kbd">⌘K<\/kbd>/);
  });
});

describe('05 / 01: empty and error blocks', () => {
  test('the Trash empty line is the kit block', () => {
    expect(read('client/v2/left-panel/trash-view.jsx')).toContain(
      'copyId="es-panels-make.trash-empty"'
    );
  });
  test('the Exports glyph points DOWN into the tray', () => {
    expect(read('client/v2/empty/empty.jsx')).toContain('M8 2.5V10M5.25 7.25L8 10l2.75-2.75');
  });
  test('an in-panel block is type-base over xs fg-2', () => {
    const css = read('client/v2/empty/empty.css');
    expect(rule(css, '.es-e--inpanel .es-sit')).toContain('var(--type-base)');
    expect(rule(css, '.es-e--inpanel .es-next')).toContain('var(--type-xs)');
  });
  test('the render-error card is 460 wide with a 36 px icon tile', () => {
    const css = read('client/v2/code/code.css');
    expect(rule(css, '.v2-err')).toContain('width: 460px');
    expect(rule(css, '.v2-err-ic')).toContain('width: 36px');
  });
  test('the held-render bar speaks English (no Czech debug string)', () => {
    const src = read('canvas-comment-mount.tsx');
    expect(src).not.toContain('držím');
    expect(src).toContain('Showing the last version that worked');
  });
});
