// Used by run.mjs: a static server on the project root and a Chromium page whose requests to js.arcgis.com are
// answered from the local bundle of build.mjs (the other libraries are in app/vendor). Map tiles and Esri services
// are not available offline. Known limit: a MapView does not start with the npm bundle (its 2D workers do not come
// up), so the app page itself must be checked in a real browser; the test pages do not need a view.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(here, 'dist');
const coreAssets = path.join(here, 'node_modules/@arcgis/core/assets');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.tif': 'image/tiff' };

let server = null, base = null, browser = null;
async function start() {
  if (server) return;
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let f = url.startsWith('/__assets/') ? path.join(coreAssets, url.slice(10)) : url.startsWith('/__dist/') ? path.join(dist, url.slice(8)) : path.join(root, url);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { if (process.env.DEBUG404) console.log('404', url); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
}

// $arcgis.import() backed by the local bundle; SDK assets (projection engine, workers) from node_modules
const shim = () => `(() => {
  let b = null;
  const load = async () => {
    if (!b) { b = await import('${base}/__dist/arcgis.js'); b['k' + b.KEYS.indexOf('@arcgis/core/config.js')].assetsPath = '${base}/__assets'; }
    return b;
  };
  window.$arcgis = { import: async p => { const m = await load(); const one = x => { const i = m.KEYS.indexOf(x); if (i < 0) throw new Error('not bundled: ' + x); return m['k' + i]; };
    return Array.isArray(p) ? p.map(one) : one(p); } };
})();`;

// softwareWebGL: let the SDK draw with the software WebGL of headless Chromium (SwiftShader), which it refuses by
// default (failIfMajorPerformanceCaveat): slow, but enough to run a SceneView in the tests
export async function openPage(pagePath, { localStorage: ls = null, softwareWebGL = false } = {}) {
  await start();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (softwareWebGL) await ctx.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, opts ? { ...opts, failIfMajorPerformanceCaveat: false } : opts); };
  });
  await ctx.route(/^https:\/\/js\.arcgis\.com\/4\.34\/?$/, r => r.fulfill({ contentType: 'text/javascript', body: shim() }));
  await ctx.route(/^https:\/\/js\.arcgis\.com\/.*\.css$/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  // anything else on the Internet (basemaps, Esri services) is not reachable offline: fail fast
  await ctx.route(url => !url.href.startsWith(base) && !/^https:\/\/js\.arcgis\.com\//.test(url.href), r => r.abort());
  // no real downloads or file pickers during tests
  await ctx.addInitScript(() => { HTMLAnchorElement.prototype.click = function () { window.__downloads = (window.__downloads || []).concat(this.download); }; });
  if (ls) await ctx.addInitScript(items => { if (location.pathname.startsWith('/app')) for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }, ls);
  const page = await ctx.newPage();
  const errors = [];
  // the last console messages of any kind, with the seconds since the page opened: printed by run.mjs when a page
  // times out, to show what the page was doing when it stopped
  const log = [], t0 = Date.now();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR|basemap|tile/i.test(m.text())) errors.push('console: ' + m.text());
    log.push(`${Math.round((Date.now() - t0) / 1000)} s ${m.type()}: ${m.text().slice(0, 300)}`);
    if (log.length > 40) log.shift();
  });
  await page.goto(base + pagePath);
  return { page, errors, log, close: async () => { await ctx.close(); } };
}
export async function shutdown() { if (browser) await browser.close(); if (server) server.close(); }
process.on('exit', () => { try { server && server.close(); } catch {} });
