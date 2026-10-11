// Writes tests/fixtures/it_dtm_plane.tif: a synthetic terrain model (invented place, invented values) for the
// terrain tests. A plane rising 12 % to the north (grid north of WGS 84 / UTM zone 33N, EPSG:32633), 4 m pixels,
// 250 × 250 pixels, float32, with a 40 × 40 m square of no-data (-9999) in the north-east corner.
// z = 100 + 0.12 · (N − N0), N0 the northing of the south edge. Usage: node make_terrain_fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../tests/fixtures/it_dtm_plane.tif');
const W = 250, H = 250, RES = 4, E0 = 317000, N0 = 5063000, NODATA = -9999;   // west and south edges
const z = new Float32Array(W * H);
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  const n = N0 + (H - r - 0.5) * RES;                 // pixel centre northing (row 0 is the north edge)
  z[r * W + c] = (c >= W - 10 && r < 10) ? NODATA : 100 + 0.12 * (n - N0);
}

// minimal little-endian TIFF: one strip, uncompressed
const tags = [];
const tag = (id, type, values) => tags.push({ id, type, values });
const SHORT = 3, LONG = 4, DOUBLE = 12, ASCII = 2;
tag(256, LONG, [W]); tag(257, LONG, [H]); tag(258, SHORT, [32]); tag(259, SHORT, [1]); tag(262, SHORT, [1]);
tag(273, LONG, [0]);                                  // strip offset, patched below
tag(277, SHORT, [1]); tag(278, LONG, [H]); tag(279, LONG, [W * H * 4]); tag(284, SHORT, [1]); tag(339, SHORT, [3]);
tag(33550, DOUBLE, [RES, RES, 0]);                    // ModelPixelScale
tag(33922, DOUBLE, [0, 0, 0, E0, N0 + H * RES, 0]);   // ModelTiepoint: corner of the first pixel
// GeoKeyDirectory: version 1.1.0, 3 keys: GTModelType = projected, GTRasterType = PixelIsArea, ProjectedCSType
tag(34735, SHORT, [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 32633]);
tag(42113, ASCII, [...Buffer.from(String(NODATA) + '\0')]);   // GDAL_NODATA
tags.sort((a, b) => a.id - b.id);

const size = { [SHORT]: 2, [LONG]: 4, [DOUBLE]: 8, [ASCII]: 1 };
const ifdOffset = 8, ifdSize = 2 + tags.length * 12 + 4;
let extra = ifdOffset + ifdSize;
const extras = [];
for (const t of tags) {
  const bytes = t.values.length * size[t.type];
  if (bytes > 4) { t.offset = extra; extras.push(t); extra += bytes + (bytes % 2); }
}
const dataOffset = extra;
tags.find(t => t.id === 273).values = [dataOffset];
const buf = Buffer.alloc(dataOffset + z.byteLength);
buf.write('II', 0); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifdOffset, 4);
const put = (t, at) => t.values.forEach((v, i) => {
  const o = at + i * size[t.type];
  if (t.type === SHORT) buf.writeUInt16LE(v, o); else if (t.type === LONG) buf.writeUInt32LE(v, o);
  else if (t.type === DOUBLE) buf.writeDoubleLE(v, o); else buf.writeUInt8(v, o);
});
buf.writeUInt16LE(tags.length, ifdOffset);
tags.forEach((t, i) => {
  const e = ifdOffset + 2 + i * 12;
  buf.writeUInt16LE(t.id, e); buf.writeUInt16LE(t.type, e + 2); buf.writeUInt32LE(t.values.length, e + 4);
  if (t.offset) buf.writeUInt32LE(t.offset, e + 8); else put(t, e + 8);
});
buf.writeUInt32LE(0, ifdOffset + 2 + tags.length * 12);
for (const t of extras) put(t, t.offset);
Buffer.from(z.buffer).copy(buf, dataOffset);
fs.writeFileSync(out, buf);
console.log(`${out}: ${W} × ${H} px of ${RES} m, ${buf.length} bytes`);
