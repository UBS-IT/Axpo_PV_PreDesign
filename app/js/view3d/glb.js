// glTF 2.0 binary (.glb) of the 3D layout, for SketchUp, Blender, Twinmotion and other renderers. Metres, Y up:
// glTF x = east, y = up, z = south, relative to an origin (the centre of the site frame at a base elevation, both in
// asset.extras with the national coordinates of the origin), so the numbers stay small and the float32 precision
// stays below a millimetre.

// parts: [{ name, positions: Float64Array (local x east, y north, z elevation), faces: Uint32Array, color: [r, g, b, a]
// 0..1, doubleSided }], origin: [x, y, z] subtracted from the positions, extras: free JSON -> ArrayBuffer
export function writeGlb(parts, origin = [0, 0, 0], extras = {}) {
  parts = parts.filter(p => p && p.positions?.length && p.faces?.length);
  const chunks = [], views = [], accessors = [], meshes = [], nodes = [], materials = [];
  let offset = 0;
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length + pad;
    return views.length - 1;
  };
  for (const p of parts) {
    const n = p.positions.length / 3, pos = new Float32Array(n * 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = p.positions[3 * i] - origin[0], y = p.positions[3 * i + 2] - origin[2], z = -(p.positions[3 * i + 1] - origin[1]);
      pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = z;
      [x, y, z].forEach((v, k) => { const f = Math.fround(v); if (f < min[k]) min[k] = f; if (f > max[k]) max[k] = f; });
    }
    const pv = push(pos, 34962), iv = push(p.faces instanceof Uint32Array ? p.faces : Uint32Array.from(p.faces), 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: n, type: 'VEC3', min, max });
    accessors.push({ bufferView: iv, componentType: 5125, count: p.faces.length, type: 'SCALAR' });
    const [r, g, b, a = 1] = p.color || [0.6, 0.6, 0.6, 1];
    materials.push({ name: p.name, doubleSided: !!p.doubleSided, alphaMode: a < 1 ? 'BLEND' : 'OPAQUE',
      pbrMetallicRoughness: { baseColorFactor: [r, g, b, a], metallicFactor: p.metallic ?? 0, roughnessFactor: p.roughness ?? 0.9 } });
    meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, material: materials.length - 1 }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1 });
  }
  const json = { asset: { version: '2.0', generator: 'PV Predesign', extras }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: offset }] };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(jsonBytes, 20);
  let o = 20 + jsonLen;
  dv.setUint32(o, offset, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// .glb -> { json, bin } (for the tests and for checking a file)
export function readGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const bl = dv.getUint32(20 + jl, true);
  return { json, bin: buf.slice(28 + jl, 28 + jl + bl) };
}

// meshes { positions, faces } -> one mesh (or null when the list is empty)
export function mergeMeshes(list) {
  const ok = list.filter(Boolean);
  if (!ok.length) return null;
  const positions = new Float64Array(ok.reduce((s, x) => s + x.positions.length, 0)), faces = new Uint32Array(ok.reduce((s, x) => s + x.faces.length, 0));
  let pv = 0, pf = 0;
  for (const x of ok) { positions.set(x.positions, pv); faces.set(x.faces.map(i => i + pv / 3), pf); pv += x.positions.length; pf += x.faces.length; }
  return { positions, faces };
}

// The layout of a 3D model (model.js) as a .glb: terrain of step 0 around the site (when loaded), modules, stations,
// fences, gates and obstacles, one node each. national: { wkid, x, y } of the origin, written in the extras.
export function layoutGlb(m, terrain = null, national = null) {
  const part = (name, mesh, look) => mesh && { name, ...mesh, ...look };
  const parts = [
    part('Terrain', terrain, { color: [0.55, 0.52, 0.42, 1] }),
    part('Modules', m.tables, { color: [0.08, 0.13, 0.3, 1], doubleSided: true, metallic: 0.3, roughness: 0.35 }),
    part('Stations', mergeMeshes(m.stations.map(s => s.mesh)), { color: [0.85, 0.83, 0.78, 1] }),
    part('Fence', mergeMeshes(m.fences.map(f => f.mesh)), { color: [0.35, 0.4, 0.35, 0.45], doubleSided: true }),
    part('Gates', mergeMeshes(m.gates), { color: [0.2, 0.33, 0.25, 1] }),
    part('Obstacles', mergeMeshes(m.obstacles.map(o => o.mesh)), { color: [0.3, 0.45, 0.25, 1] }),
  ].filter(Boolean);
  let zmin = Infinity;
  for (const p of parts) for (let i = 2; i < p.positions.length; i += 3) if (p.positions[i] < zmin) zmin = p.positions[i];
  const base = Number.isFinite(zmin) ? Math.floor(zmin) : 0;
  const extras = { units: 'metre', axes: 'x east, y up, z south',
    origin: { lon: m.frame.lon0, lat: m.frame.lat0, elevation: base, frame: 'transverse Mercator centred on the site, scale 1' },
    national, trackerAngleDeg: m.h.tracker ? m.angle : null };
  return { buffer: writeGlb(parts, [0, 0, base], extras), parts: parts.map(p => p.name), base };
}
