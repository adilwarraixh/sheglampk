/* =========================================================
   lib/csv.js — RFC 4180 parsing and writing

   Written out rather than pulled from a package because the rules that
   matter are few and the failure modes are specific: a quoted field may
   contain commas, newlines and doubled quotes, and getting that wrong
   corrupts a product description silently rather than loudly.
   ========================================================= */

/* Parses a whole CSV document into rows of strings. Handles quoted
   fields containing delimiters and newlines, doubled quotes as an escaped
   quote, and CRLF or LF line endings. */
function parse(text, { delimiter = "," } = {}) {
  const src = String(text || "").replace(/^﻿/, "");   // strip a BOM from Excel
  const rows = [];
  let row = [], field = "", inQuotes = false, i = 0;

  while (i < src.length) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }   // "" -> literal "
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  // A file not ending in a newline still has a final field and row.
  if (field.length || row.length) { row.push(field); rows.push(row); }

  // Drop trailing blank lines, which spreadsheets add freely.
  while (rows.length && rows[rows.length - 1].every((f) => f.trim() === "")) rows.pop();
  return rows;
}

/* Rows of strings to a CSV document. */
function stringify(rows, { delimiter = "," } = {}) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /["\n\r,;\t]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(delimiter)).join("\r\n") + "\r\n";
}

/* Detects the delimiter by counting candidates in the header line only —
   a comma inside a quoted description must not vote. */
function sniffDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/)[0] || "";
  let best = ",", bestCount = -1;
  for (const d of [",", ";", "\t", "|"]) {
    let count = 0, inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && c === d) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return bestCount > 0 ? best : ",";
}

/* Turns rows into objects keyed by header, with headers normalised so
   "Product Name", "product_name" and "productname" all match. */
function toObjects(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h || "").trim());
  const keys = headers.map(normaliseHeader);
  const records = rows.slice(1).map((r, idx) => {
    const o = { __line: idx + 2 };                 // 1-based, +1 for the header
    keys.forEach((k, ci) => { if (k) o[k] = (r[ci] === undefined ? "" : String(r[ci]).trim()); });
    return o;
  });
  return { headers, keys, records };
}

const normaliseHeader = (h) =>
  String(h || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "");

module.exports = { parse, stringify, sniffDelimiter, toObjects, normaliseHeader };
