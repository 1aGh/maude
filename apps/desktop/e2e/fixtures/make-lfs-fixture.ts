/**
 * A throwaway project whose canvas shows two Git LFS placeholders (2.0.3, the `lfs` lane).
 *
 * The project was "cloned without `git lfs pull`": `.design/assets/pic.png` and `.design/assets/clip.mp4` are
 * pointer files (`version https://git-lfs.github.com/spec/v1` / `oid sha256:` / `size`), committed once. The real
 * bytes of pic.png ARE in the repo's own object store (`.git/lfs/objects/<oid[0:2]>/<oid[2:4]>/<oid>`), so the
 * studio answers it `{ state: 'lfs-pointer', localObject: true }`; clip.mp4's are not (no object, no remote).
 *
 * Offline by construction: no remote is configured (see make-git-fixture.ts: a remote URL makes the studio's
 * ahead/behind probe fetch during boot). Also used by the prompt check outside the app — a SEPARATE copy is made
 * there, so this function only ever writes inside the directory it is given.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));

export const LFS_CANVAS = 'ui/Lfs.tsx';
export const LFS_SPEC = 'version https://git-lfs.github.com/spec/v1';

const CANVAS = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Lfs() {
  return (
    <DesignCanvas>
      <DCArtboard id="lfs" label="LFS/01 · PLACEHOLDERS" width={880} height={420}>
        <div data-cd-id="lfs-title" style={{ position: "absolute", left: "24px", top: "16px", font: "600 18px system-ui" }}>
          Cloned without git lfs pull
        </div>
        <img data-cd-id="lfs-pic" src="assets/pic.png" alt="Picture" style={{ position: "absolute", left: "24px", top: "64px", width: 400, height: 320 }} />
        <video data-cd-id="lfs-clip" src="assets/clip.mp4" muted style={{ position: "absolute", left: "456px", top: "64px", width: 400, height: 320 }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

// ── a small, real PNG (deterministic) ───────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A 64 x 64 RGB gradient PNG — a few KB, so it can never pass for a pointer (≤ 1 KB). */
export function gradientPng(w = 64, h = 64): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = (x * 4) & 0xff;
      raw[i + 1] = (y * 4) & 0xff;
      raw[i + 2] = ((x * y) ^ 0x5a) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface LfsObject {
  /** project-relative path of the pointer */
  path: string;
  oid: string;
  size: number;
  /** the pointer text written at `path` */
  pointer: string;
  /** the real object exists under .git/lfs/objects */
  local: boolean;
}
export interface LfsFixture {
  root: string;
  pic: LfsObject;
  clip: LfsObject;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const pointerOf = (oid: string, size: number) => `${LFS_SPEC}\noid sha256:${oid}\nsize ${size}\n`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Maude E2E',
      GIT_AUTHOR_EMAIL: 'e2e@maude.local',
      GIT_COMMITTER_NAME: 'Maude E2E',
      GIT_COMMITTER_EMAIL: 'e2e@maude.local',
    },
  }).trim();
}

/** Build the project in `root` (a fresh `maude-e2e-lfs-*` temp dir when absent) and say what it holds. */
export function makeLfsFixture(root = mkdtempSync(join(tmpdir(), 'maude-e2e-lfs-'))): LfsFixture {
  const design = join(root, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  mkdirSync(join(design, 'assets'), { recursive: true });
  // the base fixture's config + its runtime-state ignore (`_*`); one canvas of our own
  cpSync(join(HERE, 'project', '.design', 'config.json'), join(design, 'config.json'));
  cpSync(join(HERE, 'project', '.design', '.gitignore'), join(design, '.gitignore'));
  writeFileSync(join(design, LFS_CANVAS), CANVAS);
  // How an LFS repo marks its media (what a real clone carries).
  writeFileSync(
    join(root, '.gitattributes'),
    '*.png filter=lfs diff=lfs merge=lfs -text\n*.mp4 filter=lfs diff=lfs merge=lfs -text\n'
  );

  const png = gradientPng();
  // Not a playable clip — it never reaches the canvas; only its oid/size are named.
  const clipBytes = Buffer.concat([Buffer.from('maude-e2e-lfs-clip\n'), Buffer.alloc(4096, 7)]);
  const pic: LfsObject = {
    path: '.design/assets/pic.png',
    oid: sha256(png),
    size: png.length,
    pointer: pointerOf(sha256(png), png.length),
    local: true,
  };
  const clip: LfsObject = {
    path: '.design/assets/clip.mp4',
    oid: sha256(clipBytes),
    size: clipBytes.length,
    pointer: pointerOf(sha256(clipBytes), clipBytes.length),
    local: false,
  };
  writeFileSync(join(root, pic.path), pic.pointer);
  writeFileSync(join(root, clip.path), clip.pointer);

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(
    root,
    'commit',
    '-q',
    '-m',
    'fixture: a design project with Git LFS media (cloned without lfs pull)'
  );
  // pic.png's real bytes are already in this repo's object store; clip.mp4's are not.
  const obj = join(root, '.git', 'lfs', 'objects', pic.oid.slice(0, 2), pic.oid.slice(2, 4));
  mkdirSync(obj, { recursive: true });
  writeFileSync(join(obj, pic.oid), png);
  return { root, pic, clip };
}
