// stub-studio-server.mjs — a stand-in for the compiled studio server (`maude-server`) in tests that
// exercise how the CLI and server-up START a studio, not the studio itself (T1.9 / T1.10, #206).
//
// The stub records the env it was started with to `<root>/.design/_stub-env.json`, writes
// `_server.json`, answers `/_health` like the studio does, and exits by itself after a minute so a
// test that dies early leaves nothing running. It runs on the absolute node path it is given, so it
// starts from a stripped PATH too.

export function stubServerSource(nodePath) {
  return `#!${nodePath}
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = process.argv[process.argv.indexOf('--root') + 1];
const design = path.join(root, '.design');
const pick = (k) => (process.env[k] === undefined ? null : process.env[k]);
fs.writeFileSync(path.join(design, '_stub-env.json'), JSON.stringify({
  NO_OPEN: pick('NO_OPEN'),
  MAUDE_DEV_SERVER_ROOT: pick('MAUDE_DEV_SERVER_ROOT'),
  MAUDE_PKG_ROOT: pick('MAUDE_PKG_ROOT'),
  argv: process.argv.slice(2),
}));
const srv = http.createServer((_q, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, app: 'design', pid: process.pid }));
});
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port;
  fs.writeFileSync(path.join(design, '_server.json'),
    JSON.stringify({ pid: process.pid, port, url: 'http://localhost:' + port }));
});
setTimeout(() => process.exit(0), 60000);
`;
}
