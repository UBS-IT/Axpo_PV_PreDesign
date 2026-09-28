// File readers for step 1: Geoportale projects (.axpo), GeoJSON, KML, KMZ, zipped Shapefiles and CSV points.
// Readers return raw objects { name, geometry, sourceCategory, kind, properties }; the category is decided
// afterwards (categories.js). Files with projected coordinates and no declared system are flagged (needsCrs).
import { t } from '../i18n.js';
import { looksProjected } from '../crs.js';
import { loadJsZip, loadToGeoJSON, loadShp } from '../libs.js';
import { parseCsv } from './csv.js';

export async function readAnyFile(file) {
  const n = file.name.toLowerCase();
  const ext = n.split('.').pop();
  let res;
  if (ext === 'axpo') res = await readAxpo(file);
  else if (ext === 'geojson' || ext === 'json') res = await readGeoJSON(file);
  else if (ext === 'kml') res = await readKml(await file.text(), file.name);
  else if (ext === 'kmz') res = await readKmz(file);
  else if (ext === 'zip') res = await readShpZip(file);
  else if (ext === 'csv' || ext === 'txt') res = await readCsv(file);
  else if (ext === 'dwg' || ext === 'dxf') throw new Error(t('err.cadNext'));
  else throw new Error(t('err.unsupported'));
  if (!res.features.length) throw new Error(t('err.noFeatures'));
  // objects with their own system (Shapefile layers with a .prj) are converted with it; the others need the
  // declared system of the file, or one chosen by the user when their coordinates are in metres
  const xy = sampleCoords(res.features.filter(f => !f.srcWkt));
  res.needsCrs = !res.declaredWkid && looksProjected(xy);
  res.sample = xy;
  return res;
}

// ── Geoportale project ──
export async function readAxpo(file) {
  const JSZip = await loadJsZip();
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new Error(t('err.axpoNotProject')); }
  const pj = zip.file('progetto.json');
  if (!pj) throw new Error(t('err.axpoNotProject'));
  const st = JSON.parse(await pj.async('text'));
  if (!st || st.formato !== 'geoportale-axpo-progetto') throw new Error(t('err.axpoNotProject'));
  const features = [];
  // the site of work (an area of AREAS COLLECTION on the portal) is the gross area
  if (st.site && st.site.geom) {
    const s = st.site;
    features.push({ name: `Site ${s.code || s.comune || ''}`.trim(), geometry: s.geom, sourceCategory: 'AREAS COLLECTION', kind: 'site',
      properties: { category: 'gross', project_code: s.code || null, area_guid: s.guid || null } });
  }
  for (const rec of st.toolGeoms || []) {
    const a = rec.a || {}, g = rec.g;
    if (!g) continue;
    const name = a.nome || a.categoria || ({ drawing: 'Drawing', buffer: 'Buffer', import: 'Imported' })[a._kind] || 'Object';
    // drawings with the site-features model carry their codes (sf_*): no guessing
    const properties = a.sf_cat ? { category: a.sf_cat, type: a.sf_type, buffer: a.sf_buffer, height: a.sf_height, width: a.sf_width,
      voltage: a.sf_voltage, project_code: a.sf_site && a.sf_site.code, note: a.note } : {};
    features.push({ name: String(name), geometry: g, sourceCategory: a.categoria || '', kind: a._kind || '', properties });
  }
  for (const p of st.parcels || []) {
    if (!p.geometry) continue;
    const name = `Parcel ${p.comune || ''} ${p.foglio ?? ''}/${p.particella ?? ''}`.replace(/\s+/g, ' ').trim();
    features.push({ name, geometry: p.geometry, sourceCategory: 'parcel', kind: 'parcel', properties: {} });
  }
  return { type: 'axpo', name: st.nome || file.name.replace(/\.axpo$/i, ''), features, site: st.site || null };
}

// ── GeoJSON (a legacy "crs" member with an EPSG code is honoured) ──
export async function readGeoJSON(file) {
  let gj;
  try { gj = JSON.parse(await file.text()); } catch { throw new Error(t('err.badJson')); }
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj, properties: {} }];
  const features = [];
  for (const f of feats || []) {
    if (!f || !f.geometry) continue;
    const p = f.properties || {};
    for (const g of explode(f.geometry)) {
      features.push({ name: String(nameOf(p) || 'Object'), geometry: g, sourceCategory: String(p.categoria || p.layer || p.folder || ''), kind: 'geojson', properties: p });
    }
  }
  const m = /EPSG:{1,2}(\d{4,6})/i.exec(gj.crs?.properties?.name || '');
  const declaredWkid = m && Number(m[1]) !== 4326 && Number(m[1]) !== 4258 ? Number(m[1]) : null;
  return { type: 'geojson', name: file.name.replace(/\.(geo)?json$/i, ''), features, declaredWkid };
}

// ── KML / KMZ: the folder path goes to sourceCategory ──
export async function readKml(text, fileName) {
  const tg = await loadToGeoJSON();
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const features = [];
  const walk = (node, path) => {
    for (const ch of node.children || []) {
      if (ch.type === 'folder') walk(ch, [...path, ch.meta && ch.meta.name].filter(Boolean));
      else if (ch.type === 'Feature' && ch.geometry) {
        for (const g of explode(ch.geometry)) {
          const p = ch.properties || {};
          features.push({ name: String(nameOf(p) || 'Placemark'), geometry: g, sourceCategory: path.join(' / '), kind: 'kml', properties: p });
        }
      }
    }
  };
  if (typeof tg.kmlWithFolders === 'function') walk(tg.kmlWithFolders(dom), []);
  else for (const f of tg.kml(dom).features) if (f.geometry) features.push({ name: String(nameOf(f.properties || {}) || 'Placemark'), geometry: f.geometry, sourceCategory: '', kind: 'kml', properties: f.properties || {} });
  return { type: 'kml', name: fileName.replace(/\.km[lz]$/i, ''), features };
}
export async function readKmz(file) {
  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(file);
  const kn = Object.keys(zip.files).find(k => k.toLowerCase().endsWith('.kml'));
  if (!kn) throw new Error(t('err.noKml'));
  return { ...(await readKml(await zip.files[kn].async('text'), file.name)), type: 'kml' };
}

// ── Shapefile(s) in a zip ──
// Coordinates are read raw and each layer keeps its .prj (WKT): the SDK projection engine converts them later and
// also applies the datum shift of older national systems (Monte Mario, DHDN, CH1903…), which proj4 skips when
// the .prj has no TOWGS84 parameters (errors of 50-100 m).
export async function readShpZip(file) {
  const [JSZip, shp] = await Promise.all([loadJsZip(), loadShp()]);
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch (e) { throw new Error(t('err.badShp', { err: e.message || e })); }
  const byBase = new Map();
  for (const path of Object.keys(zip.files)) {
    if (zip.files[path].dir || /(^|\/)__MACOSX\//.test(path)) continue;
    const m = /^(.*)\.(shp|dbf|prj|cpg)$/i.exec(path);
    if (!m) continue;
    if (!byBase.has(m[1])) byBase.set(m[1], {});
    byBase.get(m[1])[m[2].toLowerCase()] = zip.files[path];
  }
  const features = [];
  let layers = 0;
  for (const [base, parts] of byBase) {
    if (!parts.shp) continue;
    layers++;
    let geoms, props = [];
    try {
      geoms = shp.parseShp(await parts.shp.async('arraybuffer'));
      if (parts.dbf) props = shp.parseDbf(await parts.dbf.async('arraybuffer'), parts.cpg ? (await parts.cpg.async('text')).trim() : undefined);
    } catch (e) { throw new Error(t('err.badShp', { err: e.message || e })); }
    const wkt = parts.prj ? (await parts.prj.async('text')).trim() : '';
    const layer = base.split('/').pop();
    geoms.forEach((g, i) => {
      if (!g) return;
      const p = props[i] || {};
      for (const part of explode(g)) features.push({ name: String(nameOf(p) || layer || 'Feature'), geometry: part, sourceCategory: layer, kind: 'shp', properties: p, srcWkt: wkt });
    });
  }
  if (!layers) throw new Error(t('err.badShp', { err: t('err.noShp') }));
  return { type: 'shp', name: file.name.replace(/\.zip$/i, ''), features };
}

// ── CSV of points: x/y or lon/lat (or easting/northing), optional name, type, height ──
export async function readCsv(file) {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error(t('err.noFeatures'));
  const head = rows[0].map(h => h.trim().toLowerCase());
  const find = res => head.findIndex(h => res.some(r => r.test(h)));
  const ix = find([/^(x|lon|lng|longitude|easting|est|e)$/]), iy = find([/^(y|lat|latitude|northing|nord|n)$/]);
  if (ix < 0 || iy < 0) throw new Error(t('err.csvColumns', { cols: head.join(', ') }));
  const iname = find([/^(name|nome|nom|nombre|id|label)$/]), ih = find([/^(height|h|altezza|hauteur|altura|höhe|hohe|wysokość)$/]), it = find([/^(type|tipo|categoria|category)$/]);
  // decimal comma: always with ; or tab separators, and in quoted fields such as "12,5" of a comma-separated file
  const num = s => { const v = String(s ?? '').trim(); return v === '' ? NaN : Number(/^-?\d+,\d+$/.test(v) ? v.replace(',', '.') : v); };
  const features = [];
  for (const c of rows.slice(1)) {
    const x = num(c[ix]), y = num(c[iy]);
    if (!isFinite(x) || !isFinite(y)) continue;
    const props = {};
    if (ih >= 0 && isFinite(num(c[ih]))) props.height = num(c[ih]);
    if (it >= 0) props.type = String(c[it] || '').trim();
    const name = iname >= 0 ? String(c[iname] || '').trim() : '';
    features.push({ name: name || `Point ${features.length + 1}`, geometry: { type: 'Point', coordinates: [x, y] }, sourceCategory: props.type || '', kind: 'csv', properties: props });
  }
  return { type: 'csv', name: file.name.replace(/\.(csv|txt)$/i, ''), features };
}

// ── helpers ──
function nameOf(p) { return p.name || p.nome || p.Name || p.NAME || p.NOME || p.title || p.label || p.LABEL || p.id; }

// multi-part and collections -> simple parts
function explode(g) {
  if (!g) return [];
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(explode);
  if (g.type === 'MultiPoint') return g.coordinates.map(c => ({ type: 'Point', coordinates: c }));
  return [g];
}

function firstCoord(c) { return typeof c[0] === 'number' ? c : firstCoord(c[0]); }
function sampleCoords(features) {
  const out = [];
  for (const f of features) {
    try { const c = firstCoord(f.geometry.coordinates); out.push([c[0], c[1]]); } catch {}
    if (out.length >= 50) break;
  }
  return out;
}
