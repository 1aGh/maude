#!/usr/bin/env node
// The toggle proxy (scripts/dev/sync-e2e/toggle-proxy.mjs) for a REMOTE https
// backend: a participant talks plain http to 127.0.0.1:<listen>, the proxy
// forwards every request and WebSocket upgrade to <upstream> over TLS with the
// Host rewritten (the cell routes a tenant by hostname), and the driver can
// pull the cable:
//
//   POST /offline  — refuse new connections and cut every open one
//   POST /online   — accept again
//   GET  /state    — { offline, open }
//
//   node tls-toggle-proxy.mjs <listenPort> <https://upstream> <controlPort>
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';

const [listenArg, upstreamArg, controlArg] = process.argv.slice(2);
const listen = Number(listenArg);
const control = Number(controlArg);
const upstream = new URL(upstreamArg);
if (!listen || !control || upstream.protocol !== 'https:')
  throw new Error('usage: tls-toggle-proxy.mjs <listen> <https://upstream> <control>');
const host = upstream.hostname;
const upPort = Number(upstream.port || 443);

let offline = false;
const open = new Set();
const track = (s) => {
  open.add(s);
  s.on('close', () => open.delete(s));
};

const server = createServer((req, res) => {
  if (offline) {
    req.socket.destroy();
    return;
  }
  const headers = { ...req.headers, host };
  delete headers.connection;
  const up = httpsRequest(
    { host, port: upPort, servername: host, method: req.method, path: req.url, headers },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    }
  );
  up.on('socket', track);
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});
server.on('connection', track);
server.on('upgrade', (req, socket, head) => {
  if (offline) {
    socket.destroy();
    return;
  }
  const up = tlsConnect({ host, port: upPort, servername: host }, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      lines.push(`${k}: ${k.toLowerCase() === 'host' ? host : req.rawHeaders[i + 1]}`);
    }
    up.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  track(up);
  const close = () => {
    socket.destroy();
    up.destroy();
  };
  socket.on('error', close).on('close', close);
  up.on('error', close).on('close', close);
});
server.listen(listen, '127.0.0.1');

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/offline') {
    offline = true;
    for (const s of open) s.destroy();
    open.clear();
  } else if (req.method === 'POST' && req.url === '/online') {
    offline = false;
  } else if (!(req.method === 'GET' && req.url === '/state')) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ offline, open: open.size }));
}).listen(control, '127.0.0.1');
