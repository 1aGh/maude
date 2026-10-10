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
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseExportOptions } from './design.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');

/** Boot a fake /_api/export; resolves to { port, requests, close }. */
async function fakeExportServer({ filename = 'export.bin' } = {}) {
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
