// S3.10a — the `maude design check` link rules (contract client/v2/contracts/S3-links-format.md §7, §10 row 5):
// `link-format` (error), `link-no-id` (error), `link-dangling` (warning, never a block); and `data-cd-link` is the
// one `data-cd-*` Claude may write — changing it is never `cd-attr-changed`.

import { describe, expect, test } from 'bun:test';
import { checkFile } from '../check/index.ts';
import { checkIds } from '../element-ids.ts';

const SRC = (button: string) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        ${button}
      </DCArtboard>
      <DCArtboard id="pricing" width={800} height={500}>
        <p>Plans</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const codes = (r: { findings: { code: string }[] }) => r.findings.map((f) => f.code);

describe('cdKey leaves data-cd-link out', () => {
  test('adding, changing or removing a link is not cd-attr-changed', () => {
    const before = SRC(
      '<button data-cd-id="cta" data-cd-locked-x="1" data-cd-link="#pricing">See pricing</button>'
    );
    for (const after of [
      SRC(
        '<button data-cd-id="cta" data-cd-locked-x="1" data-cd-link="#desktop">See pricing</button>'
      ),
      SRC('<button data-cd-id="cta" data-cd-locked-x="1">See pricing</button>'),
    ]) {
      expect(codes(checkIds(after, { against: before, path: 'ui/Home.tsx' }))).toEqual([]);
      expect(codes(checkIds(before, { against: after, path: 'ui/Home.tsx' }))).toEqual([]);
    }
  });
  test('any other data-cd-* change still is', () => {
    const before = SRC('<button data-cd-id="cta" data-cd-hidden="">See pricing</button>');
    const after = SRC('<button data-cd-id="cta" data-cd-hidden="flex">See pricing</button>');
    expect(codes(checkIds(after, { against: before, path: 'ui/Home.tsx' }))).toEqual([
      'cd-attr-changed',
    ]);
  });
});

describe('link-format · link-no-id', () => {
  test('an expression value or an invalid target is link-format (error)', () => {
    for (const attr of [
      'data-cd-link={to}',
      'data-cd-link="javascript:alert(1)"',
      'data-cd-link="pricing"',
    ]) {
      const r = checkFile(
        'ui/Home.tsx',
        SRC(`<button data-cd-id="cta" ${attr}>See pricing</button>`)
      );
      expect(r.errors.map((f) => f.code)).toEqual(['link-format']);
      expect(r.errors[0]?.what).toBe(
        'Button "See pricing" (line 6): data-cd-link must be "#<artboard>", "<canvas>.tsx#<artboard>" or "https://…".'
      );
      expect(r.ok).toBe(false);
    }
  });
  test('a link on an element without a literal data-cd-id is link-no-id (error)', () => {
    const r = checkFile('ui/Home.tsx', SRC('<button data-cd-link="#pricing">See pricing</button>'));
    expect(r.errors.map((f) => f.code)).toEqual(['link-no-id']);
    expect(r.errors[0]?.what).toBe(
      'Button "See pricing" (line 6) has a link but no data-cd-id — add one (lowercase words joined by -).'
    );
  });
  test('a valid link is clean', () => {
    for (const t of ['#pricing', 'https://cal.com/studio'])
      expect(
        checkFile('ui/Home.tsx', SRC(`<button data-cd-id="cta" data-cd-link="${t}">See</button>`))
          .errors
      ).toEqual([]);
  });
});

describe('link-dangling (warning)', () => {
  test('a same-canvas artboard that is not there', () => {
    const r = checkFile(
      'ui/Home.tsx',
      SRC('<button data-cd-id="cta" data-cd-link="#gone">See pricing</button>')
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.map((f) => f.code)).toEqual(['link-dangling']);
    expect(r.warnings[0]?.what).toBe(
      'Button "See pricing" (line 6) links to #gone, which isn\'t in the project.'
    );
  });
  test('another canvas, through the project resolver', () => {
    const project = (rel: string) => (rel === 'site/pricing.tsx' ? ['desktop', 'mobile'] : null);
    const at = (t: string) =>
      checkFile(
        'ui/Home.tsx',
        SRC(`<button data-cd-id="cta" data-cd-link="${t}">See pricing</button>`),
        {
          canvasArtboards: project,
        }
      ).warnings.map((f) => f.code);
    expect(at('site/pricing.tsx#desktop')).toEqual([]);
    expect(at('site/pricing.tsx')).toEqual([]);
    expect(at('site/pricing.tsx#tablet')).toEqual(['link-dangling']);
    expect(at('site/missing.tsx')).toEqual(['link-dangling']);
  });
  test('without a resolver another canvas is not judged; external targets never are', () => {
    const r = checkFile(
      'ui/Home.tsx',
      SRC('<button data-cd-id="cta" data-cd-link="site/missing.tsx">See pricing</button>')
    );
    expect(r.warnings).toEqual([]);
  });
});
