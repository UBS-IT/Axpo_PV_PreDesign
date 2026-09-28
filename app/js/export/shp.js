// Shapefiles for Engineering: one zip with a shapefile per group of objects and geometry type (areas_polygon,
// tables, fences, roads, stations, gates …), each with .shp, .shx, .dbf (UTF-8, .cpg) and the .prj of the national
// system (ESRI WKT from app/catalog/prj.json, as ArcGIS writes it). Coordinates as projected by the SDK.
import { partsOf } from './model.js';
import { loadJsZip } from '../libs.js';

const TYPE = { point: 1, polyline: 3, polygon: 5 };
let prjTable = null;
const prjJson = async () => (prjTable ||= await (await fetch(new URL('../../catalog/prj.json', import.meta.url))).json());
export async function prjFor(wkid) { return (await prjJson()).wkt[String(wkid)] || null; }
// { name, wkt (OGC WKT 1) } of a system of the app list, for GeoPackage; null when the system is not in the list
export async function srsDefinition(wkid) {
  const t = await prjJson(), k = String(wkid);
  return t.ogc?.[k] ? { name: t.name[k], wkt: t.ogc[k] } : null;
}

// records of one shapefile: [{ parts: [[[x, y], …]], attrs }], all of one type -> { shp, shx } (ArrayBuffers)
export function writeShp(type, records) {
  const code = TYPE[type];
  const contents = records.map(({ parts }) => {
    if (code === 1) { const b = new DataView(new ArrayBuffer(20)); b.setInt32(0, 1, true); b.setFloat64(4, parts[0][0][0], true); b.setFloat64(12, parts[0][0][1], true); return b; }
    const n = parts.reduce((s, p) => s + p.length, 0);
    const b = new DataView(new ArrayBuffer(44 + 4 * parts.length + 16 * n));
    const xs = parts.flat().map(p => p[0]), ys = parts.flat().map(p => p[1]);
    b.setInt32(0, code, true);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => b.setFloat64(4 + 8 * i, v, true));
    b.setInt32(36, parts.length, true); b.setInt32(40, n, true);
    let k = 0, o = 44 + 4 * parts.length;
    parts.forEach((p, i) => { b.setInt32(44 + 4 * i, k, true); k += p.length; });
    for (const p of parts.flat()) { b.setFloat64(o, p[0], true); b.setFloat64(o + 8, p[1], true); o += 16; }
    return b;
  });
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of records) for (const p of r.parts) for (const [x, y] of p) {
    if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y;
  }
  if (!isFinite(box[0])) box.fill(0);
  const header = (dv, bytes) => {
    dv.setInt32(0, 9994, false); dv.setInt32(24, bytes / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, code, true);
    box.forEach((v, i) => dv.setFloat64(36 + 8 * i, v, true));
  };
  const shpLen = 100 + contents.reduce((s, c) => s + 8 + c.byteLength, 0);
  const shp = new Uint8Array(shpLen), shx = new Uint8Array(100 + 8 * contents.length);
  const sv = new DataView(shp.buffer), xv = new DataView(shx.buffer);
  header(sv, shpLen); header(xv, shx.length);
  let o = 100;
  contents.forEach((c, i) => {
    xv.setInt32(100 + 8 * i, o / 2, false); xv.setInt32(104 + 8 * i, c.byteLength / 2, false);
    sv.setInt32(o, i + 1, false); sv.setInt32(o + 4, c.byteLength / 2, false);
    shp.set(new Uint8Array(c.buffer), o + 8);
    o += 8 + c.byteLength;
  });
  return { shp: shp.buffer, shx: shx.buffer };
}

// dBase III table, UTF-8 text. Field types from the values: numbers (N) or text (C); names cut to 10 characters.
export function writeDbf(rows) {
  const enc = new TextEncoder();
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const used = new Set();
  const fields = keys.map(k => {
    let name = k.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 10), n = 1;
    while (used.has(name)) name = name.slice(0, 9 - String(n).length) + '_' + n++;
    used.add(name);
    const vals = rows.map(r => r[k]).filter(v => v !== null && v !== undefined && v !== '');
    if (vals.length && vals.every(v => typeof v === 'number' && isFinite(v))) {
      const dec = Math.min(6, Math.max(0, ...vals.map(v => (String(v).split('.')[1] || '').length)));
      return { key: k, name, type: 'N', len: 19, dec };
    }
    const len = Math.min(254, Math.max(1, ...vals.map(v => enc.encode(String(v)).length)));
    return { key: k, name, type: 'C', len, dec: 0 };
  });
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0), headLen = 32 + 32 * fields.length + 1;
  const buf = new Uint8Array(headLen + recLen * rows.length + 1);
  const dv = new DataView(buf.buffer), d = new Date();
  buf[0] = 3; buf[1] = d.getFullYear() - 1900; buf[2] = d.getMonth() + 1; buf[3] = d.getDate();
  dv.setUint32(4, rows.length, true); dv.setUint16(8, headLen, true); dv.setUint16(10, recLen, true);
  fields.forEach((f, i) => {
    const o = 32 + 32 * i;
    buf.set(enc.encode(f.name), o); buf[o + 11] = f.type.charCodeAt(0); buf[o + 16] = f.len; buf[o + 17] = f.dec;
  });
  buf[headLen - 1] = 0x0d;
  rows.forEach((r, i) => {
    let o = headLen + recLen * i;
    buf[o++] = 0x20;
    for (const f of fields) {
      const v = r[f.key];
      let bytes;
      if (f.type === 'N') bytes = padStart(enc.encode(v == null || v === '' ? '' : Number(v).toFixed(f.dec)).slice(-f.len), f.len);
      else bytes = padEnd(cut(enc.encode(v == null ? '' : String(v)), f.len), f.len);
      buf.set(bytes, o); o += f.len;
    }
  });
  buf[buf.length - 1] = 0x1a;
  return buf.buffer;
}
const padStart = (b, n) => { const o = new Uint8Array(n).fill(0x20); o.set(b, n - b.length); return o; };
const padEnd = (b, n) => { const o = new Uint8Array(n).fill(0x20); o.set(b, 0); return o; };
// UTF-8 bytes cut to n without splitting a character
function cut(b, n) {
  if (b.length <= n) return b;
  let k = n;
  while (k > 0 && (b[k] & 0xc0) === 0x80) k--;
  return b.slice(0, k);
}

// model (export/model.js) -> { blob, files: [names], missingPrj } — a zip of shapefiles
export async function buildShapefiles(model) {
  const groups = new Map();
  for (const it of model.items) {
    const p = partsOf(it.geometry);
    if (!p || !p.parts.length || !p.parts[0].length) continue;
    // multipoints become one record per point
    const recs = p.type === 'point' ? p.parts.map(q => ({ parts: [q], attrs: it.attrs })) : [{ parts: p.parts, attrs: it.attrs }];
    const name = it.file === 'areas' ? `areas_${p.type}` : it.file;
    if (!groups.has(name)) groups.set(name, { type: p.type, records: [] });
    const g = groups.get(name);
    if (g.type === p.type) g.records.push(...recs);
  }
  const JSZip = await loadJsZip();
  const zip = new JSZip(), prj = await prjFor(model.wkid), files = [];
  for (const [name, g] of groups) {
    const { shp, shx } = writeShp(g.type, g.records);
    zip.file(name + '.shp', shp); zip.file(name + '.shx', shx); zip.file(name + '.dbf', writeDbf(g.records.map(r => r.attrs)));
    zip.file(name + '.cpg', 'UTF-8');
    if (prj) zip.file(name + '.prj', prj);
    files.push(name);
  }
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), files, missingPrj: !prj };
}
