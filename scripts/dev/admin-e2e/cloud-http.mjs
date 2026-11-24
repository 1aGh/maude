// A small HTTPS client for the cloud scenario harness: a cookie jar per person,
// manual redirects, and trust for the local edge's self-signed certificate.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export class Client {
  constructor(name = 'client') {
    this.name = name;
    /** host → Map(name → value) */
    this.jar = new Map();
    this.headers = {};
  }

  cookieHeader(url) {
    const jar = this.jar.get(new URL(url).host);
    return jar ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : '';
  }

  cookie(url, name) {
    return this.jar.get(new URL(url).host)?.get(name) ?? null;
  }

  store(url, setCookies) {
    const host = new URL(url).host;
    const jar = this.jar.get(host) ?? new Map();
    this.jar.set(host, jar);
    for (const line of setCookies ?? []) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const gone = value === '' || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (gone) jar.delete(name);
      else jar.set(name, value);
    }
  }

  /**
   * One request, no redirect following.
   * @param {string} method
   * @param {string} url
   * @param {{ form?: Record<string,string>, json?: unknown, body?: string|Buffer, headers?: Record<string,string>, cookies?: boolean }} [opts]
   */
  request(method, url, opts = {}) {
    const u = new URL(url);
    const headers = {
      accept: 'text/html,application/json',
      ...this.headers,
      ...(opts.headers ?? {}),
    };
    let body = opts.body ?? null;
    if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    } else if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers['content-type'] = 'application/json';
    }
    if (opts.cookies !== false) {
      const cookie = this.cookieHeader(url);
      if (cookie) headers.cookie = cookie;
    }
    if (body !== null) headers['content-length'] = String(Buffer.byteLength(body));
    const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((ok, fail) => {
      const req = send(
        {
          host: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method,
          headers: { host: u.host, ...headers },
          rejectUnauthorized: false,
          timeout: opts.timeoutMs ?? 90_000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if (opts.cookies !== false) this.store(url, res.headers['set-cookie']);
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              /* not JSON */
            }
            const location = res.headers.location ? new URL(res.headers.location, url).href : null;
            ok({ status: res.statusCode ?? 0, headers: res.headers, text, json, location, url });
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${url}`)));
      req.on('error', fail);
      if (body !== null) req.write(body);
      req.end();
    });
  }

  get(url, opts) {
    return this.request('GET', url, opts);
  }
  post(url, opts) {
    return this.request('POST', url, opts);
  }

  /** Follow redirects (GET after 30x), same jar. Returns the last response + the chain. */
  async follow(method, url, opts = {}, max = 8) {
    const chain = [];
    let res = await this.request(method, url, opts);
    chain.push({ status: res.status, url });
    while (res.status >= 300 && res.status < 400 && res.location && chain.length <= max) {
      const next = res.location;
      res = await this.request('GET', next, { headers: opts.headers });
      chain.push({ status: res.status, url: next });
    }
    return { ...res, chain };
  }
}

/** Hidden inputs of the first form whose action matches, as an object. */
export function hiddenFields(html, actionPattern = null) {
  const forms = [...String(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  for (const [, attrs, inner] of forms) {
    const action = /action="([^"]*)"/i.exec(attrs)?.[1] ?? '';
    if (actionPattern && !actionPattern.test(action)) continue;
    const out = {};
    for (const [, input] of inner.matchAll(/<input\b([^>]*)>/gi)) {
      if (!/type="hidden"/i.test(input)) continue;
      const name = /name="([^"]*)"/i.exec(input)?.[1];
      const value = /value="([^"]*)"/i.exec(input)?.[1] ?? '';
      if (name) out[name] = value.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    }
    return { action, fields: out };
  }
  return null;
}

/** Visible text of an HTML page, for assertions and evidence. */
export function textOf(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&rsquo;|&apos;/g, '’')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
