// S8.5 — the boot wiring of the cloud export queue, against a real studio (no cloud door: the
// shipped desktop today). A cloud job this Mac followed before a restart is read back at boot and
// listed beside its own jobs, its file downloads by job id, and a video offers no cloud while there
// is no door (`render.cloud: false`). Nothing here reaches a real render service.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const JOB = 'i_s85bootcloudjob00001';
const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function Hype() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="S8.5">
        <DCArtboard id="reels" label="Reels" kind="video" width={1080} height={1920}>
          <div />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

let proc: Subprocess | undefined;
let base = '';

beforeAll(async () => {
  const sb = makeSandbox();
  mkdirSync(join(sb.designRoot, 'ui'), { recursive: true });
  writeFileSync(join(sb.designRoot, 'ui', 'video-hype.tsx'), CANVAS);
  const dir = join(sb.designRoot, '_state', 'export-cloud');
  mkdirSync(join(dir, JOB), { recursive: true });
  writeFileSync(join(dir, JOB, 'Hype.mp4'), new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
  writeFileSync(
    join(dir, `${JOB}.json`),
    JSON.stringify({
      v: 1,
      jobId: JOB,
      label: 'video-hype · MP4',
      format: 'mp4',
      spec: { v: 2, scope: 'selection', canvas: 'ui/video-hype.tsx', format: 'mp4' },
      createdAt: Date.now() - 60_000,
      acceptedAt: Date.now() - 50_000,
      phase: 'done',
      filename: 'Hype.mp4',
      finishedAt: Date.now() - 1000,
    })
  );
  const port = nextPort();
  proc = await bootServer(sb.root, port);
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  if (proc) await killProc(proc);
});

describe('S8.5 cloud exports at boot', () => {
  test('a cloud job followed before the restart is listed as In the cloud, and its file downloads', async () => {
    const r = await fetch(`${base}/_api/export-jobs`);
    expect(r.status).toBe(200);
    const { jobs } = (await r.json()) as { jobs: Array<Record<string, unknown>> };
    const row = jobs.find((j) => j.id === JOB);
    expect(row).toMatchObject({ status: 'done', runsOn: 'cloud', filename: 'Hype.mp4' });
    const dl = await fetch(`${base}/_api/export-jobs/download?id=${JOB}`);
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer()).byteLength).toBe(8);
  });

  test('no cloud door on this Mac: the estimate offers no cloud for a video', async () => {
    const r = await fetch(`${base}/_api/export-estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        spec: {
          v: 2,
          scope: 'selection',
          canvas: 'ui/video-hype.tsx',
          selection: { artboards: ['reels'] },
          format: 'mp4',
          options: { size: { scale: 2 } },
        },
      }),
    });
    expect(r.status).toBe(200);
    const est = (await r.json()) as { render?: { cloud: boolean } };
    expect(est.render).toEqual({ cloud: false, suggest: 'this-mac', why: null });
  });
});
