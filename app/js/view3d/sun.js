// Sun, trackers and row shading for the 3D view. Pure functions, no SDK.
// Sun position: NOAA solar calculator (Julian centuries; about 0.01° against NREL SPA for 1950-2050), without
// atmospheric refraction. Tracker angles follow the pvlib convention: horizontal single axis, positive angles turn the
// modules towards the right of the axis direction (west for an axis pointing south), limited to ± the toolkit
// rotation, stowed flat at night; no backtracking (the toolkit does not describe it).

const D = Math.PI / 180;
const mod = (a, n) => ((a % n) + n) % n;

// date (Date, absolute time), lat, lon in degrees -> { elevation, azimuth (from north, clockwise), zenith, vector:
// [east, north, up] unit vector towards the sun }
export function sunPosition(date, lat, lon) {
  const jd = date.getTime() / 864e5 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * D) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * D) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * D) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * D);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D);
  const decl = Math.asin(Math.sin(eps * D) * Math.sin(lambda * D));
  const y = Math.tan(eps * D / 2) ** 2;
  const eot = 4 / D * (y * Math.sin(2 * L0 * D) - 2 * e * Math.sin(M * D) + 4 * e * y * Math.sin(M * D) * Math.cos(2 * L0 * D)
    - 0.5 * y * y * Math.sin(4 * L0 * D) - 1.25 * e * e * Math.sin(2 * M * D));
  const minutes = mod(date.getTime() / 6e4, 1440);
  const ha = (mod(minutes + eot + 4 * lon, 1440) / 4 - 180) * D, phi = lat * D;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const azimuth = mod(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / D + 180, 360);
  const el = Math.PI / 2 - zenith;
  return { elevation: el / D, azimuth, zenith: zenith / D,
    vector: [Math.sin(azimuth * D) * Math.cos(el), Math.cos(azimuth * D) * Math.cos(el), Math.sin(el)] };
}

// Absolute time of a local solar time (hours, 12 = solar noon, ignoring the equation of time) on a calendar day at
// a longitude: what the quick buttons of the 3D panel set
export function solarTimeDate(year, month, day, hours, lon) {
  return new Date(Date.UTC(year, month - 1, day) + (hours - lon / 15) * 36e5);
}

// Horizontal unit vectors [east, north] for an axis pointing to azimuth axisAz: the axis and its right side
export function axisFrame(axisAz) {
  const a = [Math.sin(axisAz * D), Math.cos(axisAz * D)];
  return { axis: a, right: [a[1], -a[0]] };
}

// Ideal rotation of a horizontal single-axis tracker (degrees, pvlib sign), limited to ±maxDeg; 0 (stowed) at night
export function trackerAngle(sunVector, axisAz, maxDeg = 55) {
  const [sx, sy, sz] = sunVector;
  if (sz <= 0) return 0;
  const { right } = axisFrame(axisAz);
  const th = Math.atan2(sx * right[0] + sy * right[1], sz) / D;
  return Math.max(-maxDeg, Math.min(maxDeg, th));
}

// Share of a module row shaded by the next row towards the sun, on flat ground, in the section across the rows.
// width: slant width of the modules in the section; pitch: distance between rows; normalTilt: tilt of the module
// normal towards the unit horizontal direction `across` (fixed: tilt with across = facing direction; tracker:
// rotation with across = right of the axis). Returns 0..1, or null when the sun is below the horizon.
export function rowShading(sunVector, across, width, pitch, normalTilt) {
  const [sx, sy, sz] = sunVector;
  if (sz <= 0) return null;
  const sw = sx * across[0] + sy * across[1];   // sun in the section: [sw, sz]
  if (Math.abs(sw) < 1e-12) return 0;
  const b = normalTilt * D, d = [Math.cos(b), -Math.sin(b)];   // module line in the section
  const o = [Math.sign(sw) * pitch, 0];                        // the neighbour on the sun side
  const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
  const den = cross([sw, sz], d);
  if (Math.abs(den) < 1e-12) return 0;                         // sun in the plane of the modules
  const delta = cross([sw, sz], o) / den;                      // shift of the neighbour's shadow along the module line
  return Math.max(0, Math.min(1, 1 - Math.abs(delta) / width));
}
