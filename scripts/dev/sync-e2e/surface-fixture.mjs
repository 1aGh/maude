import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePng } from './harness.mjs';

// Prepared before any participant boots. Canvas moves must not depend on a
// successful empty-folder/create test, nor seed the new-canvas test's subject.
export function seedStructuralFixture(roots) {
  for (const root of roots) {
    for (const origin of ['hub', 'native', 'peer']) {
      const destination = join(root, `.design/ui/CanvasDestination-${origin}`);
      mkdirSync(destination, { recursive: true });
      writeFileSync(join(destination, '.gitkeep'), '');
      const name = `SurfaceMove-${origin}`;
      writeFileSync(
        join(root, `.design/ui/${name}.tsx`),
        `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function SurfaceMove() {
  return <DesignCanvas><DCArtboard id="brief" label="${name}" width={600} height={400}>
    <h1>${name}</h1>
  </DCArtboard></DesignCanvas>;
}
`
      );
      writeFileSync(
        join(root, `.design/ui/${name}.meta.json`),
        JSON.stringify({ title: name, kind: 'web' })
      );
    }
  }
}

// Only the hub receives the blobs. Peers must download and decode them.
export function seedMediaFixture(hubRoot, peerRoots, uploadDir) {
  seedStructuralFixture([hubRoot, ...peerRoots]);
  const assets = join(hubRoot, '.design/assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, 'surface-pattern.png'), makePng(3));
  const video = join(assets, 'surface-colors.mp4');
  const result = spawnSync(
    'ffmpeg',
    [
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x90:r=10:d=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x90:r=10:d=1',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0[out]',
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      video,
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0)
    throw new Error(`Media fixture ffmpeg failed: ${result.stderr || result.error}`);
  const source = `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function SurfaceMedia() {
  return <DesignCanvas><DCArtboard id="surface-media" label="Media baseline" width={600} height={400}>
    <main style={{padding: 24}}>
      <h1>Surface media baseline</h1>
      <img data-testid="surface-photo" src="assets/surface-pattern.png" width={64} height={64} alt="Known 8 by 8 pixel pattern" />
      <video data-testid="surface-video" src="assets/surface-colors.mp4" width={160} height={90} controls muted playsInline preload="auto" />
    </main>
  </DCArtboard></DesignCanvas>;
}
`;
  for (const root of [hubRoot, ...peerRoots]) {
    writeFileSync(join(root, '.design/ui/SurfaceMedia.tsx'), source);
    writeFileSync(
      join(root, '.design/ui/SurfaceText.tsx'),
      source.replace('Surface media baseline', 'Surface text baseline')
    );
    writeFileSync(
      join(root, '.design/ui/SurfaceText.meta.json'),
      JSON.stringify({ title: 'Surface text', kind: 'web' })
    );
    writeFileSync(
      join(root, '.design/ui/SurfaceMedia.meta.json'),
      JSON.stringify({ title: 'Surface media', kind: 'web' })
    );
    // Independent delete fixtures keep a failed move from masking delete behavior.
    for (const origin of ['hub', 'native', 'peer']) {
      for (const kind of ['EmptyMove', 'EmptyDestination', 'EmptyDelete']) {
        const folder = join(root, `.design/ui/${kind}-${origin}`);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, '.gitkeep'), '');
      }
      for (const tool of ['pen', 'highlighter', 'arrow', 'text', 'section', 'eraser', 'video']) {
        const drawing = `SurfaceDrawing-${tool}-${origin}`;
        writeFileSync(
          join(root, `.design/ui/${drawing}.tsx`),
          source
            .replace('Surface media baseline', 'Surface drawing baseline')
            .replace(/ {6}<(?:img|video) [^\n]+\n/g, '')
        );
        writeFileSync(
          join(root, `.design/ui/${drawing}.meta.json`),
          JSON.stringify({ title: drawing, kind: 'web' })
        );
      }
      const upload = `SurfaceUpload-${origin}`;
      const shapes = `SurfaceShapes-${origin}`;
      writeFileSync(
        join(root, `.design/ui/${shapes}.tsx`),
        source
          .replace('Surface media baseline', 'Surface shapes baseline')
          .replace(/ {6}<(?:img|video) [^\n]+\n/g, '')
      );
      writeFileSync(
        join(root, `.design/ui/${shapes}.meta.json`),
        JSON.stringify({ title: shapes, kind: 'web' })
      );
      writeFileSync(
        join(root, `.design/ui/${upload}.tsx`),
        source
          .replace('Surface media baseline', 'Surface upload baseline')
          .replace(/ {6}<(?:img|video) [^\n]+\n/g, '')
      );
      writeFileSync(
        join(root, `.design/ui/${upload}.meta.json`),
        JSON.stringify({ title: upload, kind: 'web' })
      );
      const notes = `SurfaceNotes-${origin}`;
      writeFileSync(join(root, `.design/ui/${notes}.tsx`), source);
      writeFileSync(
        join(root, `.design/ui/${notes}.meta.json`),
        JSON.stringify({ title: notes, kind: 'web' })
      );
      const name = `SurfaceDelete-${origin}`;
      writeFileSync(
        join(root, `.design/ui/${name}.tsx`),
        source.replace('Surface media baseline', name)
      );
      writeFileSync(
        join(root, `.design/ui/${name}.meta.json`),
        JSON.stringify({ title: name, kind: 'web' })
      );
    }
  }
  const media = Object.fromEntries(
    ['surface-pattern.png', 'surface-colors.mp4'].map((name) => [
      name,
      {
        sha256: createHash('sha256')
          .update(readFileSync(join(assets, name)))
          .digest('hex'),
        bytes: readFileSync(join(assets, name)).length,
      },
    ])
  );
  if (uploadDir) {
    mkdirSync(uploadDir, { recursive: true });
    media.videoUploads = Object.fromEntries(
      ['hub', 'native', 'peer'].map((origin) => {
        const path = join(uploadDir, `upload-${origin}.mp4`);
        // Distinct content hashes keep later directions cold. Remux metadata only;
        // the same red/blue frames and codec remain the decoding oracle.
        const remux = spawnSync(
          'ffmpeg',
          [
            '-nostdin',
            '-loglevel',
            'error',
            '-y',
            '-i',
            video,
            '-codec',
            'copy',
            '-metadata',
            `comment=surface-${origin}`,
            '-movflags',
            '+faststart',
            path,
          ],
          { encoding: 'utf8' }
        );
        if (remux.status !== 0)
          throw new Error(`Video input remux failed: ${remux.stderr || remux.error}`);
        return [
          origin,
          { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') },
        ];
      })
    );
    media.uploads = Object.fromEntries(
      ['hub', 'native', 'peer'].map((origin, i) => {
        const seed = 11 + i;
        const content = makePng(seed);
        const path = join(uploadDir, `from-${origin}.png`);
        writeFileSync(path, content);
        return [
          origin,
          {
            path,
            sha256: createHash('sha256').update(content).digest('hex'),
            pixel: [(seed * 37) & 255, (seed * 53) & 255, (seed * 7) & 255, 255],
          },
        ];
      })
    );
  }
  return media;
}
