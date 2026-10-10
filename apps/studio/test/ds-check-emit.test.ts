// V2-2.15 (V2-1.6 §5.3, V2-1.13 §5.8 `--emit`): tokens.json is deterministic, schema-valid,
// keeps designer data, and the migrator's ds.tokens step writes the same bytes.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { emitTokensJson } from '../ds/emit.ts';
import { dsTokensEmitter } from '../ds/migrate-emitter.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { diskFs, loadSystem, systemConfigsFrom } from '../ds/system.ts';
import { defaultDsEmitter } from '../migrate/ds-registry.ts';
import { SCHEMA_DIR } from '../paths.ts';
import { conformantFiles, fixtureConfig, memFs } from './_ds-fixture.ts';

const req = createRequire(import.meta.url);
const Ajv2020 = req('ajv/dist/2020.js').default;
const idx = indexRegistry(loadRegistry());
const strict = (file: string) =>
  new Ajv2020({ allErrors: true, strict: true }).compile(
    JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'))
  );

describe('tokens.json emit', () => {
  const files = conformantFiles();
  const model = loadSystem(memFs(files), fixtureConfig());

  test('the same CSS gives the same bytes; sorted keys, 2-space, LF, one trailing newline', () => {
    const a = emitTokensJson(model, idx, null);
    const b = emitTokensJson(model, idx, null);
    expect(a).toBe(b);
    expect(a.endsWith('}\n')).toBe(true);
    expect(a).not.toContain('\r');
    expect(Object.keys(JSON.parse(a))).toEqual(Object.keys(JSON.parse(a)).sort());
  });

  test('the manifest validates against ds-tokens-v1.schema.json (strict Ajv)', () => {
    const v = strict('ds-tokens-v1.schema.json');
    expect(v(JSON.parse(emitTokensJson(model, idx, null)))).toBe(true);
  });

  test('labels, valueNames and locked survive a re-emit, matched by css', () => {
    const doc = JSON.parse(emitTokensJson(model, idx, null));
    const ext = doc.color.accent.$root.$extensions['sh.maude'];
    expect(ext.css).toBe('--accent');
    Object.assign(ext, { label: 'Akcent', valueNames: { light: 'Azure' }, locked: true });
    const again = JSON.parse(emitTokensJson(model, idx, JSON.stringify(doc)));
    expect(again.color.accent.$root.$extensions['sh.maude']).toMatchObject({
      label: 'Akcent',
      valueNames: { light: 'Azure' },
      locked: true,
    });
  });

  test('ds-components-v1.schema.json compiles strict; the fixture manifest validates', () => {
    const v = strict('ds-components-v1.schema.json');
    expect(v(JSON.parse(files['system/fx/components.json']))).toBe(true);
  });
});

describe('the migrator ds.tokens step runs (V2-2.14 seam)', () => {
  test('defaultDsEmitter() is the shipped emitter', () => {
    expect(defaultDsEmitter()).toBe(dsTokensEmitter);
  });

  test('its bytes equal ds-check --emit for this repo’s systems; converted systems refuse', () => {
    const designRoot = join(import.meta.dir, '../../../.design');
    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    const fs = diskFs(designRoot);
    const read = (rel: string) => {
      const t = fs.read(rel);
      return t === null ? null : new TextEncoder().encode(t);
    };
    for (const s of systemConfigsFrom(cfg)) {
      const r = dsTokensEmitter.emitTokens({
        designRoot,
        system: { name: s.name, path: s.path, tokensCssRel: s.tokensCssRel },
        read,
      });
      if (!('bytes' in r)) throw new Error(r.refused);
      expect(new TextDecoder().decode(r.bytes)).toBe(emitTokensJson(loadSystem(fs, s), idx));
    }
    const files = conformantFiles();
    files['system/fx/revisions/head.json'] = '{}';
    files['config.json'] = JSON.stringify({
      designSystems: [
        {
          name: 'fx',
          path: 'system/fx',
          rootClass: 'fx',
          themes: ['light', 'dark'],
          themeDefault: 'light',
        },
      ],
    });
    const m = memFs(files);
    const r = dsTokensEmitter.emitTokens({
      designRoot: '/x',
      system: { name: 'fx', path: 'system/fx', tokensCssRel: 'system/fx/colors_and_type.css' },
      read: (rel) => {
        const t = m.read(rel);
        return t === null ? null : new TextEncoder().encode(t);
      },
    });
    expect('refused' in r).toBe(true);
  });
});
