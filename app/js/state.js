// Project state, autosave in this browser and a tiny publish/subscribe.
// The project holds inputs and parameters only; the layout is always regenerated from them (parametric).

// test pages set __PVP_TEST__ so that they never overwrite the project autosaved by the app (same origin)
const PROJECT_KEY = globalThis.__PVP_TEST__ ? 'pvp.project.test' : 'pvp.project.v1';
export const PROJECT_FORMAT = 'pv-predesign-project';
export const PROJECT_VERSION = 2;

export function defaultProject() {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: 'Untitled project',
    // coordinate system for exports and for files without a declared system; chosen automatically from the
    // site location (auto) unless the user picks one
    crs: { wkid: null, auto: true, country: null },
    // objects of the Areas step: { id, name, category, geometry (GeoJSON, WGS84), source, attrs: {...} }
    features: [],
    settings: { boundarySetback: 0 },
    plannedModules: [],       // ids from the module library
    moduleDefs: [],           // copies of the modules the project uses, written with the project file
    field: {
      technology: 'ground-fixed',
      structure: '3V9',       // group standard (catalog standards)
      moduleId: null,
      powerPeriod: null,      // roadmap period of the module power ('2027-S1'); null = the current semester
      tiltDeg: 15,
      azimuthDeg: 180,
      pitch: null,
      tableGap: 0.30,
      moduleGap: 0.02,
      tracks: { enabled: false, spacing: 100, width: 4, tables: null },   // tables: a corridor every N tables instead of every spacing m
      halfTables: false,      // half tables (half strings) where a whole one does not fit: an option of the designer
      targetMWp: null,
      rowOffset: 0,
      columnOffset: 0,
    },
    specificYield: null,
    // step 2 (optional): terrain model sampled on a grid in a local metric frame; the grid itself is kept in the
    // browser (IndexedDB) and in the project file, the project holds its description. limit: the slope limit in use,
    // null = the toolkit rule of the structure of step 3, else { maxAny } or { maxNS, maxEW } in percent chosen by
    // the designer (limitFrom 'custom') or brought by a Geoportale project ('geoportale')
    // view: the terrain image on the map, 's' slope classes or 'z' hill-shaded elevations (as on the Geoportale)
    terrain: { source: null, cellSize: 5, applySlopeLimit: true, minPatch: 250, showSlope: true, view: 's', grid: null, limit: null, limitFrom: null, contours: false, contourStep: 1 },
    // step 3: fences around the lots of the usable land (fenceGroups: lots sharing one fence, kept as points
    // [lon, lat] inside them), perimeter road (null = not decided: off, the app shows its suggestion), fence →
    // structures clearance (null = the toolkit value of the country), stations { id, kind CC|CU|CT, lon, lat, rot },
    // roads drawn by the designer { id, kind heavy|light, width, geometry LineString }
    infra: { fence: true, fenceGroups: [], perimeterRoad: null, clearance: null, stations: [], roads: [] },
    // 4b · 3D: heights (null = the toolkit value of the country), AgriPV category of the trackers (IT axis heights),
    // tracker angle following the sun at the time of the view or set by hand, saved viewpoints { id, name, camera }
    view3d: { lowEdge: null, trackerCategory: 'standard', axisHeight: null, trackerMode: 'sun', trackerAngle: 0, viewpoints: [], ground: 'dtm' },
    // dimensions drawn on the map (dims.js): { id, points: [[lon, lat], …] }, measured in the local frame when shown
    dims: [],
  };
}

export const store = { project: loadProject() };

function loadProject() {
  try {
    const p = JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null');
    if (p && p.format === PROJECT_FORMAT) return upgrade(p);
  } catch (e) { console.warn('[state] autosave unreadable', e); }
  return defaultProject();
}

// Bring a stored project to the current version and fill fields added later.
export function upgrade(p) {
  const d = defaultProject();
  const q = {
    ...d, ...p,
    crs: { ...d.crs, ...(p.crs || {}) },
    settings: { ...d.settings, ...(p.settings || {}) },
    field: { ...d.field, ...(p.field || {}), tracks: { ...d.field.tracks, ...((p.field || {}).tracks || {}) } },
    terrain: { ...d.terrain, ...(p.terrain || {}) },
    infra: { ...d.infra, ...(p.infra || {}) },
    view3d: { ...d.view3d, ...(p.view3d || {}) },
  };
  if ((p.version || 1) < 2) {
    // v1: role site|exclusion|reference and global buffers -> v2 categories with per-object attributes
    const oldSetback = p.settings?.siteSetback || 0, oldBuffer = p.settings?.exclusionBuffer || 0;
    q.settings = { boundarySetback: oldSetback };
    q.features = (p.features || []).map(f => {
      const kind = geomKind(f.geometry);
      let category = 'reference';
      const attrs = {};
      if (f.role === 'site') category = /perimetro netto/i.test(f.category || '') ? 'net' : 'gross';
      else if (f.role === 'exclusion') {
        const lin = linearTypeFor(f.category || f.name || '');
        if (kind === 'line' && lin) { category = 'linear'; attrs.type = lin; }
        else category = 'exclusion';
        if (oldBuffer > 0) attrs.buffer = oldBuffer;
      }
      return { id: f.id, name: f.name, category, geometry: f.geometry, source: f.source, attrs, sourceCategory: f.category || '' };
    });
  }
  q.version = PROJECT_VERSION;
  delete q.settings.siteSetback; delete q.settings.exclusionBuffer;
  return q;
}

export function geomKind(g) {
  if (!g) return null;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return 'polygon';
  if (g.type === 'LineString' || g.type === 'MultiLineString') return 'line';
  if (g.type === 'Point' || g.type === 'MultiPoint') return 'point';
  return null;
}

// Linear infrastructure recognised from names and categories (IT, EN, FR, ES, DE, PL)
export function linearTypeFor(text) {
  const s = String(text || '').toLowerCase().replace(/_/g, ' ');
  if (/cavidott|underground (cable|power)|câble enterré|cable enterrado|erdkabel|kabel ziemny/.test(s)) return 'underground-power';
  if (/elettrodott|power ?line|overhead|ligne (électrique|electrique|haute)|l[ií]nea el[eé]ctrica|freileitung|stromleitung|linia (energ|wysok|elektro)|\b(linea|line|ligne|l[ií]nea|linia)\s*(mt|at|bt|hta|htb|ht|hv|mv|lv)\b|\b\d+\s*kv\b/.test(s)) return 'overhead-power';
  if (/gasdott|\bgas\b|gazoduc|gasoducto|gasleitung|gazoci/.test(s)) return 'gas';
  if (/acquedott|water ?(pipe|main)|canalisation d'eau|conducci[oó]n de agua|wasserleitung|wodoci/.test(s)) return 'water';
  if (/idrograf|fosso|canal|ditch|stream|river|fossé|ruisseau|rivière|acequia|arroyo|graben|\bbach|rów|rzek/.test(s)) return 'ditch';
  if (/ferrovi|railway|\brail|chemin de fer|ferrocarril|eisenbahn|bahnstrecke|kolej/.test(s)) return 'railway';
  if (/viabilit|strada|autostrad|road|route|chemin|carretera|camino|autopista|straße|strasse|autobahn|weg\b|droga/.test(s)) return 'road';
  return null;
}

let saveTimer = 0;
export function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(PROJECT_KEY, JSON.stringify(store.project)); document.dispatchEvent(new CustomEvent('pvp:saved', { detail: new Date() })); }
    catch (e) { console.warn('[state] autosave failed (browser storage full?)', e); }
  }, 400);
}

export function replaceProject(p) {
  store.project = upgrade(p);
  saveSoon();
  emit('project');
}

// change(topic, fn): mutate the project, autosave, notify
export function change(topic, fn) {
  fn(store.project);
  saveSoon();
  emit(topic);
}

const listeners = new Map();
export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
}
export function emit(topic) {
  for (const t of [topic, '*']) (listeners.get(t) || []).forEach(fn => { try { fn(topic); } catch (e) { console.error(e); } });
}

export const uid = () => Math.random().toString(36).slice(2, 10);
