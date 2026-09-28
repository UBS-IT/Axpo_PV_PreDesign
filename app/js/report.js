// Predesign report: one A4 landscape page for prospection and engineering — the layout drawn to scale from the
// local metric frame (vector, no background map), the key figures, the assumptions with their toolkit sources and
// the checks still to do. Written with jsPDF (jsDelivr).
import { getSdk } from './sdk.js';
import { store } from './state.js';
import { t, fmt } from './i18n.js';
import { countryValue, countryName } from './catalog.js';
import { crsState } from './areas.js';
import { last } from './field.js';
import { moduleLabel, powerAge, periodLabel } from './modules.js';
import { layoutInfra, clearances } from './infra.js';
import { currentSlopeRule } from './terrain/terrain.js';
import { crsLabel } from './crs.js';
import { toSdk } from './geo/convert.js';
import { toast } from './ui/toast.js';
import { loadJsPdf } from './libs.js';

// jsPDF standard fonts cover Latin-1 only
export const pdfText = s => String(s ?? '').replace(/[–—]/g, '-').replace(/→/g, '->').replace(/≈/g, '~').replace(/…/g, '...')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xFF]/g, '');

// Everything the report shows, from the current project and layout; null when there is no layout yet
export function reportData() {
  const r = last.result, P = store.project;
  if (!r || !r.tables || !r.frame) return null;
  const f = P.field, iso = crsState.iso, country = countryName(iso) || '—';
  const frame = r.frame, area = r.area;
  const L = layoutInfra(frame, area.pre, area.base);
  const fenceLen = L.fences.reduce((s, x) => s + x.length, 0);
  const c = clearances(P);
  const kpis = [
    [t('rep.dc'), `${fmt(r.dcMWp, 2)} MWp`],
    [t('rep.module'), moduleLabel(r.module, f.powerPeriod)],
    [t('rep.structure'), f.technology === 'agri-tracker' ? t('rep.structTracker', { s: f.structure }) : t('rep.structFixed', { s: f.structure, tilt: fmt(f.tiltDeg, 0), az: fmt(f.azimuthDeg, 0) })],
    [t('rep.pitch'), `${fmt(f.pitch, 2)} m · GCR ${fmt(r.gcr, 3)}`],
    [t('rep.tables'), `${fmt(r.tables - (r.halves || 0))}${r.halves ? ` + ${fmt(r.halves)} ½` : ''} · ${fmt(r.modules)} ${t('rep.modules')}`],
    [t('rep.site'), `${fmt(r.siteArea / 1e4, 2)} ha`],
    [t('rep.buildable'), `${fmt(r.buildableArea / 1e4, 2)} ha`],
    [t('rep.density'), `${fmt(r.dcMWp / (r.siteArea / 1e4), 3)} MWp/ha`],
  ];
  if (P.specificYield > 0) kpis.push([t('rep.energy'), `${fmt(r.dcMWp * P.specificYield, 0)} MWh/yr (${fmt(P.specificYield, 0)} kWh/kWp)`]);
  if (L.fences.length) kpis.push([t('rep.fence'), L.lots.length > 1 ? t('rep.fenceVal', { m: fmt(fenceLen, 0), n: L.fences.length, lots: L.lots.length }) : `${fmt(fenceLen, 0)} m`]);
  const roadLen = L.roadLength + (r.roadsLength || 0) + L.roads.reduce((s, x) => s + x.length, 0);
  if (roadLen > 0) kpis.push([t('rep.roads'), `${fmt(roadLen, 0)} m`]);
  if (L.stations.length) kpis.push([t('rep.stations'), ['CC', 'CU', 'CT'].map(k => [k, L.stations.filter(s => s.kind === k).length]).filter(x => x[1]).map(([k, n]) => `${n} ${t('infra.kind.' + k).toLowerCase()}`).join(', ')]);
  // assumptions and where they come from
  const a = [];
  const shade = iso ? countryValue(iso, 'fixed.maxShadingAngleDeg') : null;
  if (f.technology === 'ground-fixed') a.push(shade ? t('rep.aShade', { angle: shade.value, country, src: shade.source }) : t('rep.aShadeNone', { country }));
  if (f.technology === 'agri-tracker') a.push(t('rep.aTrackerPitch'));
  const age = powerAge(r.module);
  a.push(r.power?.period ? t('rep.aPower', { wp: fmt(r.power.wp), period: periodLabel(r.power.period), date: age.date || '—' }) : t('rep.aPowerManual', { wp: fmt(r.power?.wp) }));
  if (L.fences.length) a.push(c.clearance != null ? t('rep.aFence', { m: fmt(c.clearance, 1), src: c.source === 'custom' ? t('rep.custom') : country, road: t(c.road ? 'rep.withRoad' : 'rep.withoutRoad') }) : t('infra.noClearance', { country }));
  const rule = currentSlopeRule();
  if (P.terrain.grid) a.push(rule && P.terrain.applySlopeLimit ? t('rep.aSlope', { rule: rule.text, src: P.terrain.grid.name }) : t('rep.aSlopeOff', { src: P.terrain.grid.name }));
  else a.push(t('rep.aNoTerrain'));
  a.push(t('rep.aCrs', { label: crsLabel(P.crs.wkid), wkid: P.crs.wkid || '—' }));
  // checks still to do
  const checks = [...(r.warns || []), ...L.notes.filter(n => !(r.warns || []).includes(n)), t('rep.survey')];
  const g = area.gross || area.base;
  const e = g.extent;
  const cLL = frame.toSr(new (getSdk().Point)({ x: (e.xmin + e.xmax) / 2, y: (e.ymin + e.ymax) / 2, spatialReference: frame.sr }), getSdk().SpatialReference.WGS84);
  return { title: P.name || 'Untitled project', date: new Date().toISOString().slice(0, 10), country, lon: cLL.x, lat: cLL.y,
    kpis, assumptions: a, checks, frame, result: r, infra: L };
}

// ── drawing ──
function ringsOfPolygon(g) { return (g?.rings || []).map(r => r.map(p => [p[0], p[1]])); }
export async function buildReport() {
  const d = reportData();
  if (!d) return null;
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210, M = 12;
  const txt = (s, x, y, o) => doc.text(pdfText(s), x, y, o);
  // header
  doc.setFillColor(57, 69, 207); doc.rect(0, 0, W, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(15, 23, 32);
  txt(`PV Predesign · ${d.title}`, M, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(91, 107, 123);
  txt(t('rep.sub', { date: d.date, country: d.country, lat: fmt(d.lat, 5), lon: fmt(d.lon, 5) }), M, 18.5);
  // map frame
  const mx = M, my = 24, mw = 178, mh = H - my - 16;
  doc.setDrawColor(225, 230, 235); doc.setLineWidth(0.2); doc.rect(mx, my, mw, mh, 'S');
  drawMap(doc, d, mx + 3, my + 3, mw - 6, mh - 12);
  // right column
  let x = mx + mw + 8, y = my + 2;
  const colW = W - x - M;
  const heading = s => { doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(15, 23, 32); txt(s, x, y); y += 4.6; };
  heading(t('rep.figures'));
  doc.setFontSize(8.2);
  for (const [k, v] of d.kpis) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(91, 107, 123); txt(k, x, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 32);
    const lines = doc.splitTextToSize(pdfText(v), colW - 30);
    doc.text(lines, x + 30, y);
    y += 3.9 * lines.length;
  }
  y += 2.5;
  const list = (items, colour) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...colour);
    for (const s of items) {
      const lines = doc.splitTextToSize(pdfText('- ' + s), colW);
      if (y + 3.4 * lines.length > H - 14) { doc.text('...', x, y); y += 3.4; return; }
      doc.text(lines, x, y);
      y += 3.4 * lines.length + 0.6;
    }
  };
  heading(t('rep.assumptions'));
  list(d.assumptions, [40, 50, 60]);
  y += 2;
  heading(t('rep.checks'));
  list(d.checks, [150, 90, 0]);
  // footer
  doc.setFontSize(7); doc.setTextColor(120, 130, 140); doc.setFont('helvetica', 'normal');
  txt(t('rep.footer', { date: d.date }), M, H - 6);
  return { doc, blob: doc.output('blob'), name: (d.title.replace(/[\\/:*?"<>|]+/g, '_') || 'pv-predesign') + ' - predesign.pdf', data: d };
}

function drawMap(doc, d, x0, y0, w, h) {
  const r = d.result, frame = d.frame, P = store.project;
  const g = r.area.gross || r.area.base;
  const e = g.extent;
  const pad = Math.max(e.width, e.height) * 0.04;
  const xmin = e.xmin - pad, ymin = e.ymin - pad, xmax = e.xmax + pad, ymax = e.ymax + pad;
  const s = Math.min(w / (xmax - xmin), h / (ymax - ymin));   // mm per metre
  const ox = x0 + (w - (xmax - xmin) * s) / 2, oy = y0 + (h - (ymax - ymin) * s) / 2;
  const X = p => [ox + (p[0] - xmin) * s, oy + (ymax - p[1]) * s];
  const path = rings => { const ops = []; for (const ring of rings) { if (ring.length < 2) continue; ring.forEach((p, i) => ops.push({ op: i ? 'l' : 'm', c: X(p) })); ops.push({ op: 'h', c: [] }); } return ops; };
  const lineOps = paths => { const ops = []; for (const pts of paths) pts.forEach((p, i) => ops.push({ op: i ? 'l' : 'm', c: X(p) })); return ops; };
  const alpha = a => doc.setGState(new doc.GState({ opacity: a, 'stroke-opacity': 1 }));
  const fillPoly = (rings, rgb, a, stroke = null, lw = 0.2, dash = null) => {
    if (!rings.length) return;
    doc.path(path(rings));
    if (rgb) { doc.setFillColor(...rgb); alpha(a); }
    if (stroke) { doc.setDrawColor(...stroke); doc.setLineWidth(lw); doc.setLineDashPattern(dash || [], 0); }
    if (rgb && stroke) doc.fillStrokeEvenOdd(); else if (rgb) doc.fillEvenOdd(); else doc.stroke();
    alpha(1); doc.setLineDashPattern([], 0);
  };
  const local = f => { const q = toSdk(f.geometry); return q ? frame.toLocal(q) : null; };
  // site, exclusions, linear infrastructure
  fillPoly(ringsOfPolygon(r.area.gross), [255, 140, 26], 0.06, [255, 140, 26], 0.5);
  for (const f of P.features) {
    const q = ['exclusion', 'obstacle', 'mitigation', 'agri'].includes(f.category) || f.category === 'linear' ? local(f) : null;
    if (!q) continue;
    if (q.type === 'polygon') fillPoly(ringsOfPolygon(q), [229, 72, 77], 0.22, [229, 72, 77], 0.2);
    else if (q.type === 'polyline') { doc.setDrawColor(233, 30, 140); doc.setLineWidth(0.35); doc.path(lineOps(q.paths)); doc.stroke(); }
  }
  // roads, buildable area, tables
  const L = d.infra;
  const grey = [150, 150, 150];
  for (const rd of [L.road, ...(r.roads || []), ...L.roads.map(x => x.strip)]) if (rd) fillPoly(ringsOfPolygon(rd), grey, 0.7);
  if (r.area.buildable) fillPoly(ringsOfPolygon(r.area.buildable), null, 1, [45, 190, 126], 0.25, [1.2, 0.8]);
  doc.setFillColor(57, 69, 207);
  const ops = [];
  for (const tb of r.tablesLocal) { const c = tb.corners; ops.push({ op: 'm', c: X(c[0]) }, { op: 'l', c: X(c[1]) }, { op: 'l', c: X(c[2]) }, { op: 'l', c: X(c[3]) }, { op: 'h', c: [] }); }
  if (ops.length) { doc.path(ops); doc.fill(); }
  // fences, stations, gates, lot numbers
  for (const f of L.fences) { doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.35); doc.setLineDashPattern([1.6, 0.6, 0.3, 0.6], 0); doc.path(lineOps(f.rings)); doc.stroke(); }
  doc.setLineDashPattern([], 0);
  const COL = { CC: [31, 153, 204], CU: [110, 170, 60], CT: [233, 120, 30] };
  for (const st of L.stations) fillPoly(ringsOfPolygon(st.footprint), COL[st.kind], 1, [255, 255, 255], 0.15);
  doc.setFillColor(30, 30, 30);
  for (const gt of L.gates) { const [gx, gy] = X(gt.point); doc.rect(gx - 0.9, gy - 0.9, 1.8, 1.8, 'F'); }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(20, 30, 40);
  if (L.lots.length > 1) for (const l of L.lots) { const [lx, ly] = X(l.label); doc.text(pdfText(L.fences.some(fc => fc.lots.length > 1 && fc.letter === l.fence) ? `${l.n} ${l.fence}` : String(l.n)), lx, ly, { align: 'center' }); }
  // scale bar and north arrow (the local frame is aligned with true north at the site)
  const nice = m => { const p = 10 ** Math.floor(Math.log10(m)); return [1, 2, 5, 10].map(k => k * p).filter(v => v <= m).pop(); };
  const bar = nice((xmax - xmin) / 4), bx = x0 + 2, by = y0 + h + 6;
  doc.setDrawColor(20, 30, 40); doc.setFillColor(20, 30, 40); doc.setLineWidth(0.3);
  doc.rect(bx, by - 1.2, bar * s / 2, 1.2, 'F'); doc.rect(bx + bar * s / 2, by - 1.2, bar * s / 2, 1.2, 'S');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(20, 30, 40);
  doc.text(`0`, bx, by + 3); doc.text(`${fmt(bar, 0)} m`, bx + bar * s, by + 3, { align: 'center' });
  doc.text(pdfText(t('rep.scale', { n: fmt(Math.round(1000 / s / 100) * 100) })), bx + bar * s + 8, by);
  const nx = x0 + w - 6, ny = y0 + 4;
  doc.path([{ op: 'm', c: [nx, ny] }, { op: 'l', c: [nx + 2.2, ny + 6] }, { op: 'l', c: [nx, ny + 4.6] }, { op: 'l', c: [nx - 2.2, ny + 6] }, { op: 'h', c: [] }]);
  doc.fill();
  doc.setFont('helvetica', 'bold'); doc.text('N', nx, ny + 9.5, { align: 'center' });
  // legend
  const items = [[[255, 140, 26], t('cat.gross')], [[229, 72, 77], t('rep.lgExcl')], [[57, 69, 207], t('rep.lgTables')], [grey, t('infra.roads')], [[40, 40, 40], t('infra.fence')]];
  let lx = x0 + w - 2;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
  for (const [rgb, label] of items.reverse()) {
    const tw = doc.getTextWidth(pdfText(label));
    lx -= tw; doc.setTextColor(40, 50, 60); doc.text(pdfText(label), lx, by);
    lx -= 3.6; doc.setFillColor(...rgb); doc.rect(lx, by - 2.2, 2.6, 2.6, 'F'); lx -= 3.5;
  }
}

export async function exportReport() {
  let out;
  try { out = await buildReport(); }
  catch (e) { console.error(e); toast(t('rep.fail', { err: e.message || e }), 'err', 10000); return null; }
  if (!out) { toast(t('rep.noLayout'), 'err'); return null; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(out.blob); a.download = out.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('rep.done', { file: out.name }), 'ok');
  return out;
}
