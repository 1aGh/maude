/**
 * WebdriverIO config for the cross-project paste lane (#122 122-C, contract
 * 122-cross-canvas-clipboard.md §5.6): two project tabs, copy an artboard in one, ⌘V in the other, the
 * shell's own toast, Paste — the artboard lands with the import it reads and its picture.
 * Run: `pnpm test:e2e:desktop:clip` (one-time `pnpm test:e2e:desktop:build` first).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A 1×1 PNG and its content-addressed name (sha256 → first 8 hex), as the Assets writer names it. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const CARD = `export function Card({ title }: { title: string }) {
  return <div style={{ padding: 24, border: '1px solid #ccc' }}>{title}</div>;
}
`;

function project(name: string, canvas: string, body: string, picture?: string): string {
  const root = mkdtempSync(join(tmpdir(), `maude-e2e-clip-${name}-`));
  const d = join(root, '.design');
  mkdirSync(join(d, 'ui'), { recursive: true });
  mkdirSync(join(d, 'components'), { recursive: true });
  mkdirSync(join(d, 'system'), { recursive: true });
  writeFileSync(
    join(d, 'config.json'),
    JSON.stringify({ name, designRoot: '.design', formatVersion: 2, designSystems: [] }, null, 2)
  );
  writeFileSync(join(d, 'components', 'Card.tsx'), CARD);
  writeFileSync(join(d, 'ui', `${canvas}.tsx`), body);
  if (picture) {
    mkdirSync(join(d, 'assets'), { recursive: true });
    writeFileSync(join(d, 'assets', picture), Buffer.from(PNG_B64, 'base64'));
  }
  return root;
}

const SHA8 = createHash('sha256').update(Buffer.from(PNG_B64, 'base64')).digest('hex').slice(0, 8);
const PICTURE = `${SHA8}.png`;

const SOURCE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
import { Card } from '../components/Card';
const W = 640;
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" label="Hero" width={W} height={400}>
        <div style={{ padding: 32 }}>
          <Card title="Carried across" />
          <img src="assets/${PICTURE}" width={40} height={40} alt="" />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const TARGET = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function About() {
  return (
    <DesignCanvas>
      <DCArtboard id="about" label="About" width={640} height={400}>
        <p style={{ padding: 32 }}>About</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

process.env.MAUDE_PROJECT_ROOT ??= project('clip-source', 'Home', SOURCE, PICTURE);
process.env.MAUDE_E2E_SECONDARY_ROOT ??= project('clip-target', 'About', TARGET);

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/clip', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'clipboard-cross-project.e2e.ts')],
  // two cold sidecars
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
