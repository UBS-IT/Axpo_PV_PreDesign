// Bundles the libraries the app loads from CDNs, so that run.mjs can serve them locally:
// the ArcGIS Maps SDK modules listed in app/js/sdk.js (plus the ones the tests and the terrain step import) and
// the ESM libraries the app imports from jsDelivr. Output: tools/headless/dist/.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });

// every "@arcgis/core/…" path used by the app and the tests
const root = path.resolve(here, '../..');
const sources = [];
const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, f.name);
  if (f.isDirectory() && !['node_modules', 'tools', '.git', 'backups'].includes(f.name)) walk(p);
  else if (/\.(js|html)$/.test(f.name)) sources.push(fs.readFileSync(p, 'utf8'));
} };
walk(root);
const paths = [...new Set(sources.join('\n').match(/@arcgis\/core\/[\w/.-]+\.js/g))].sort();
paths.push('@arcgis/core/config.js');
const entry = paths.map((p, i) => `import * as m${i} from '${p}';\nexport const k${i} = ('default' in m${i}) ? m${i}.default : m${i};`).join('\n')
  + `\nexport const KEYS = ${JSON.stringify(paths)};\n`;
fs.writeFileSync(path.join(dist, 'arcgis-entry.js'), entry);
await build({ entryPoints: [path.join(dist, 'arcgis-entry.js')], bundle: true, format: 'esm', outfile: path.join(dist, 'arcgis.js'),
  logLevel: 'error', splitting: false, target: 'es2022', loader: { '.css': 'empty' } });

// jsDelivr "+esm" libraries: package@version -> bundle
const libs = { 'jszip@3.10.1': 'jszip', '@tmcw/togeojson@5.8.1': '@tmcw/togeojson', 'shpjs@4.0.4': 'shpjs', 'xlsx@0.18.5': 'xlsx', 'geotiff@2.1.3': 'geotiff', 'jspdf@4.2.1': 'jspdf' };
for (const [spec, pkg] of Object.entries(libs)) {
  const out = path.join(dist, spec.replace(/[@/]/g, '_') + '.js');
  const e = path.join(dist, 'entry_' + path.basename(out));
  fs.writeFileSync(e, `import * as m from '${pkg}';\nexport * from '${pkg}';\nexport default (m.default ?? m);\n`);
  await build({ entryPoints: [e], bundle: true, format: 'esm', outfile: out, logLevel: 'error', platform: 'browser', target: 'es2022',
    define: { global: 'globalThis' } });
}
console.log(`bundled ${paths.length} SDK modules and ${Object.keys(libs).length} libraries into ${dist}`);
