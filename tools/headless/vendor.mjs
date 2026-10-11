// Writes the third-party libraries of the app into app/vendor/ as minified ES modules, from the exact versions
// pinned in package-lock.json, so that the app does not depend on a public CDN at run time (only the ArcGIS Maps SDK
// still comes from js.arcgis.com). The files are committed; CI rebuilds them and fails if they differ.
// Usage: npm run vendor
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../app/vendor');
const tmp = path.join(here, 'dist', 'vendor');
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(path.join(out, 'licenses'), { recursive: true });

// file in app/vendor -> npm package (version from package-lock.json); `external`: optional dependencies the app never
// reaches (jsPDF's html(), SVG and sanitising plugins; the Node.js branches of sql.js), left out to keep the file
// small; `assets`: files copied as they are (published name -> path in the package)
export const LIBS = {
  'jszip.js': { pkg: 'jszip' },
  'togeojson.js': { pkg: '@tmcw/togeojson' },
  'shpjs.js': { pkg: 'shpjs' },
  'geotiff.js': { pkg: 'geotiff' },
  'jspdf.js': { pkg: 'jspdf', external: ['html2canvas', 'dompurify', 'canvg'] },
  'sqljs.js': { pkg: 'sql.js', external: ['fs', 'path', 'crypto'], assets: { 'sql-wasm.wasm': 'dist/sql-wasm.wasm' } },
};

const lock = JSON.parse(fs.readFileSync(path.join(here, 'package-lock.json'), 'utf8'));
const manifest = {};
for (const [file, { pkg, external = [], assets = {} }] of Object.entries(LIBS)) {
  for (const [name, from] of Object.entries(assets)) fs.copyFileSync(path.join(here, 'node_modules', pkg, from), path.join(out, name));
  const version = lock.packages[`node_modules/${pkg}`].version;
  const entry = path.join(tmp, 'entry_' + file);
  fs.writeFileSync(entry, `import * as m from '${pkg}';\nexport * from '${pkg}';\nexport default (m.default ?? m);\n`);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: path.join(out, file), logLevel: 'error', platform: 'browser',
    target: 'es2022', minify: true, legalComments: 'eof', external, define: { global: 'globalThis' },
    banner: { js: `/* ${pkg}@${version} — bundled by tools/headless/vendor.mjs; license in licenses/ */` } });
  const dir = path.join(here, "node_modules", pkg);
  const lic = fs.readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  if (lic) fs.copyFileSync(path.join(dir, lic), path.join(out, 'licenses', `${pkg.replace('/', '__')}.txt`));
  manifest[file] = { package: pkg, version, license: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).license ?? null };
}
fs.writeFileSync(path.join(out, 'versions.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(Object.entries(manifest).map(([f, m]) => `${f.padEnd(14)} ${m.package}@${m.version} (${m.license}) ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} kB`).join('\n'));
