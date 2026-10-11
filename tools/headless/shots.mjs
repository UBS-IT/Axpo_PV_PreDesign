// Pictures of the app for the README (phase 6 of the ribbon plan): node shots.mjs [app url] [folder]
// e.g. node shots.mjs http://localhost:8140/app/ ../../docs/img (the app served by scripts/serve.py).
// Unlike run.mjs, which works offline with the npm bundle, this opens the real app with the SDK from js.arcgis.com and
// the imagery of Esri, so it needs the Internet; the map is drawn by the software WebGL of headless Chromium. It imports
// the invented test project tests/fixtures/it_slope.axpo (site, terrain and slope limit of a made-up place) and saves
// one picture per tab at 1366 × 800 in the light theme. The test project cuts its whole site at 10 %: the pictures set
// a limit of 15 % by hand (an own limit, said so in the app) and a pitch of 10.3 m, so that the layout shows.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:8140/app/';
const out = path.resolve(process.argv[3] || path.join(here, '../../docs/img'));
const fixture = path.join(here, '../../tests/fixtures/it_slope.axpo');
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, colorScheme: 'light' });
// the SDK refuses software WebGL unless asked not to (as page.mjs does for the 3D test)
await ctx.addInitScript(() => {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, opts) { return get.call(this, type, opts ? { ...opts, failIfMajorPerformanceCaveat: false } : opts); };
  try { localStorage.setItem('pvp.theme', 'light'); } catch {}
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  page error:', e.message));
const settled = async (extra = 3000) => {
  await page.waitForFunction(() => window.__view && window.__view.ready && !window.__view.updating, null, { timeout: 180000 }).catch(() => console.log('  (the map was still loading)'));
  await wait(extra);
};
const shot = async name => {
  await page.evaluate(() => document.querySelectorAll('#toast .toast').forEach(t => t.remove()));   // the messages of the import
  await page.screenshot({ path: path.join(out, name) }); console.log('  saved', name);
};
const tab = i => page.evaluate(n => document.querySelectorAll('.tab')[n].click(), i);

console.log('opening', url);
await page.goto(url + '?noauto');
await page.waitForFunction(() => window.__view && window.__view.ready, null, { timeout: 180000 });
await page.setInputFiles('#fileImport', fixture);
// the import is done when its terrain is adopted (the grid of the project, after the objects)
await page.waitForFunction(() => document.querySelectorAll('#areaCats .it[data-id]').length > 0 && /slopes|elevations/.test(document.getElementById('layTerImageFig')?.textContent || ''), null, { timeout: 120000 });
await wait(3000);
// a limit of 15 % by hand (the plane of the test project is 10.3 %) and the pitch, then the layout
await page.evaluate(async () => { const T = await import('./js/terrain/terrain.js'); T.setLimit({ maxAny: 15 }); });
await page.evaluate(() => { const i = document.getElementById('fPitch'); i.value = '10.3'; i.dispatchEvent(new Event('change')); });
try {
  await page.waitForFunction(() => /\d/.test(document.querySelector('#collPanel [data-fig="layout:tables"]')?.textContent || ''), null, { timeout: 120000 });
} catch (e) {
  console.log('  no layout:', await page.evaluate(async () => { const S = await import('./js/state.js'); const p = S.store.project; return JSON.stringify({ field: p.field, limit: p.terrain.limit, warns: document.getElementById('warns')?.innerText }); }));
  throw e;
}
await page.evaluate(async () => { const A = await import('./js/areas.js'); A.zoomToFeatures(); });
await tab(0); await settled(4000); await shot('01-site-area.png');
await tab(1); await settled(4000); await shot('02-terrain.png');
await tab(2); await settled(6000); await shot('03-layout.png');
await tab(4); await settled(2000); await shot('04-report.png');
// the search of the objects (Ctrl K) over the layout
await tab(2); await settled(1000);
await page.keyboard.press('Control+K');
await page.keyboard.type('site');
await wait(800); await shot('05-search.png');
await page.keyboard.press('Escape');
// No 3D picture: the terrain of the test project is invented (elevations of 76–124 m) at a real place where the
// ground of Esri is near 270 m, so the 3D tables would sit under the Esri ground. A real project does not have this.
await browser.close();
