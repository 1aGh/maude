// `maude design export` (V2-2.8) — what the CLI actually POSTs to /_api/export.
//
// The new export dialog's "same export from a terminal" line shows four commands
// (inventory D, [ex-advanced]); each must work exactly as printed. These tests run the
// REAL CLI against a throwaway HTTP server that records the request body, so they pin the
// wire shape the exporters see — not the CLI's internals:
//
//   - numeric --option values arrive as numbers (`scale=2`, `fps=30`, `dpi=300`);
//   - `marks=crop,registration` / `includeBleed=true` arrive nested as
//     `options.pdfPrint = { includeBleed, marks: {…} }` — the ONLY place exporters/pdf.ts
//     (`parsePdfPrintOptions`) reads them from, so a flat `options.marks` is silently dropped;
//   - the zip exporter's string-list options (`include` tags, `exclude` globs) arrive as ARRAYS —
//     exporters/zip.ts reads them behind `Array.isArray`, so the one comma string a flat
//     `--option include=system` used to send was dropped without a word and the zip shipped
//     everything;
//   - `export zip` without --scope asks for `project-raw` (the one scope the zip exporter
//     serves), the way video asks for `artboard`;
//   - `--out <directory>` writes the server's filename into that directory.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { estimateWords, filenameFromDisposition } from '../lib/export-spec.mjs';
import { parseExportOptions } from './design.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');

/** Boot a fake /_api/export; resolves to { port, requests, close }. */
async function fakeExportServer({ filename = 'export.bin', respond } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'),
      });
      const custom = respond?.(requests[requests.length - 1]);
      if (custom) {
        res.writeHead(custom.status ?? 200, custom.headers ?? {});
        res.end(custom.body ?? '');
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${filename}"`,
      });
      res.end(Buffer.from('ok'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Run `maude design export …` from a scratch cwd; resolves { code, stdout, stderr, cwd }. */
function runExportCli(cwd, port, args) {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      [BIN, 'design', 'export', ...args, '--port', String(port)],
      { cwd, env: { ...process.env, CLAUDE_PLUGIN_ROOT: undefined } }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('close', (code) => done({ code, stdout, stderr, cwd }));
  });
}

async function withExport(args, fn, serverOpts) {
  const cwd = mkdtempSync(join(tmpdir(), 'maude-export-cli-'));
  const server = await fakeExportServer(serverOpts);
  try {
    const res = await runExportCli(cwd, server.port, args);
    return await fn({ ...res, requests: server.requests });
  } finally {
    await server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ── parseExportOptions: the pure coercion ────────────────────────────────────────────────

test('parseExportOptions — numeric strings become numbers, true/false stay booleans', () => {
  const { options } = parseExportOptions(['scale=2', 'dpi=300', 'durationMs=4000', 'bg=false']);
  assert.deepEqual(options, { scale: 2, dpi: 300, durationMs: 4000, bg: false });
  assert.equal(typeof options.scale, 'number');
});

test('parseExportOptions — anything else stays a string (no lossy number guessing)', () => {
  const { options } = parseExportOptions([
    'pageFit=a4',
    'text=outline',
    'mode=raster',
    'id=007', // leading zero: not a number
    'hex=000000',
    'exp=1e3',
    'name=NaN',
    'huge=123456789012345678901234567890',
  ]);
  assert.deepEqual(options, {
    pageFit: 'a4',
    text: 'outline',
    mode: 'raster',
    id: '007',
    hex: '000000',
    exp: '1e3',
    name: 'NaN',
    huge: '123456789012345678901234567890',
  });
});

test('parseExportOptions — marks=crop nests as pdfPrint.marks.crop', () => {
  const { options } = parseExportOptions(['marks=crop']);
  assert.deepEqual(options, { pdfPrint: { marks: { crop: true } } });
});

test('parseExportOptions — marks=crop,registration sets both; includeBleed nests beside them', () => {
  const { options } = parseExportOptions(['includeBleed=true', 'marks=crop,registration']);
  assert.deepEqual(options, {
    pdfPrint: { includeBleed: true, marks: { crop: true, registration: true } },
  });
});

test('parseExportOptions — dpi/pageFit/text stay top-level next to pdfPrint', () => {
  const { options } = parseExportOptions(['dpi=300', 'marks=crop', 'text=embed']);
  assert.deepEqual(options, { dpi: 300, text: 'embed', pdfPrint: { marks: { crop: true } } });
});

test('parseExportOptions — an unknown mark names the valid ones', () => {
  const { error } = parseExportOptions(['marks=crop,bleed']);
  assert.match(error, /unknown mark "bleed"/);
  for (const valid of ['crop', 'registration', 'colorBars', 'pageInfo']) {
    assert.ok(error.includes(valid), `error should list ${valid}: ${error}`);
  }
});

test('parseExportOptions — an empty marks list, a non-boolean includeBleed, a bare key are errors', () => {
  assert.match(parseExportOptions(['marks=']).error, /marks/);
  assert.match(parseExportOptions(['marks=crop,']).error, /marks/);
  assert.match(parseExportOptions(['includeBleed=maybe']).error, /includeBleed/);
  assert.match(parseExportOptions(['scale']).error, /expected key=value/);
});

test('parseExportOptions — include / exclude (the zip string lists) become arrays', () => {
  const { options } = parseExportOptions(['include=system,canvases', 'exclude=**/*.map,tmp/']);
  assert.deepEqual(options, {
    include: ['system', 'canvases'],
    exclude: ['**/*.map', 'tmp/'],
  });
});

test('parseExportOptions — a single value is a one-item array, not a string', () => {
  assert.deepEqual(parseExportOptions(['include=system']).options, { include: ['system'] });
  assert.deepEqual(parseExportOptions(['exclude=drafts']).options, { exclude: ['drafts'] });
});

test('parseExportOptions — items are trimmed; a repeated key appends (like marks)', () => {
  const { options } = parseExportOptions([
    'include=system, assets',
    'include=meta',
    'include=system',
  ]);
  assert.deepEqual(options, { include: ['system', 'assets', 'meta'] });
});

test('parseExportOptions — list values are never number/boolean coerced', () => {
  assert.deepEqual(parseExportOptions(['exclude=2024,true']).options, {
    exclude: ['2024', 'true'],
  });
});

test('parseExportOptions — an empty list (or an empty entry) is an error naming the option', () => {
  for (const item of ['include=', 'exclude=', 'include=,', 'include=system,', 'exclude=a,,b']) {
    const { error } = parseExportOptions([item]);
    assert.match(error ?? '', /empty/, item);
    assert.match(error ?? '', new RegExp(item.split('=')[0]), item);
  }
});

test('parseExportOptions — an unknown include tag names the valid ones (zip would ship an empty archive)', () => {
  const { error } = parseExportOptions(['include=system,fonts']);
  assert.match(error, /unknown include tag "fonts"/);
  for (const valid of ['system', 'canvases', 'assets', 'meta']) {
    assert.ok(error.includes(valid), `error should list ${valid}: ${error}`);
  }
});

// ── the commands the export dialog prints ─────────────────────────────────────────────────

test('`export png --scope artboard --option scale=2` → scale is the NUMBER 2', async () => {
  await withExport(['png', '--scope', 'artboard', '--option', 'scale=2'], ({ code, requests }) => {
    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body, {
      format: 'png',
      scope: 'artboard',
      options: { scale: 2 },
    });
  });
});

test('`export pdf --scope artboard --option includeBleed=true --option marks=crop` → pdfPrint', async () => {
  await withExport(
    ['pdf', '--scope', 'artboard', '--option', 'includeBleed=true', '--option', 'marks=crop'],
    ({ code, requests }) => {
      assert.equal(code, 0);
      assert.deepEqual(requests[0].body, {
        format: 'pdf',
        scope: 'artboard',
        options: { pdfPrint: { includeBleed: true, marks: { crop: true } } },
      });
    }
  );
});

test('`export pdf --option dpi=300 --option text=outline` keeps dpi numeric, text a string', async () => {
  await withExport(
    ['pdf', '--scope', 'artboard', '--option', 'dpi=300', '--option', 'text=outline'],
    ({ requests }) => {
      assert.deepEqual(requests[0].body.options, { dpi: 300, text: 'outline' });
    }
  );
});

test('`export mp4 --scope artboard --option fps=30 --out <dir>` → fps is 30 and the file lands IN the dir', async () => {
  const cwd0 = mkdtempSync(join(tmpdir(), 'maude-export-out-'));
  const outDir = join(cwd0, 'Downloads');
  mkdirSync(outDir);
  try {
    await withExport(
      ['mp4', '--scope', 'artboard', '--option', 'fps=30', '--out', outDir],
      ({ code, stderr, requests }) => {
        assert.equal(code, 0, stderr);
        assert.deepEqual(requests[0].body, {
          format: 'mp4',
          scope: 'artboard',
          options: { fps: 30 },
        });
        assert.deepEqual(readdirSync(outDir), ['clip.mp4']);
      },
      { filename: 'clip.mp4' }
    );
  } finally {
    rmSync(cwd0, { recursive: true, force: true });
  }
});

test('--out a plain file path still writes exactly that file', async () => {
  const cwd0 = mkdtempSync(join(tmpdir(), 'maude-export-out-'));
  const target = join(cwd0, 'named.png');
  try {
    await withExport(['png', '--out', target], ({ code, stderr }) => {
      assert.equal(code, 0, stderr);
      assert.ok(existsSync(target));
    });
  } finally {
    rmSync(cwd0, { recursive: true, force: true });
  }
});

test('`export zip --option include=system,assets --option exclude=**/*.map` → arrays on the wire', async () => {
  await withExport(
    ['zip', '--option', 'include=system,assets', '--option', 'exclude=**/*.map'],
    ({ code, requests }) => {
      assert.equal(code, 0);
      assert.deepEqual(requests[0].body, {
        format: 'zip',
        scope: 'project-raw',
        options: { include: ['system', 'assets'], exclude: ['**/*.map'] },
      });
    }
  );
});

test('`export zip --option include=` exits 2 and sends nothing', async () => {
  await withExport(['zip', '--option', 'include='], ({ code, stderr, requests }) => {
    assert.equal(code, 2);
    assert.match(stderr, /empty/);
    assert.equal(requests.length, 0);
  });
});

// ── zip default scope ───────────────────────────────────────────────────────────────────

test('`export zip` with no --scope asks for project-raw (the only scope zip serves)', async () => {
  await withExport(['zip'], ({ code, requests }) => {
    assert.equal(code, 0);
    assert.equal(requests[0].body.scope, 'project-raw');
    assert.equal(requests[0].body.format, 'zip');
  });
});

test('`export zip --scope canvas-as-separate` is sent as given (the server refuses it, not the CLI)', async () => {
  await withExport(['zip', '--scope', 'canvas-as-separate'], ({ requests }) => {
    assert.equal(requests[0].body.scope, 'canvas-as-separate');
  });
});

test('non-zip, non-video formats keep the canvas-as-separate default', async () => {
  await withExport(['png'], ({ requests }) => {
    assert.equal(requests[0].body.scope, 'canvas-as-separate');
  });
});

test('video still defaults to artboard', async () => {
  await withExport(['webm'], ({ requests }) => {
    assert.equal(requests[0].body.scope, 'artboard');
  });
});

// ── bad input exits 2 before any request is made ───────────────────────────────────────

test('an unknown mark exits 2, names the valid marks, and sends nothing', async () => {
  await withExport(['pdf', '--option', 'marks=bleed'], ({ code, stderr, requests }) => {
    assert.equal(code, 2);
    assert.match(stderr, /unknown mark "bleed"/);
    assert.match(stderr, /crop, registration, colorBars, pageInfo/);
    assert.equal(requests.length, 0);
  });
});

// ── ExportSpec v2 (S8.1c): `{v:2, spec}` ≡ what validateSpecV2 accepts ─────────────────────

const SPEC_V2_TS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'studio',
  'exporters',
  'spec-v2.ts'
);

/** The server's own validator (bun: spec-v2.ts is TypeScript) on a spec; { ok, spec } | { ok:false, error }. */
function validateOnServer(spec) {
  const r = spawnSync(
    'bun',
    [
      '-e',
      `import {validateSpecV2} from ${JSON.stringify(SPEC_V2_TS)};
       const raw = JSON.parse(await Bun.stdin.text());
       process.stdout.write(JSON.stringify(validateSpecV2(raw)));`,
    ],
    { input: JSON.stringify(spec), encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** Run, assert ONE v2 request the server's validator accepts unchanged; returns the spec. */
async function v2Spec(args, serverOpts) {
  return withExport(
    args,
    ({ code, stderr, requests }) => {
      assert.equal(code, 0, stderr);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, '/_api/export');
      const body = requests[0].body;
      assert.deepEqual(Object.keys(body), ['v', 'spec']);
      assert.equal(body.v, 2);
      const verdict = validateOnServer(body.spec);
      assert.equal(verdict.ok, true, JSON.stringify(verdict));
      // the validator echoes only what it understood: nothing was added or dropped on the way
      assert.deepEqual(verdict.spec, body.spec);
      return body.spec;
    },
    serverOpts
  );
}

test("--scope folder --folder … --name … → the sheet's spec, accepted by validateSpecV2", async () => {
  const spec = await v2Spec([
    'png',
    '--scope',
    'folder',
    '--folder',
    'ui/2026',
    '--name',
    '{canvas}-{size}',
  ]);
  assert.deepEqual(spec, {
    v: 2,
    scope: 'folder',
    folder: 'ui/2026',
    format: 'png',
    options: { nameTemplate: '{canvas}-{size}' },
  });
});

test('--scope canvas with --canvas, --region, --unit one, jpg and size → one spec', async () => {
  const spec = await v2Spec([
    'jpg',
    '--scope',
    'canvas',
    '--canvas',
    'ui/a.tsx',
    '--region',
    '0,10,400,300.5',
    '--unit',
    'one',
    '--option',
    'scale=2',
    '--option',
    'jpgQuality=80',
  ]);
  assert.deepEqual(spec, {
    v: 2,
    scope: 'canvas',
    canvas: 'ui/a.tsx',
    region: { rect: { x: 0, y: 10, w: 400, h: 300.5 } },
    unit: 'one',
    format: 'jpg',
    options: { size: { scale: 2 }, jpgQuality: 80 },
  });
});

test('--scope selection with --artboard / --element ids → spec.selection', async () => {
  const spec = await v2Spec([
    'png',
    '--scope',
    'selection',
    '--canvas',
    'ui/a.tsx',
    '--artboard',
    'hero',
    '--artboard',
    'footer',
    '--element',
    'cta',
  ]);
  assert.deepEqual(spec.selection, { artboards: ['hero', 'footer'], elements: ['cta'] });
  assert.equal(spec.canvas, 'ui/a.tsx');
});

test('--scope project: short option names and dotted ones land in the nested options', async () => {
  const spec = await v2Spec([
    'pdf',
    '--scope',
    'project',
    '--option',
    'dpi=300',
    '--option',
    'bleed=true',
    '--option',
    'marks=crop',
    '--option',
    'video.fps=24',
    '--option',
    'annotations=false',
  ]);
  assert.deepEqual(spec.options, {
    size: { dpi: 300 },
    print: { bleed: true, marks: 'crop' },
    video: { fps: 24 },
    annotations: false,
  });
});

test('audio, --at and --wait ride the spec; the CLI prints the server’s not-available sentence', async () => {
  const refusal = JSON.stringify({
    error: 'not-available',
    field: 'at',
    message: 'Exporting a past version is not available yet.',
  });
  await withExport(
    ['audio', '--scope', 'canvas', '--at', 'abc1234', '--wait', 'ai', '--option', 'codec=m4a'],
    ({ code, stderr, requests }) => {
      assert.equal(code, 1);
      assert.deepEqual(requests[0].body.spec, {
        v: 2,
        scope: 'canvas',
        format: 'audio',
        options: { audio: { codec: 'm4a' } },
        at: { sha: 'abc1234' },
        wait: 'ai',
      });
      assert.equal(validateOnServer(requests[0].body.spec).ok, true);
      assert.match(stderr, /Exporting a past version is not available yet\./);
      assert.doesNotMatch(stderr, /\{"error"/);
    },
    {
      respond: () => ({
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: refusal,
      }),
    }
  );
});

test('with no --scope, a v2-only format or flag asks for This canvas in v2 shape', async () => {
  assert.deepEqual(await v2Spec(['jpg']), { v: 2, scope: 'canvas', format: 'jpg' });
  assert.equal((await v2Spec(['png', '--name', 'x'])).scope, 'canvas');
  assert.equal((await v2Spec(['png', '--artboard', 'hero'])).scope, 'selection');
});

// ── v1 spellings keep their v1 body, byte for byte ───────────────────────────────────────

test('--scope selection alone is still the v1 body (the live selection)', async () => {
  await withExport(['png', '--scope', 'selection'], ({ requests }) => {
    assert.deepEqual(requests[0].body, { format: 'png', scope: 'selection', options: {} });
  });
});

test('--scope canvas-whole stays v1 and never grows a v:2', async () => {
  await withExport(['png', '--scope', 'canvas-whole'], ({ requests }) => {
    assert.deepEqual(requests[0].body, { format: 'png', scope: 'canvas-whole', options: {} });
  });
});

test('a v1 scope with a v2-only flag exits 2 naming the v2 scopes, and sends nothing', async () => {
  await withExport(
    ['png', '--scope', 'artboard', '--region', '0,0,10,10'],
    ({ code, stderr, requests }) => {
      assert.equal(code, 2);
      assert.match(stderr, /--scope selection\|canvas\|folder\|project/);
      assert.equal(requests.length, 0);
    }
  );
});

test('jpg with a v1 scope exits 2 (the v1 engine has no jpg), and sends nothing', async () => {
  await withExport(['jpg', '--scope', 'artboard'], ({ code, requests }) => {
    assert.equal(code, 2);
    assert.equal(requests.length, 0);
  });
});

test('a bad --region / --unit exits 2 before any request', async () => {
  for (const args of [
    ['png', '--scope', 'canvas', '--region', '1,2,3'],
    ['png', '--scope', 'canvas', '--region', 'a,b,c,d'],
    ['png', '--scope', 'canvas', '--region', '0,0,0,10'],
    ['png', '--scope', 'canvas', '--unit', 'many'],
  ]) {
    await withExport(args, ({ code, requests }) => {
      assert.equal(code, 2, args.join(' '));
      assert.equal(requests.length, 0);
    });
  }
});

// ── the response: filename* wins, the plain filename falls back ─────────────────────────

test('filenameFromDisposition — RFC 6266 filename* is decoded and wins over the ASCII fallback', () => {
  assert.equal(
    filenameFromDisposition(
      `attachment; filename="Cafe Plakat.png"; filename*=UTF-8''Caf%C3%A9%20Plak%C3%A1t.png`
    ),
    'Café Plakát.png'
  );
  assert.equal(filenameFromDisposition('attachment; filename="a b.png"'), 'a b.png');
  assert.equal(filenameFromDisposition(''), null);
  // a broken escape falls back to the plain name instead of throwing
  assert.equal(
    filenameFromDisposition(`attachment; filename="ok.png"; filename*=UTF-8''%E0%A4%A.png`),
    'ok.png'
  );
});

test('a non-ASCII server filename is written under its real name, and never as a path', async () => {
  await withExport(
    ['png', '--scope', 'canvas'],
    ({ code, cwd }) => {
      assert.equal(code, 0);
      // `..%2F..%2F` decodes to a path: basename() keeps only the last segment
      assert.deepEqual(readdirSync(cwd), ['Café Plakát.png']);
    },
    {
      respond: () => ({
        headers: {
          'content-type': 'image/png',
          'content-disposition': `attachment; filename="Cafe Plakat.png"; filename*=UTF-8''..%2F..%2FCaf%C3%A9%20Plak%C3%A1t.png`,
        },
        body: 'png',
      }),
    }
  );
});

// ── --estimate: numbers from the server, words built here ───────────────────────────────

test('estimateWords — contract §5.5 rounding: 2 significant figures, a second / a few / about N', () => {
  assert.equal(
    estimateWords({ files: 21, lane: 'this-mac', bytes: 146_000_000, seconds: 20 }),
    '21 files · about 150 MB · about 20 seconds on this Mac'
  );
  assert.equal(
    estimateWords({ files: 1, lane: 'this-mac', bytes: 2048, seconds: 1 }),
    '1 file · about 2 KB · a second on this Mac'
  );
  assert.equal(
    estimateWords({ files: 3, lane: 'cloud', bytes: 3_400_000_000, seconds: 7 }),
    '3 files · about 3.4 GB · a few seconds in the cloud'
  );
  assert.equal(
    estimateWords({ files: 2, lane: 'this-mac', bytes: 900, seconds: 47 }),
    '2 files · about 900 bytes · about 45 seconds on this Mac'
  );
  assert.equal(
    estimateWords({ files: 2, lane: 'this-mac', bytes: 1000, seconds: 130 }),
    '2 files · about 1 KB · about 2 min on this Mac'
  );
});

test('--estimate posts {spec} to /_api/export-estimate, prints the words, writes no file', async () => {
  const estimate = {
    counts: { selection: null, canvas: 4, folder: 12, project: 40 },
    files: 21,
    bytes: 146_000_000,
    seconds: 20,
    lane: 'this-mac',
    byKind: { digital: { artboards: 4, files: 4, format: 'png' } },
    skipped: [{ name: 'Hero', reason: 'format-unit' }],
    basis: { bytes: 'table', seconds: 'table' },
  };
  await withExport(
    ['png', '--scope', 'folder', '--folder', 'ui', '--estimate'],
    ({ code, stdout, requests, cwd }) => {
      assert.equal(code, 0);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, '/_api/export-estimate');
      assert.deepEqual(Object.keys(requests[0].body), ['spec']);
      assert.deepEqual(requests[0].body.spec, {
        v: 2,
        scope: 'folder',
        folder: 'ui',
        format: 'png',
      });
      assert.equal(validateOnServer(requests[0].body.spec).ok, true);
      assert.match(stdout, /21 files · about 150 MB · about 20 seconds on this Mac/);
      assert.match(stdout, /Hero/);
      assert.deepEqual(readdirSync(cwd), []);
    },
    {
      respond: () => ({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(estimate),
      }),
    }
  );
});

test('--estimate on a v1 scope exits 2 (the estimate is a v2 thing)', async () => {
  await withExport(['png', '--scope', 'artboard', '--estimate'], ({ code, requests }) => {
    assert.equal(code, 2);
    assert.equal(requests.length, 0);
  });
});
