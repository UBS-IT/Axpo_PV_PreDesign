// Delimited text (RFC 4180): fields in double quotes may hold the separator, line breaks and doubled quotes ("").
// The separator is the one of ; tab , that splits the first line into the most fields (outside quotes).

// first line (up to a line break outside quotes)
function firstLine(text) {
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    else if (!q && (c === '\n' || c === '\r')) return text.slice(0, i);
  }
  return text;
}

export function detectSeparator(text) {
  const line = firstLine(text);
  let best = ',', most = 0;
  for (const s of [';', '\t', ',']) {
    let n = 0, q = false;
    for (const c of line) { if (c === '"') q = !q; else if (!q && c === s) n++; }
    if (n > most) { most = n; best = s; }
  }
  return best;
}

// text -> rows of fields (strings). Empty lines are dropped; a byte order mark is ignored.
export function parseCsv(text, sep = null) {
  text = String(text ?? '').replace(/^﻿/, '');
  sep = sep || detectSeparator(text);
  const rows = [];
  let row = [], field = '', q = false, quoted = false;
  const endField = () => { row.push(quoted ? field : field.trim()); field = ''; quoted = false; };
  const endRow = () => { endField(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field.trim() === '') { q = true; quoted = true; field = ''; }
    else if (c === sep) endField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else field += c;
  }
  if (field !== '' || quoted || row.length) endRow();
  return rows;
}
