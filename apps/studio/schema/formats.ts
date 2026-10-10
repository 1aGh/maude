// schema/formats.ts — the formats Claude edits, and where each one's schema lives (contract
// V2-1.11 §5.2). One table: scripts/gen-actions.mjs writes it into actions.manifest.json `schemas`
// (and so into the §5.6 manifestVersion), writes the GENERATED schemas, and its `--check` fails when
// a committed one drifts; test/ai-parity-coverage.test.ts rule 5b holds every `file` action's format
// to a row here whose schema file exists; the `studio-actions` skill index reads it.
//
// Paths are relative to apps/studio/. Erasable TypeScript only (Node 24 strips it for gen-actions).

export interface FormatSchema {
  /** the FormatId an action's `agent.format` names (types.ts), or a runtime envelope */
  format: string;
  /** which files it covers, for the docs */
  files: string;
  /** the schema (or, for canvas-tsx, the convention doc), relative to apps/studio/ */
  schema: string;
  /** JSON Schema `$id` (absent for a convention doc) */
  id?: string;
  /** generated = written by gen-actions from `generator`; hand = the file is the source; doc = prose + lint rules */
  source: 'generated' | 'hand' | 'doc';
  /** for `generated`: the TS module whose export builds it */
  generator?: string;
  /** what `maude design check --strict` runs for an AI write */
  check: string;
  /** the skill section that teaches it */
  skill: string;
  /** read-only for the agent / runtime state, not a versioned project file */
  runtime?: boolean;
}

export const FORMAT_SCHEMAS: readonly FormatSchema[] = [
  {
    format: 'canvas-tsx',
    files: '<designRoot>/**/*.tsx (canvases, outside system/)',
    schema: 'schema/canvas-tsx.md',
    source: 'doc',
    check: 'parse; DCArtboard ids present + unique; V2-1.4 element ids vs the snapshot (checkIds)',
    skill: 'design:design#_guide-02',
  },
  {
    format: 'annotations',
    files: '<designRoot>/**/*.annotations.json',
    schema: 'schema/annotations.v2.schema.json',
    id: 'https://maude.sh/schema/annotations/v2',
    source: 'generated',
    generator: 'annotations/board-schema.ts#annotationsJsonSchema',
    check: 'validateBoard(text, {strict:true}) — the AiBatch rule applied to the file',
    skill: 'design:whiteboard',
  },
  {
    format: 'canvas-meta',
    files: '<designRoot>/**/*.meta.json',
    schema: 'schema/canvas-meta.v2.schema.json',
    id: 'https://maude.sh/schema/canvas-meta/v2',
    source: 'hand',
    check: 'the v2 schema on the keys the write changed; no viewport; dsRev unchanged',
    skill: 'design:design#_guide-17',
  },
  {
    format: 'edl',
    files: '<designRoot>/**/*.edl.json',
    schema: 'schema/edl.v1.schema.json',
    id: 'https://maude.sh/schema/edl/v1',
    source: 'hand',
    check: 'validateEdl (footage/schema.ts); the schema mirrors it',
    skill: 'design:footage-director',
  },
  {
    format: 'tokens',
    files: '<designRoot>/system/<ds>/tokens.json',
    schema: 'schema/ds-tokens-v1.schema.json',
    id: 'https://raw.githubusercontent.com/1aGh/maude/main/apps/studio/schema/ds-tokens-v1.schema.json',
    source: 'hand',
    check: 'ds-check <ds> structure, as warnings (V2-1.13)',
    skill: 'design:design-system',
  },
  {
    format: 'components',
    files: '<designRoot>/system/<ds>/components.json',
    schema: 'schema/ds-components-v1.schema.json',
    id: 'https://raw.githubusercontent.com/1aGh/maude/main/apps/studio/schema/ds-components-v1.schema.json',
    source: 'hand',
    check: 'ds-check <ds> structure, as warnings (V2-1.13)',
    skill: 'design:design-system',
  },
  {
    format: 'design-config',
    files: '.design/config.json',
    schema: 'config.schema.json',
    source: 'hand',
    check: 'parses (the schema is the doc; the studio lints it at boot)',
    skill: 'design:design',
  },
  {
    format: 'agent-handoff',
    files: '<designRoot>/_runs/<runId>/handoff/<agent>-<n>.{in,out}.json',
    schema: '../../cli/lib/handoff.schema.json',
    id: 'https://maude.sh/schema/agent-handoff/1',
    source: 'hand',
    check: 'validateHandoff (cli/lib/handoff.mjs) for the role the file name declares',
    skill: 'design:design#_guide-08',
    runtime: true,
  },
];

export const FORMAT_SCHEMA_BY_ID: ReadonlyMap<string, FormatSchema> = new Map(
  FORMAT_SCHEMAS.map((f) => [f.format, f])
);
