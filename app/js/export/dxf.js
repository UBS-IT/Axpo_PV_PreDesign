// DXF for Engineering (AutoCAD R12 / AC1009, read by every CAD program and by ArcGIS and QGIS): the objects in the
// national system, metres, one layer per kind of object (DXF_LAYERS in model.js); rings and paths as 2D polylines
// (closed for polygons), gates as points, labels (fence letters, stations, gates) as text on PVP_TEXT.
import { DXF_LAYERS, partsOf } from './model.js';

const num = v => (Math.round(v * 1000) / 1000).toFixed(3);
// R12 text: 7-bit safe, no line breaks
const txt = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, c => `\\U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);

export function buildDxf(model) {
  const out = [];
  const w = (code, value) => out.push(String(code), String(value));
  const used = new Map();   // layer key -> [name, colour]
  const ents = [];
  const layerOf = key => { const l = DXF_LAYERS[key] || ['PVP_' + String(key).toUpperCase().replace(/[^A-Z0-9]+/g, '_'), 7]; used.set(key, l); return l[0]; };
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = ([x, y]) => { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); };
  const text = (p, s, h) => { const layer = layerOf('text'); ents.push(() => { w(0, 'TEXT'); w(8, layer); w(10, num(p[0])); w(20, num(p[1])); w(30, '0.0'); w(40, num(h)); w(1, txt(s)); w(72, 1); w(11, num(p[0])); w(21, num(p[1])); w(31, '0.0'); }); };
  for (const it of model.items) {
    const p = partsOf(it.geometry);
    if (!p) continue;
    const layer = layerOf(it.layer);
    for (const part of p.parts) {
      part.forEach(grow);
      if (p.type === 'point') { const [x, y] = part[0]; ents.push(() => { w(0, 'POINT'); w(8, layer); w(10, num(x)); w(20, num(y)); w(30, '0.0'); }); continue; }
      const closed = p.type === 'polygon';
      const pts = closed && part.length > 1 && part[0][0] === part.at(-1)[0] && part[0][1] === part.at(-1)[1] ? part.slice(0, -1) : part;
      if (pts.length < 2) continue;
      ents.push(() => {
        w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(10, '0.0'); w(20, '0.0'); w(30, '0.0'); w(70, closed ? 1 : 0);
        for (const [x, y] of pts) { w(0, 'VERTEX'); w(8, layer); w(10, num(x)); w(20, num(y)); w(30, '0.0'); }
        w(0, 'SEQEND'); w(8, layer);
      });
    }
    if (it.label) {
      const pts = p.parts.flat();
      if (it.layer === 'fence') text(p.parts[0][0], it.label, 3);
      else { const c = pts.reduce((a, q) => [a[0] + q[0] / pts.length, a[1] + q[1] / pts.length], [0, 0]); text(c, it.label, it.layer === 'station' ? 1.2 : 2); }
    }
  }
  if (!isFinite(box[0])) box.splice(0, 4, 0, 0, 0, 0);
  // header
  w(0, 'SECTION'); w(2, 'HEADER');
  w(9, '$ACADVER'); w(1, 'AC1009');
  w(9, '$INSBASE'); w(10, '0.0'); w(20, '0.0'); w(30, '0.0');
  w(9, '$EXTMIN'); w(10, num(box[0])); w(20, num(box[1])); w(30, '0.0');
  w(9, '$EXTMAX'); w(10, num(box[2])); w(20, num(box[3])); w(30, '0.0');
  w(0, 'ENDSEC');
  // tables: the continuous line type and the layers
  w(0, 'SECTION'); w(2, 'TABLES');
  w(0, 'TABLE'); w(2, 'LTYPE'); w(70, 1);
  w(0, 'LTYPE'); w(2, 'CONTINUOUS'); w(70, 0); w(3, 'Solid line'); w(72, 65); w(73, 0); w(40, '0.0');
  w(0, 'ENDTAB');
  const layers = [['0', 7], ...[...used.values()].filter((l, i, a) => a.findIndex(m => m[0] === l[0]) === i)];
  w(0, 'TABLE'); w(2, 'LAYER'); w(70, layers.length);
  for (const [name, colour] of layers) { w(0, 'LAYER'); w(2, name); w(70, 0); w(62, colour); w(6, 'CONTINUOUS'); }
  w(0, 'ENDTAB');
  w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  for (const e of ents) e();
  w(0, 'ENDSEC');
  w(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
