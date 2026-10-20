// S10.15a fixture: an unconverted legacy system `fx` (a native alias `--accent-muted` for the v1
// `--accent-soft`) and five canvases on it, written into a scratch design root. Never this repo's
// `.design`.
//
//   ui/Good.tsx       a native alias + the `fx` wrapper → a codemod that must pass the gate
//   ui/Bad.tsx        the same codemod (tests plant a bug in its staged after/ copy)
//   ui/Plain.tsx      no native names, already `ds` → no codemod (a failure here is the system files')
//   ui/Left.tsx       left out at an older revision (`dsRev`) → V7, no codemod
//   ui/v2/Spec.tsx    a spec canvas → Q2, never codemodded
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { conformantFiles, fixtureConfig } from './_ds-fixture.ts';

export const FX = fixtureConfig();

export const artboard = (id: string, body: string) =>
  `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Fixture">
        <DCArtboard id="${id}" label="${id}" width={240} height={160}>
          ${body}
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const swatch = (bg: string, wrapper = 'fx') =>
  `<div className="${wrapper}" data-theme="light" style={{ width: 240, height: 160, background: "var(--bg-1)" }}>
            <div id="chip" data-cd-id="chip" style={{ margin: 20, width: 120, height: 80, background: "${bg}" }} />
          </div>`;

export const CANVASES: Record<string, string> = {
  'ui/Good.tsx': artboard('good', swatch('var(--accent-muted)')),
  'ui/Bad.tsx': artboard('bad', swatch('var(--accent-muted)')),
  'ui/Plain.tsx': artboard('plain', swatch('var(--accent)', 'ds')),
  'ui/Left.tsx': artboard('left', swatch('var(--accent-muted)')),
  'ui/v2/Spec.tsx': artboard('spec', swatch('var(--accent-muted)')),
};

/** The system's files: conformant, then `--accent-soft` renamed to its native alias. */
export function fxFiles(): Record<string, string> {
  const f = conformantFiles(FX);
  // the fixture's colours are deliberately bland (L 0.9 / C 0.01); the alias gets a vivid one so
  // a wrong rewrite shows on the canvas
  f[FX.tokensCssRel] = f[FX.tokensCssRel].replace(
    /(\n {2})--accent-soft: [^;]*;/g,
    '$1--accent-muted: oklch(0.6 0.15 250);'
  );
  return f;
}

export function fxConfigEntry() {
  return {
    name: FX.name,
    path: FX.path,
    tokensCssRel: FX.tokensCssRel,
    rootClass: FX.rootClass,
    themes: FX.themes,
    themeDefault: FX.themeDefault,
  };
}

/** Write fx + its canvases into `designRoot` through `write` (a project's own writer, or disk). */
export function writeFx(
  write: (rel: string, text: string) => void | Promise<void>,
  o: { canvases?: boolean } = {}
): Promise<void> {
  return (async () => {
    for (const [rel, text] of Object.entries(fxFiles())) await write(rel, text);
    if (o.canvases === false) return;
    for (const [rel, text] of Object.entries(CANVASES)) {
      await write(rel, text);
      const meta: Record<string, unknown> = { title: rel, designSystem: FX.name };
      if (rel === 'ui/Left.tsx') meta.dsRev = 'a'.repeat(64);
      await write(rel.replace(/\.tsx$/, '.meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    }
  })();
}

/** A bare scratch project (no home) with fx as its only system. */
export async function fxProject(root: string): Promise<string> {
  const designRoot = join(root, '.design');
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(designRoot, rel)), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  };
  put(
    'config.json',
    `${JSON.stringify({ designSystems: [fxConfigEntry()], defaultDesignSystem: FX.name }, null, 2)}\n`
  );
  await writeFx(put);
  return designRoot;
}
