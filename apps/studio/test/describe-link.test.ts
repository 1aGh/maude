// S3.10a — the TSX describe lane words a link change (lead decision v2-lead-link-changes-in-tsx-lane):
// "Link to <target> added / changed / removed on <element>". Every other data-cd-* stays silent.

import { describe, expect, test } from 'bun:test';
import { describeChanges } from '../history/describe';

const SRC = (attrs: string) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <h1>Homepage</h1>
        <button data-cd-id="see-pricing"${attrs}>See pricing</button>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const words = (a: string, b: string) =>
  describeChanges('ui/Home.tsx', { tsx: SRC(a) }, { tsx: SRC(b) }).changes.map((c) => c.words);

describe('link lines', () => {
  test('added, changed, removed', () => {
    const add = words('', ' data-cd-link="site/pricing.tsx#desktop"');
    expect(add).toHaveLength(1);
    expect(add[0]).toMatch(/^Link to Pricing › desktop added on .*See pricing/);
    const changed = words(' data-cd-link="#desktop"', ' data-cd-link="https://cal.com/studio"');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/^Link to cal\.com\/studio changed on /);
    const removed = words(' data-cd-link="#desktop"', '');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^Link to artboard .desktop. removed on /);
  });

  test('an unchanged link says nothing; a lock change still says nothing', () => {
    expect(words(' data-cd-link="#desktop"', ' data-cd-link="#desktop" data-cd-locked')).toEqual(
      []
    );
  });
});
