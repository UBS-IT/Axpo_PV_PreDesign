// GeoTIFF terrain models (DTM / DSM): coordinate system, georeferencing and windows of elevations.
// Read with geotiff.js (app/vendor) straight from the file, a window at a time, so large models are not loaded whole.
import { t } from '../i18n.js';
import { loadGeoTiff } from '../libs.js';

// { width, height, epsg (null if the file does not say), geographic, origin: [x, y] of the centre of the first
// pixel, res: [rx, ry] (ry negative for north-up files), noData, bbox: [xmin, ymin, xmax, ymax], read(c0, r0, c1, r1) }
export async function openGeoTiff(file) {
  const GeoTIFF = await loadGeoTiff();
  let tiff, img;
  try { tiff = await GeoTIFF.fromBlob(file); img = await tiff.getImage(); }
  catch (e) { throw new Error(t('err.badTiff', { err: e.message || e })); }
  const keys = img.getGeoKeys() || {};
  const proj = keys.ProjectedCSTypeGeoKey, geog = keys.GeographicTypeGeoKey;
  const epsg = proj && proj !== 32767 ? proj : (!proj && geog && geog !== 32767 ? geog : null);
  let res, origin;
  try { res = img.getResolution(); origin = img.getOrigin(); }
  catch { throw new Error(t('err.tiffNotGeo')); }
  // PixelIsArea (default): the tie point is the corner of the first pixel; PixelIsPoint: its centre
  const isPoint = keys.GTRasterTypeGeoKey === 2;
  const cx = origin[0] + (isPoint ? 0 : res[0] / 2), cy = origin[1] + (isPoint ? 0 : res[1] / 2);
  const width = img.getWidth(), height = img.getHeight();
  const nd = img.getGDALNoData();
  const xs = [cx - res[0] / 2, cx + (width - 0.5) * res[0]], ys = [cy - res[1] / 2, cy + (height - 0.5) * res[1]];
  return {
    width, height, epsg, geographic: !proj && !!geog, origin: [cx, cy], res: [res[0], res[1]],
    noData: nd === null || nd === undefined ? null : Number(nd),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    samples: img.getSamplesPerPixel(),
    // elevations of the pixel window [c0, c1) × [r0, r1) as a Float32Array, row by row
    async read(c0, r0, c1, r1) {
      const data = await img.readRasters({ window: [c0, r0, c1, r1], samples: [0], interleave: true });
      return data instanceof Float32Array ? data : Float32Array.from(data);
    },
  };
}
