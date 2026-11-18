/* Runs portal/worker.js for one request, outside Cloudflare.

   There is no Node on the machine this site is built on, so the local test
   harness runs the Worker under macOS's own JavaScriptCore instead:

     osascript -l JavaScript run_worker.js <request.json> <response.json> <bridge-url> <worker.js>

   JavaScriptCore has the language but none of the web platform, so the pieces
   the Worker uses (URL, Headers, Request, Response, TextEncoder, crypto, fetch)
   are stood in for here, and the D1 database binding is forwarded to
   server.py, which answers it from a local SQLite file. The Worker source is
   run exactly as deployed apart from its `export default` line. */

ObjC.import('Foundation');
ObjC.import('Cocoa');

function readText(path) {
  return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null));
}
function writeText(path, text) {
  $(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
}

function run(argv) {
  const reqPath = argv[0], resPath = argv[1], bridgeUrl = argv[2], workerPath = argv[3];
  const G = globalThis;
  const r = JSON.parse(readText(reqPath));

  // synchronous call back into server.py
  function bridge(kind, payload) {
    const req = $.NSMutableURLRequest.requestWithURL($.NSURL.URLWithString(bridgeUrl + '/__bridge/' + kind));
    req.setHTTPMethod('POST');
    req.setValueForHTTPHeaderField('application/json', 'Content-Type');
    req.setHTTPBody($(JSON.stringify(payload)).dataUsingEncoding($.NSUTF8StringEncoding));
    const data = $.NSURLConnection.sendSynchronousRequestReturningResponseError(req, null, null);
    if (!data || data.isNil()) throw new Error('dev bridge unreachable');
    const out = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
    if (out.error) throw new Error(out.error);
    return out;
  }

  // tests move the clock to check lockouts and sessions expiring
  if (r.clockOffsetMs) {
    const RealDate = Date, off = r.clockOffsetMs;
    G.Date = class extends RealDate {
      constructor(...a) { if (a.length === 0) super(RealDate.now() + off); else super(...a); }
      static now() { return RealDate.now() + off; }
    };
  }

  const toHex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (h) => new Uint8Array((h.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
  const bytesOf = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength));

  G.TextEncoder = class {
    encode(s) {
      const u = unescape(encodeURIComponent(String(s)));
      const a = new Uint8Array(u.length);
      for (let i = 0; i < u.length; i++) a[i] = u.charCodeAt(i);
      return a;
    }
  };

  class SearchParams {
    constructor(q) {
      this.list = [];
      for (const part of String(q || '').replace(/^\?/, '').split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        const dec = (x) => decodeURIComponent(x.replace(/\+/g, ' '));
        this.list.push([dec(i < 0 ? part : part.slice(0, i)), i < 0 ? '' : dec(part.slice(i + 1))]);
      }
    }
    get(k) { const f = this.list.find((x) => x[0] === k); return f ? f[1] : null; }
  }
  G.URL = class {
    constructor(s) {
      const m = /^(https?:)\/\/([^\/?#]+)([^?#]*)(\?[^#]*)?/.exec(String(s));
      if (!m) throw new TypeError('Invalid URL');
      this.protocol = m[1]; this.host = m[2]; this.pathname = m[3] || '/'; this.search = m[4] || '';
      this.hostname = m[2].replace(/:\d+$/, ''); this.port = (/:(\d+)$/.exec(m[2]) || [])[1] || '';
      this.origin = m[1] + '//' + m[2]; this.href = String(s);
      this.searchParams = new SearchParams(this.search);
    }
  };

  G.Headers = class {
    constructor(init) {
      this.list = [];
      if (init instanceof G.Headers) this.list = init.list.map((x) => x.slice());
      else for (const k of Object.keys(init || {})) this.append(k, init[k]);
    }
    append(k, v) { this.list.push([String(k).toLowerCase(), String(v)]); }
    set(k, v) { k = String(k).toLowerCase(); this.list = this.list.filter((x) => x[0] !== k); this.list.push([k, String(v)]); }
    get(k) {
      k = String(k).toLowerCase();
      const v = this.list.filter((x) => x[0] === k).map((x) => x[1]);
      return v.length ? v.join(', ') : null;
    }
  };
  G.Request = class {
    constructor(url, init) {
      this.url = url; this.method = (init && init.method) || 'GET';
      this.headers = new G.Headers((init && init.headers) || {});
      this._body = (init && init.body) || '';
    }
    async text() { return this._body; }
  };
  G.Response = class {
    constructor(body, init) {
      this._body = body === null || body === undefined ? '' : String(body);
      this.status = (init && init.status) || 200;
      this.headers = init && init.headers instanceof G.Headers ? init.headers : new G.Headers((init && init.headers) || {});
      this.ok = this.status >= 200 && this.status < 300;
    }
    async text() { return this._body; }
    async json() { return JSON.parse(this._body); }
  };

  G.crypto = {
    getRandomValues(a) { a.set(fromHex(bridge('random', { n: a.length }).hex)); return a; },
    subtle: {
      async digest(alg, data) {
        if (alg !== 'SHA-256') throw new Error('shim: only SHA-256');
        return fromHex(bridge('sha256', { hex: toHex(bytesOf(data)) }).hex).buffer;
      },
      async importKey(format, data, alg) {
        if (format !== 'raw' || alg !== 'PBKDF2') throw new Error('shim: only raw PBKDF2 keys');
        return { raw: bytesOf(data) };
      },
      async deriveBits(p, key, bits) {
        if (p.name !== 'PBKDF2' || p.hash !== 'SHA-256') throw new Error('shim: only PBKDF2-SHA256');
        // Workers refuse anything above this; fail here too rather than only in production
        if (p.iterations > 100000) throw new Error('NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported');
        return fromHex(bridge('pbkdf2', { password: toHex(key.raw), salt: toHex(bytesOf(p.salt)),
          iterations: p.iterations, bits }).hex).buffer;
      },
    },
  };

  // outbound email: recorded by the dev server instead of being sent anywhere
  G.fetch = async (url, init) => {
    const out = bridge('fetch', { url: String(url), method: (init && init.method) || 'GET',
      auth: !!(init && init.headers && init.headers.Authorization), body: (init && init.body) || '' });
    if (out.throw) throw new Error('network down');
    return new G.Response(out.body || '', { status: out.status });
  };

  // D1, as far as the Worker uses it. Like the real one, it refuses `undefined`.
  const check = (v) => {
    if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    if (v !== null && typeof v === 'object') throw new Error("D1_TYPE_ERROR: Type 'object' not supported");
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  };
  class Stmt {
    constructor(sql, params) { this.sql = sql; this.params = params || []; }
    bind(...p) { return new Stmt(this.sql, p.map(check)); }
    exec() {
      const out = bridge('d1', { sql: this.sql, params: this.params });
      return { results: out.rows, success: true, meta: out.meta };
    }
    async all() { return this.exec(); }
    async run() { return this.exec(); }
    async first() { return this.exec().results[0] || null; }
  }
  const DB = {
    prepare(sql) { return new Stmt(sql, []); },
    async batch(stmts) {
      return bridge('d1batch', { stmts: stmts.map((s) => ({ sql: s.sql, params: s.params })) })
        .results.map((x) => ({ results: x.rows, success: true, meta: x.meta }));
    },
  };

  const env = Object.assign({ DB, ASSETS: { fetch: async () => new G.Response('static asset', { status: 200 }) } }, r.env || {});
  if (r.noDb) delete env.DB;

  let src = readText(workerPath);
  if (src.split('export default {').length !== 2) throw new Error('expected exactly one `export default {` in the worker');
  src = src.replace('export default {', 'globalThis.__worker = {');
  (0, eval)(src);

  const request = new G.Request(r.url, { method: r.method, headers: r.headers, body: r.body });
  G.__worker.fetch(request, env).then(async (res) => {
    writeText(resPath, JSON.stringify({ status: res.status, headers: res.headers.list, body: await res.text() }));
  }).catch((e) => {
    writeText(resPath, JSON.stringify({ status: 599, headers: [], body: 'worker threw: ' + (e && e.stack ? e.stack : e) }));
  });
  return '';
}
