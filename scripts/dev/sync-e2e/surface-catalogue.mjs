// A source-backed, deliberately incomplete coverage inventory. Registry drift
// fails its test; an inventory entry is never itself an executed UI assertion.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIREMENT_COVERAGE,
  unresolvedRequirements,
  unsupportedRequirements,
} from './surface-requirements.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const cataloguePath = join(
  root,
  '.ai/scenarios/reliable-project-multiplayer/coverage-catalogue.json'
);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
function arrayBody(source, name) {
  const body = source.match(new RegExp(`\\bconst ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  if (!body) throw new Error(`Cannot enumerate ${name}; review the actual registry syntax`);
  return body;
}
function values(source, name, key) {
  const body = arrayBody(source, name);
  const re = key ? new RegExp(`\\b${key}:\\s*'([^']+)'`, 'g') : /'([^']+)'/g;
  const result = [...body.matchAll(re)].map((m) => m[1]);
  if (!result.length) throw new Error(`No values enumerated from ${name}`);
  return result;
}
export function buildSurfaceCatalogue() {
  const paths = [
    'apps/studio/tool-palette.tsx',
    'apps/studio/annotations-context-toolbar.tsx',
    'apps/studio/client/photo-knobs.jsx',
    '.ai/scenarios/reliable-project-multiplayer/local-e2e.md',
    'apps/studio/use-canvas-media-drop.tsx',
  ];
  const sources = Object.fromEntries(
    paths.map((path) => [path, readFileSync(join(root, path), 'utf8')])
  );
  const [palette, toolbar, photo, contract] = paths.map((p) => sources[p]);
  const cases = [];
  const add = (id, source, repairTask, detail) => cases.push({ id, source, repairTask, ...detail });
  const directions = ['hub-to-peers', 'native-to-peers', 'peer-to-peers'];
  const common = ['create', 'move', 'resize', 'delete', 'undo', 'redo'];
  // Actual file-drop handler accepts image/video files. These are explicit
  // format cases, not coverage of every MIME type accepted by the handler.
  for (const id of [
    'L12.upload-png.create',
    'L12.upload-png.remove-reference',
    'L14.upload-video.create',
    'L14.upload-video.play-and-seek',
    'L14.upload-video.remove-reference',
  ])
    add(id, paths[4], 'T18', { directions });
  const tools = values(palette, 'DRAW_TOOLS');
  const shapes = values(palette, 'SHAPE_KINDS', 'kind');
  for (const tool of tools) {
    if (tool === 'shape') {
      for (const shape of shapes)
        for (const action of common)
          add(`L09.shape-${shape}.${action}`, paths[0], 'T26', { directions });
    } else if (tool === 'eraser') {
      for (const action of ['erase-stroke', 'undo', 'redo'])
        add(`L09.eraser.${action}`, paths[0], 'T26', { directions });
    } else {
      for (const action of common) add(`L09.${tool}.${action}`, paths[0], 'T26', { directions });
      if (['sticky', 'section', 'text'].includes(tool))
        add(`L09.${tool}.edit-text`, paths[0], 'T26', { directions });
    }
  }
  for (const [name, prefix] of [
    ['HEAD_OPTIONS', 'arrow-head'],
    ['LINETYPE_OPTIONS', 'arrow-line'],
    ['ALIGN_OPTIONS', 'text-align'],
    ['ALIGN_ACTION_OPTIONS', 'selection-align'],
  ]) {
    for (const value of values(toolbar, name, 'value'))
      add(`L09.${prefix}.${value}`, paths[1], 'T26', { directions, requiresTargetExpansion: true });
  }
  for (const label of new Set([...toolbar.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])))
    add(`L09.context-control.${slug(label)}`, paths[1], 'T26', {
      label,
      directions,
      requiresTargetExpansion: true,
      note: 'Rendered control/group label; map each applicable stroke and actual mutation handler before claiming coverage.',
    });
  for (const adjustment of values(photo, 'ADJUSTMENTS', 'key'))
    add(`L13.photo.${adjustment}`, paths[2], 'T26', { directions });
  add('L13.photo.reset-adjustments', paths[2], 'T26', { directions });
  for (const [name, prefix] of [
    ['PATTERN_TYPES', 'pattern-type'],
    ['PATTERN_BLENDS', 'pattern-blend'],
    ['MASK_PRESETS', 'mask-preset'],
  ]) {
    for (const value of values(photo, name))
      add(`L13.${prefix}.${value}`, paths[2], 'T26', { directions });
  }
  for (const label of new Set([...photo.matchAll(/ariaLabel="([^"]+)"/g)].map((m) => m[1])))
    add(`L13.photo-control.${slug(label)}`, paths[2], 'T26', {
      label,
      directions,
      requiresTargetExpansion: true,
    });
  // Preserve each contract action as an explicit unresolved requirement. The
  // richer domains must still be expanded against their menus/handlers; they
  // cannot disappear because the first implemented lane only covers notes.
  const surfaces = [];
  for (const line of contract.split('\n').filter((line) => /^\| L\d\d \|/.test(line))) {
    const [, id, label, actions] = line.split('|').map((s) => s.trim());
    surfaces.push({ id, label });
    for (const action of actions.split(';').map((s) => s.trim())) {
      // THE EXPANSION (T1/T31). Every declared action now points at the exact
      // rows that assert it, or says why it points at nothing — see
      // `surface-requirements.mjs`. `requiresTargetExpansion` used to be true
      // for all of them unconditionally, which made a surface with one gap
      // indistinguishable from a surface with none.
      const answer = REQUIREMENT_COVERAGE[id]?.[action];
      const covers = Array.isArray(answer) ? answer : [];
      add(`${id}.requirement.${slug(action)}`, paths[3], 'T31', {
        action,
        directions,
        requiresTargetExpansion: covers.length === 0,
        covers,
        ...(Array.isArray(answer) ? {} : { unresolved: answer?.unresolved ?? 'not mapped' }),
      });
    }
  }
  if (surfaces.length !== 24) throw new Error('The full L01–L24 contract was not enumerated');
  const ids = cases.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate catalogue IDs');
  const unresolved = unresolvedRequirements();
  return {
    version: 1,
    // DERIVED, not declared. It was a hardcoded `false`, which is honest and
    // useless: it could never become true by doing the work, and it said
    // nothing about how much work was left.
    //
    // Complete means every declared action is ANSWERED — pointing at rows, or
    // recorded as a control the product does not have. The second kind is
    // `unsupported` with a reason, which is what the plan asks for by name;
    // counting it as incomplete would make this flag unclearable by any amount
    // of work, which is the failure the hardcoded `false` already was.
    catalogueComplete: unresolved.length === 0,
    unresolved,
    unsupported: unsupportedRequirements(),
    note: 'Source-enumerated annotations/photo controls plus the contract actions mapped to the rows that assert them. Actions that still point at nothing are listed in `unresolved`, each with its reason. No case is covered merely by being listed.',
    sources: paths.map((path) => ({
      path,
      sha256: createHash('sha256').update(sources[path]).digest('hex'),
    })),
    registries: { annotationTools: tools, shapeKinds: shapes },
    surfaces,
    cases,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalogue = buildSurfaceCatalogue();
  if (process.argv.includes('--write'))
    writeFileSync(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(
    JSON.stringify({
      catalogueComplete: catalogue.catalogueComplete,
      unresolved: catalogue.unresolved.length,
      cases: catalogue.cases.length,
      surfaces: catalogue.surfaces.length,
    })
  );
}
