// Values of an Excel workbook (.xlsx / .xlsm, Office Open XML): a zip of XML parts read with JSZip and DOMParser.
// Only what the importers need: per sheet its name, whether it is hidden and its cells as rows of values — numbers,
// text (shared, inline or rich text), booleans, and the value last computed by Excel for formulas. Styles, dates
// (they stay serial numbers), macros and merged cells (the value sits in the first cell only) are not interpreted.
// Old binary workbooks (.xls) are not read: they must be saved as .xlsx first.
import { loadJsZip } from '../libs.js';

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const els = (node, name) => node ? [...node.getElementsByTagNameNS('*', name)] : [];
const first = (node, name) => els(node, name)[0] || null;
// _xHHHH_ escapes of characters XML cannot hold
const unescape = s => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
// text of a string item: its <t> runs, without phonetic hints (<rPh>)
const textOf = node => els(node, 't').filter(e => e.parentNode?.localName !== 'rPh').map(e => unescape(e.textContent)).join('');

// "AB12" -> column index 27 (zero based)
export function columnIndex(ref) {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// a part path from a relationship target (relative to xl/ or absolute from the package root)
const partPath = target => target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');

async function xml(zip, path) {
  const f = zip.file(path) || zip.file(Object.keys(zip.files).find(k => k.toLowerCase() === path.toLowerCase()) || '');
  if (!f) return null;
  const doc = new DOMParser().parseFromString(await f.async('text'), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('invalid XML in ' + path);
  return doc;
}

function cellValue(c, shared) {
  const type = c.getAttribute('t') || 'n';
  if (type === 'inlineStr') return textOf(first(c, 'is'));
  const v = first(c, 'v');
  if (!v) return '';
  const s = v.textContent;
  if (type === 's') return shared[Number(s)] ?? '';
  if (type === 'b') return s === '1';
  if (type === 'n') { const n = Number(s); return s.trim() !== '' && isFinite(n) ? n : s; }
  return unescape(s);   // str (formula text), e (error such as #N/A), d (ISO date)
}

// ArrayBuffer | Blob -> [{ name, hidden, aoa }]; aoa: rows from row 1, each padded with '' to the widest row
export async function readWorkbook(data) {
  const JSZip = await loadJsZip();
  let zip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('not an .xlsx / .xlsm workbook'); }
  const wb = await xml(zip, 'xl/workbook.xml');
  if (!wb) throw new Error('not an .xlsx / .xlsm workbook');
  const rels = await xml(zip, 'xl/_rels/workbook.xml.rels');
  const targets = new Map(els(rels, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sst = await xml(zip, 'xl/sharedStrings.xml');
  const shared = els(sst, 'si').map(textOf);
  const out = [];
  for (const sh of els(wb, 'sheet')) {
    const id = sh.getAttributeNS(REL_NS, 'id') || [...sh.attributes].find(a => a.localName === 'id')?.value;
    const target = targets.get(id);
    const doc = target ? await xml(zip, partPath(target)) : null;
    if (!doc || !first(doc, 'sheetData')) continue;   // chart sheets and dialog sheets carry no cells
    const rows = [];
    let r = -1, width = 0;
    for (const row of els(first(doc, 'sheetData'), 'row')) {
      r = row.hasAttribute('r') ? Number(row.getAttribute('r')) - 1 : r + 1;
      const vals = [];
      let c = -1;
      for (const cell of els(row, 'c')) {
        c = cell.hasAttribute('r') ? columnIndex(cell.getAttribute('r')) : c + 1;
        vals[c] = cellValue(cell, shared);
      }
      rows[r] = vals;
      width = Math.max(width, vals.length);
    }
    const aoa = Array.from(rows, row => Array.from({ length: width }, (_, i) => row?.[i] ?? ''));
    const state = sh.getAttribute('state');
    out.push({ name: sh.getAttribute('name') || '', hidden: state === 'hidden' || state === 'veryHidden', aoa });
  }
  return out;
}
