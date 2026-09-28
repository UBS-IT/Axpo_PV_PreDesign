// GeoPackage (OGC 12-128, version 1.3) for Engineering: one SQLite file with a feature table per kind of object
// (the same groups as the Shapefile export), in the national system of 4 · Output, written with sql.js (SQLite in
// WebAssembly, app/vendor). Geometries are standard GeoPackage blobs (header + little-endian WKB); polygons are
// multipolygons with outer rings counter-clockwise, lines multilinestrings. Opened by ArcGIS Pro, QGIS and GDAL.
import { partsOf } from './model.js';
import { srsDefinition } from './shp.js';
import { loadSqlJs } from '../libs.js';

const WGS84_WKT = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],' +
  'PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]';

// ── geometry ──
const signedArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; };
function inRing([x, y], r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const closed = r => (r.length && (r[0][0] !== r.at(-1)[0] || r[0][1] !== r.at(-1)[1]) ? [...r, r[0]] : r);
// rings of an ESRI polygon (outer rings clockwise, holes anticlockwise, in any order) -> polygons [[outer, ...holes]]
// with the OGC orientation (outer anticlockwise, holes clockwise)
export function polygonsOf(rings) {
  const rs = rings.map(closed).filter(r => r.length >= 4);
  const outers = rs.filter(r => signedArea(r) < 0), holes = rs.filter(r => signedArea(r) > 0);
  const polys = outers.map(o => [o.slice().reverse()]);
  for (const h of holes) {
    // the smallest outer ring holding the hole
    let best = -1, bestArea = Infinity;
    outers.forEach((o, i) => { const a = -signedArea(o); if (a < bestArea && inRing(h[0], o)) { best = i; bestArea = a; } });
    if (best >= 0) polys[best].push(h.slice().reverse());
    else polys.push([h]);   // an anticlockwise ring alone is an outer ring written the other way round
  }
  return polys;
}

// { type: 'MULTIPOLYGON' | 'MULTILINESTRING' | 'POINT', wkb: Uint8Array, box: [minx, miny, maxx, maxy] }
export function toWkb(p) {
  const out = [];
  let size = 0;
  const u8 = v => { out.push(['u8', v]); size += 1; }, u32 = v => { out.push(['u32', v]); size += 4; }, f64 = v => { out.push(['f64', v]); size += 8; };
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const pt = ([x, y]) => { f64(x); f64(y); if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y; };
  const pts = r => { u32(r.length); r.forEach(pt); };
  let type;
  if (p.type === 'point') { type = 'POINT'; u8(1); u32(1); pt(p.parts[0][0]); }
  else if (p.type === 'polyline') {
    type = 'MULTILINESTRING';
    const ls = p.parts.filter(l => l.length >= 2);
    u8(1); u32(5); u32(ls.length);
    for (const l of ls) { u8(1); u32(2); pts(l); }
  } else {
    type = 'MULTIPOLYGON';
    const polys = polygonsOf(p.parts);
    u8(1); u32(6); u32(polys.length);
    for (const poly of polys) { u8(1); u32(3); u32(poly.length); poly.forEach(pts); }
  }
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  let o = 0;
  for (const [k, v] of out) {
    if (k === 'u8') { dv.setUint8(o, v); o += 1; } else if (k === 'u32') { dv.setUint32(o, v, true); o += 4; } else { dv.setFloat64(o, v, true); o += 8; }
  }
  return { type, wkb: new Uint8Array(buf), box };
}

// GeoPackage geometry blob: "GP", version 0, flags (little endian, xy envelope except for points), srs_id, envelope
export function gpkgBlob(g, srsId) {
  const env = g.type !== 'POINT';
  const head = new DataView(new ArrayBuffer(8 + (env ? 32 : 0)));
  head.setUint8(0, 0x47); head.setUint8(1, 0x50); head.setUint8(2, 0); head.setUint8(3, env ? 0b011 : 0b001);
  head.setInt32(4, srsId, true);
  if (env) [g.box[0], g.box[2], g.box[1], g.box[3]].forEach((v, i) => head.setFloat64(8 + 8 * i, v, true));   // minx, maxx, miny, maxy
  const out = new Uint8Array(head.byteLength + g.wkb.length);
  out.set(new Uint8Array(head.buffer), 0); out.set(g.wkb, head.byteLength);
  return out;
}

// ── attributes ──
const q = s => `"${String(s).replace(/"/g, '""')}"`;
function columnsOf(rows) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => !/^(fid|geom)$/i.test(k));
  return keys.map(k => {
    const vals = rows.map(r => r[k]).filter(v => v !== null && v !== undefined && v !== '');
    const type = vals.length && vals.every(v => typeof v === 'number' && isFinite(v)) ? (vals.every(Number.isInteger) ? 'INTEGER' : 'REAL') : 'TEXT';
    return { key: k, type };
  });
}

// model (export/model.js) -> { bytes: Uint8Array, tables: [names] }
export async function buildGeoPackage(model) {
  const groups = new Map();
  for (const it of model.items) {
    const p = partsOf(it.geometry);
    if (!p || !p.parts.length || !p.parts[0].length) continue;
    const recs = p.type === 'point' ? p.parts.map(part => ({ p: { type: 'point', parts: [part] }, attrs: it.attrs })) : [{ p, attrs: it.attrs }];
    const name = it.file === 'areas' ? `areas_${p.type}` : it.file;
    if (!groups.has(name)) groups.set(name, { type: p.type, records: [] });
    const g = groups.get(name);
    if (g.type === p.type) g.records.push(...recs);
  }
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    const srs = model.wkid;
    db.run(`PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, organization TEXT NOT NULL,
        organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '',
        last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER,
        CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL,
        z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name), CONSTRAINT uk_gc_table_name UNIQUE (table_name),
        CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name), CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id));`);
    const def = await srsDefinition(srs);
    const ins = db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)');
    ins.run(['Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system']);
    ins.run(['Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system']);
    ins.run(['WGS 84 geodetic', 4326, 'EPSG', 4326, WGS84_WKT, 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid']);
    if (srs !== 4326) ins.run([def?.name || `EPSG:${srs}`, srs, 'EPSG', srs, def?.wkt || 'undefined', null]);
    ins.free();
    const tables = [];
    for (const [name, g] of groups) {
      const cols = columnsOf(g.records.map(r => r.attrs));
      const geoms = g.records.map(r => toWkb(r.p));
      const gtype = geoms[0].type;
      db.run(`CREATE TABLE ${q(name)} (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, geom ${gtype}${cols.map(c => `, ${q(c.key)} ${c.type}`).join('')})`);
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const w of geoms) { box[0] = Math.min(box[0], w.box[0]); box[1] = Math.min(box[1], w.box[1]); box[2] = Math.max(box[2], w.box[2]); box[3] = Math.max(box[3], w.box[3]); }
      db.run('INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, 'features', name, 'PV Predesign', box[0], box[1], box[2], box[3], srs]);
      db.run('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, 0, 0)', [name, 'geom', gtype, srs]);
      const st = db.prepare(`INSERT INTO ${q(name)} (geom${cols.map(c => ', ' + q(c.key)).join('')}) VALUES (?${', ?'.repeat(cols.length)})`);
      db.run('BEGIN');
      g.records.forEach((r, i) => st.run([gpkgBlob(geoms[i], srs), ...cols.map(c => {
        const v = r.attrs[c.key];
        return v === undefined || v === '' && c.type !== 'TEXT' ? null : c.type === 'TEXT' ? (v == null ? null : String(v)) : v;
      })]));
      db.run('COMMIT');
      st.free();
      tables.push(name);
    }
    return { bytes: db.export(), tables };
  } finally { db.close(); }
}
