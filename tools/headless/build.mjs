// Bundles the ArcGIS Maps SDK modules used by the app and the tests (the only library the app loads from a CDN), so
// that run.mjs can serve them locally. The other libraries are vendored in app/vendor (vendor.mjs).
// Output: tools/headless/dist/.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
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

console.log(`bundled ${paths.length} SDK modules into ${dist}`);
