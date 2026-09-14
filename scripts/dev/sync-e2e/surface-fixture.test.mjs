import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { seedStructuralFixture } from './surface-fixture.mjs';

test('all three move directions have independent initial sources and empty destinations', () => {
  const work = mkdtempSync(join(tmpdir(), 'maude-structural-fixture-'));
  try {
    const roots = ['hub', 'native', 'peer'].map((name) => join(work, name));
    seedStructuralFixture(roots);
    for (const origin of ['hub', 'native', 'peer']) {
      const relative = `.design/ui/SurfaceMove-${origin}.tsx`;
      const expected = readFileSync(join(roots[0], relative), 'utf8');
      assert.match(expected, new RegExp(`<h1>SurfaceMove-${origin}</h1>`));
      assert.match(expected, /DCArtboard id="brief"/);
      for (const root of roots) {
        assert.equal(readFileSync(join(root, relative), 'utf8'), expected);
        assert.deepEqual(
          JSON.parse(readFileSync(join(root, `.design/ui/SurfaceMove-${origin}.meta.json`))),
          { title: `SurfaceMove-${origin}`, kind: 'web' }
        );
        const destination = join(root, `.design/ui/CanvasDestination-${origin}`);
        assert.deepEqual(readdirSync(destination), ['.gitkeep']);
        assert.equal(readFileSync(join(destination, '.gitkeep')).length, 0);
        // The move fixture cannot accidentally satisfy either create contract.
        assert.equal(existsSync(join(root, `.design/ui/Surface-${origin}`)), false);
        assert.equal(existsSync(join(root, `.design/ui/SurfaceBoard-${origin}.tsx`)), false);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
