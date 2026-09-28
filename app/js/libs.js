// Third-party libraries, served by the app itself from app/vendor (minified ES modules of pinned npm versions, built
// by tools/headless/vendor.mjs; list and licenses in app/vendor/versions.json). Each is loaded on first use. Only the
// ArcGIS Maps SDK still comes from a CDN (js.arcgis.com, see sdk.js).
export const loadJsZip = async () => (await import('../vendor/jszip.js')).default;
export const loadToGeoJSON = () => import('../vendor/togeojson.js');
export const loadShp = async () => { const m = await import('../vendor/shpjs.js'); return m.default || m; };
export const loadGeoTiff = () => import('../vendor/geotiff.js');
export const loadJsPdf = async () => { const m = await import('../vendor/jspdf.js'); return m.jsPDF || m.default?.jsPDF || m.default; };
// SQLite in WebAssembly (GeoPackage export); the .wasm sits next to the module
let sql = null;
export const loadSqlJs = () => (sql ||= import('../vendor/sqljs.js').then(m => (m.default || m)({
  locateFile: f => new URL('../vendor/' + f, import.meta.url).href })));
