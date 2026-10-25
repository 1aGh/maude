import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { BASE } from './fx.mjs';
const CACHE = join(REPO, '.scr/fx-cache');

const EMPTY_VIDEO = `import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill } from "remotion";
const Comp = () => <AbsoluteFill style={{ background: "#101014" }} />;
export default function EmptyVideo() {
  return (
    <DesignCanvas>
      <DCSection id="v" title="Empty video">
        <DCArtboard id="reel" kind="video" label="Reel · 9:16" width={270} height={480}>
          <VideoComp component={Comp} durationInFrames={450} fps={30} width={270} height={480} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

export const TWO_SRC = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function Two() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Landing">
        <DCArtboard id="desktop" label="Desktop" kind="web" width={800} height={500}>
          <div style={{ padding: 40, background: "#fff", fontFamily: "system-ui", minHeight: 500 }}><h1>Desktop</h1></div>
        </DCArtboard>
        <DCArtboard id="mobile" label="Mobile" kind="web" width={390} height={500}>
          <div style={{ padding: 40, background: "#fff", fontFamily: "system-ui", minHeight: 500 }}><h1>Mobile</h1></div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** base fixture + an empty video canvas + an empty folder (2027) + a two-artboard canvas. */
export async function g1() {
  const d = join(CACHE, 'g1');
  rmSync(d, { recursive: true, force: true });
  cpSync(BASE, d, { recursive: true });
  mkdirSync(join(d, '.design/ui/2027'), { recursive: true });
  writeFileSync(join(d, '.design/ui/2027/.gitkeep'), '');
  writeFileSync(join(d, '.design/ui/EmptyVideo.tsx'), EMPTY_VIDEO);
  writeFileSync(join(d, '.design/ui/Two.tsx'), TWO_SRC);
  return d;
}
