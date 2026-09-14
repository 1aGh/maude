import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { WRITER_VARIANT_BINDINGS } from './coverage.mjs';
import { operationFixtures, proposal } from './fixtures.mjs';
import { sidecarFixtures } from './sidecar-fixtures.mjs';
import {
  KEYFRAME_ENGINES,
  TRANSCRIPTION_PROVIDERS,
  TRANSITION_PRESENTATIONS,
} from './sidecar-schemas.mjs';
import { createContractValidator } from './validate.mjs';

const repo = process.env.CONTRACT_REPO_ROOT ?? process.cwd();
const require = createRequire(`${repo}/package.json`);
const validator = createContractValidator(require('ajv/dist/2020.js').default);
const check = (kind, value) => validator.validate(kind, JSON.stringify(value));
const mutate = (value, fn) => {
  const c = structuredClone(value);
  fn(c);
  return c;
};
const footage = sidecarFixtures.find((f) => f.kind === 'footage.assign');
const edl = sidecarFixtures.find((f) => f.kind === 'edl.edit');

test('every direct writer binding resolves a current source symbol and valid strict fixture', async () => {
  for (const binding of WRITER_VARIANT_BINDINGS) {
    const body = await readFile(`${repo}/${binding.source}`, 'utf8');
    assert.ok(new RegExp(`\\b${binding.entry}\\s*\\(`).test(body), binding.entry);
    for (const selector of binding.selectors) {
      const fixtures = operationFixtures.filter((op) =>
        Object.entries(selector).every(([key, value]) => op[key] === value)
      );
      assert.ok(fixtures.length, JSON.stringify(selector));
      for (const fixture of fixtures) assert.equal(check('proposal', proposal(fixture)).ok, true);
    }
  }
});
test('concrete footage and EDL sidecar values also pass current production structural validators', async () => {
  // Node's built-in type stripping; dependency-free source contains no runtime side effects.
  const current = await import(pathToFileURL(`${repo}/apps/studio/footage/schema.ts`).href);
  assert.deepEqual(TRANSITION_PRESENTATIONS, [...current.TRANSITION_PRESENTATIONS]);
  for (const fixture of sidecarFixtures) {
    if (fixture.kind === 'footage.assign')
      assert.equal(current.validateFootageAnalysis(fixture.value).ok, true);
    if (fixture.kind === 'edl.edit') assert.equal(current.validateEdl(fixture.value).ok, true);
  }
});
test('configuration enums map to current concrete writers', async () => {
  const prefs = await readFile(`${repo}/apps/studio/generation/prefs.ts`, 'utf8');
  for (const value of [...TRANSCRIPTION_PROVIDERS, ...KEYFRAME_ENGINES])
    assert.ok(prefs.includes(`'${value}'`));
  const config = JSON.parse(await readFile(`${repo}/apps/studio/config.schema.json`, 'utf8'));
  assert.deepEqual(config.properties.completenessProfile.enum, ['minimal', 'standard', 'strict']);
  const upsert = sidecarFixtures.find(
    (f) => f.kind === 'config.assign' && f.property === 'designSystems.upsert'
  );
  for (const key of Object.keys(upsert.value))
    assert.ok(Object.hasOwn(config.properties.designSystems.items.properties, key));
});
test('footage requires valid intervals, matching source and bounded vocabulary', () => {
  assert.equal(
    check(
      'operation',
      mutate(footage, (f) => {
        f.value.shots[0].end = 0;
      })
    ).code,
    'footage-shot-range'
  );
  assert.equal(
    check(
      'operation',
      mutate(footage, (f) => {
        f.value.shots[0].end = 11;
      })
    ).code,
    'footage-shot-duration'
  );
  assert.equal(
    check(
      'operation',
      mutate(footage, (f) => {
        f.value.asset = 'assets/bbbbbbbb.mp4';
      })
    ).code,
    'footage-asset-mismatch'
  );
  assert.equal(
    check(
      'operation',
      mutate(footage, (f) => {
        f.value.shots[0].quality = 2;
      })
    ).ok,
    false
  );
  assert.equal(
    check(
      'operation',
      mutate(footage, (f) => {
        f.value.shots[0].secret = true;
      })
    ).ok,
    false
  );
  assert.equal(
    check(
      'operation',
      mutate(footage, (f) => {
        f.value.tags = ['x'.repeat(121)];
      })
    ).ok,
    false
  );
});
test('EDL requires all concrete asset paths bound to stable identities without duplicate ambiguity', () => {
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.assets = [];
      })
    ).code,
    'unbound-edl-asset'
  );
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.assets.push({ ...e.assets[0], documentId: 'other' });
      })
    ).code,
    'duplicate-edl-asset-binding'
  );
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.value.audioTracks[0].asset = 'https://example.com/a.mp3';
      })
    ).ok,
    false
  );
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.value.beats[1].name = e.value.beats[0].name;
      })
    ).code,
    'duplicate-edl-beat-name'
  );
});
test('EDL transition, captions and audio ranges fail before mutation', () => {
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.value.beats[1].transition.frames = 100;
      })
    ).code,
    'edl-transition-duration'
  );
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.value.beats[0].transition = { presentation: 'fade', frames: 10 };
      })
    ).code,
    'edl-first-transition'
  );
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.value.beats[1].transition.presentation = 'none';
      })
    ).code,
    'edl-hard-cut-overlap'
  );
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.value.captions.cues[0].endSec = 0;
      })
    ).code,
    'edl-caption-range'
  );
  assert.equal(
    check(
      'operation',
      mutate(edl, (e) => {
        e.value.audioTracks[0].fadeInFrames = 1000;
      })
    ).code,
    'edl-audio-fade-range'
  );
});
test('all actual timeline presentation names work and old mistaken review aliases fail', () => {
  const transition = operationFixtures.find(
    (f) => f.kind === 'timeline.edit' && f.verb === 'transition'
  );
  for (const presentation of TRANSITION_PRESENTATIONS)
    assert.equal(check('operation', { ...transition, presentation }).ok, true, presentation);
  for (const presentation of ['clockWipe', 'iris'])
    assert.equal(check('operation', { ...transition, presentation }).ok, false);
});
test('config allows specific public fields but rejects trust/credentials/whole-file payloads', () => {
  const config = sidecarFixtures.find((f) => f.kind === 'config.assign');
  for (const property of [
    'linkedHub',
    'token',
    'role',
    'designRoot',
    'canvasGroups',
    'generation.apiKey',
  ])
    assert.equal(check('operation', { ...config, property }).ok, false);
  const upsert = sidecarFixtures.find(
    (f) => f.kind === 'config.assign' && f.property === 'designSystems.upsert'
  );
  assert.equal(
    check(
      'operation',
      mutate(upsert, (o) => {
        o.value.linkedHub = 'https://evil.example';
      })
    ).ok,
    false
  );
  assert.equal(
    check(
      'operation',
      mutate(upsert, (o) => {
        o.value.themeDefault = 'light';
        o.value.themes = ['dark'];
      })
    ).code,
    'design-system-default-theme'
  );
});
test('replacement requires a declared blob and exact proven prior hash, including empty support file', () => {
  const replace = sidecarFixtures.find((f) => f.kind === 'manifest.replace');
  assert.equal(
    check(
      'proposal',
      mutate(proposal(replace), (p) => {
        p.blobs = [];
      })
    ).code,
    'undeclared-payload'
  );
  assert.equal(
    check(
      'operation',
      mutate(replace, (o) => {
        delete o.baseHash;
      })
    ).ok,
    false
  );
  assert.equal(
    check(
      'operation',
      mutate(replace, (o) => {
        o.baseHash = null;
      })
    ).ok,
    false
  );
  assert.equal(
    check(
      'proposal',
      proposal(sidecarFixtures.find((f) => f.kind === 'manifest.replace' && f.content.size === 0))
    ).ok,
    true
  );
});
test('sidecar bytes and aggregate duration are bounded beyond individual schema fields', () => {
  const large = mutate(footage, (f) => {
    f.value.shots = Array.from({ length: 300 }, () => ({
      start: 0,
      end: 1,
      note: 'x'.repeat(1000),
    }));
  });
  assert.equal(check('operation', large).code, 'sidecar-byte-limit');
  const long = mutate(edl, (e) => {
    e.value.beats.forEach((b) => {
      b.durationFrames = 10368000;
      b.transition = null;
    });
  });
  assert.equal(check('operation', long).code, 'edl-total-frames');
});
