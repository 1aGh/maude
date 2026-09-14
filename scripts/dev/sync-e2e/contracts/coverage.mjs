// Executable direct-writer-to-schema selectors. These mappings assert a
// strict representative shape exists; they do NOT assert the writer migrated.
export const WRITER_VARIANT_BINDINGS = [
  {
    registryId: 'S26',
    source: 'apps/studio/footage-store.ts',
    entry: 'saveAnalysis',
    selectors: [{ kind: 'footage.assign', property: 'analysis' }],
  },
  {
    registryId: 'S26',
    source: 'apps/studio/footage-store.ts',
    entry: 'saveEdl',
    selectors: [{ kind: 'edl.edit', verb: 'replace' }],
  },
  {
    registryId: 'S29',
    source: 'apps/studio/footage/schema.ts',
    entry: 'generatedClipAnalysis',
    selectors: [{ kind: 'footage.assign', property: 'analysis' }],
  },
  {
    registryId: 'S31',
    source: 'apps/studio/generation/prefs.ts',
    entry: 'writeTranscriptionProvider',
    selectors: [{ kind: 'config.assign', property: 'generation.transcription.provider' }],
  },
  {
    registryId: 'S31',
    source: 'apps/studio/generation/prefs.ts',
    entry: 'writeKeyframeEngine',
    selectors: [{ kind: 'config.assign', property: 'generation.keyframes.engine' }],
  },
  {
    registryId: 'I06',
    source: 'apps/studio/bin/_import-tokens.mjs',
    entry: 'upsertDesignSystemConfig',
    selectors: [
      { kind: 'config.assign', property: 'designSystems.upsert' },
      { kind: 'config.assign', property: 'defaultDesignSystem' },
    ],
  },
  {
    registryId: 'I06',
    source: 'apps/studio/bin/_import-tokens.mjs',
    entry: 'importTokens',
    selectors: [{ kind: 'manifest.replace' }, { kind: 'manifest.create', entryKind: 'file' }],
  },
  {
    registryId: 'I07',
    source: 'apps/studio/bin/_import-brand.mjs',
    entry: 'writeLogoAsset',
    selectors: [{ kind: 'manifest.create', entryKind: 'file' }],
  },
  {
    registryId: 'I12',
    source: 'apps/studio/scaffold-design.ts',
    entry: 'scaffoldDesign',
    selectors: [
      { kind: 'config.assign', property: 'name' },
      { kind: 'config.assign', property: 'completenessProfile' },
    ],
  },
  {
    registryId: 'X11',
    source: 'apps/studio/sync/file-plane.ts',
    entry: 'push',
    selectors: [{ kind: 'manifest.replace' }, { kind: 'manifest.create', entryKind: 'file' }],
  },
  {
    registryId: 'H03',
    source: 'apps/hub/src/file-door.mjs',
    entry: 'handleFileDoor',
    selectors: [
      { kind: 'manifest.replace' },
      { kind: 'manifest.create', entryKind: 'file' },
      { kind: 'manifest.delete' },
    ],
  },
];
export const RESIDUAL_VARIANTS = [
  {
    family: 'config.assign',
    missing: [
      'canvasGroups and classifier-affecting paths require separate managed-project policy',
      'remaining public configuration fields and linked/local split migration',
    ],
  },
  {
    family: 'manifest.replace',
    missing: [
      'authoritative path class/owner permissions',
      'runtime/config/canvas-owned bypass prohibition',
      'server-derived module dependency validation',
    ],
  },
  {
    family: 'footage.assign',
    missing: [
      'server resolves source identity/hash/path and checks real duration',
      'concurrent property/shot effects and inverse implementation',
    ],
  },
  {
    family: 'edl.edit',
    missing: [
      'stable beat/track identity migration and granular effects',
      'source-duration/readiness checks, timebase/codegen fidelity',
      'group EDL and generated TSX in one accepted action',
    ],
  },
  { family: 'layout.assign', missing: ['guides/print/hug/kind/style and all current controls'] },
  { family: 'photo.assign', missing: ['complete current adjustments and range parity'] },
  { family: 'annotation.update', missing: ['full stroke vocabulary and effect granularity'] },
  {
    family: 'history.undo',
    missing: ['server-derived inverses with per-effect authorship and retained read conditions'],
  },
];
