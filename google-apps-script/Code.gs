/**
 * Green Raise Agro Stock Entries – Google Apps Script web app.
 * Paste this into the sheet's Extensions → Apps Script, set SECRET to the value
 * stored in Vercel as SHEET_SECRET, and deploy as a Web app
 * (Execute as: Me, Who has access: Anyone).
 * Only the dashboard's server (/api/entries) knows SECRET; browsers never see it.
 */
const SECRET = 'PASTE_SHEET_SECRET_HERE';
const SHEET = 'Entries';
const HEAD = ['Entry ID', 'Date', 'Type', 'Item', 'Qty', 'Party', 'Bill No', 'Narration', 'Entered By', 'Created At', 'Status', 'Counted Stock'];
const TYPES = { IN: 'Inward', OUT: 'Outward', ADJ: 'Adjustment' };
// Masters: one sheet each. The first column is a hidden-from-users ID; any other column can be added by users.
const MASTERS = {
  Items: ['ID', 'Item Name', 'Category', 'Unit', 'HSN', 'GST %', 'MOQ', 'Max Stock', 'Lead Time (days)', 'Rate', 'Merge Into', 'Status', 'Notes'],
  Customers: ['ID', 'Customer Name', 'Contact Person', 'Phone', 'Email', 'GSTIN', 'Address', 'City', 'Credit Days', 'Notes'],
  Vendors: ['ID', 'Vendor Name', 'Contact Person', 'Phone', 'Email', 'GSTIN', 'Address', 'City', 'Lead Time (days)', 'Notes']
};
// Proforma invoices and purchase orders: one row per item line; header fields repeat on each line.
const DOCS = 'Documents';
const DOC_HEAD = ['Doc ID', 'Doc Type', 'Doc No', 'Date', 'Party', 'Party Address', 'Party GSTIN', 'Party State', 'Buyer Ref', 'Payment Terms',
  'Dispatch Through', 'Destination', 'Terms of Delivery', 'Due Date', 'Item', 'HSN', 'Qty', 'Unit', 'Rate', 'Disc %', 'GST %', 'Amount',
  'Narration', 'Created By', 'Created At', 'Status'];
const DOC_KEYS = ['id', 'type', 'no', 'date', 'party', 'address', 'gstin', 'state', 'ref', 'payment', 'dispatch', 'destination', 'delivery', 'due',
  'item', 'hsn', 'qty', 'unit', 'rate', 'disc', 'gst', 'amount', 'narration', 'by', 'created', 'status'];
// Company details printed on documents: a two-column Field / Value sheet.
const COMPANY = 'Company';
const COMPANY_FIELDS = ['Company Name', 'Address', 'City', 'State', 'State Code', 'GSTIN', 'PAN', 'Phone', 'Email', 'Bank Name', 'Account No', 'IFSC', 'Branch', 'Declaration'];
// Filled in when the Company tab is first created; edit later in Settings → Company details.
const COMPANY_DEFAULTS = {
  'Company Name': 'Green Raise Agro Pvt Ltd',
  'Address': 'Office no. 116, First Floor, Amnora Apex\nNear Amnora Mall, Hadapsar',
  'City': 'Pune 411028',
  'State': 'Maharashtra',
  'State Code': '27'
};
// text that starts like a formula is stored as plain text
const txt_ = x => { const s = String(x || ''); return /^[=+@]/.test(s) ? "'" + s : s; };

function doGet(e) { return handle_(e && e.parameter || {}); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle_(body);
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}

function master_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, MASTERS[name].length).setValues([MASTERS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function head_(sh) { return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(h => String(h).trim()); }
function newId_() { return 'M' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
function readMaster_(name, tz) {
  const sh = master_(name);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  const rows = v.slice(1).filter(r => r.some(c => c !== '')).map(r => {
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], tz, 'yyyy-MM-dd') : r[i]; });
    return o;
  });
  return { headers: head.filter(Boolean), rows: rows };
}
function rowFor_(head, rec, id) { return head.map(h => h === 'ID' ? id : (rec[h] === undefined || rec[h] === null ? '' : (typeof rec[h] === 'number' ? rec[h] : txt_(rec[h])))); }

function docs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(DOCS);
  if (!sh) { sh = ss.insertSheet(DOCS); sh.getRange(1, 1, 1, DOC_HEAD.length).setValues([DOC_HEAD]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function company_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(COMPANY);
  if (!sh) {
    sh = ss.insertSheet(COMPANY);
    sh.getRange(1, 1, 1, 2).setValues([['Field', 'Value']]).setFontWeight('bold');
    sh.getRange(2, 1, COMPANY_FIELDS.length, 2).setValues(COMPANY_FIELDS.map(f => [f, COMPANY_DEFAULTS[f] || '']));
    sh.setFrozenRows(1);
  }
  return sh;
}
function readCompany_() {
  const v = company_().getDataRange().getValues().slice(1);
  const o = {};
  v.forEach(r => { const k = String(r[0] || '').trim(); if (k) o[k] = r[1] === null || r[1] === undefined ? '' : String(r[1]); });
  return o;
}
function readDocs_(tz) {
  const v = docs_().getDataRange().getValues().slice(1).filter(r => r[0] !== '');
  return v.map(r => {
    const o = {};
    DOC_KEYS.forEach((k, i) => { const x = r[i]; o[k] = x instanceof Date ? (k === 'created' ? x.toISOString() : Utilities.formatDate(x, tz, 'yyyy-MM-dd')) : x; });
    return o;
  });
}

function handle_(p) {
  if (!p.secret || p.secret !== SECRET) return out_({ ok: false, error: 'unauthorised' });
  const sh = sheet_();
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

  if (p.action === 'add') {
    const en = p.entry || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(en.date || '') || !TYPES[en.type] || !Array.isArray(en.lines) || !en.lines.length) {
      return out_({ ok: false, error: 'Entry is missing its date, type or items.' });
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const id = Utilities.formatDate(new Date(), tz, 'yyMMdd-HHmmss') + '-' + Math.floor(100 + Math.random() * 900);
      const [y, m, d] = en.date.split('-').map(Number);
      const day = new Date(y, m - 1, d, 12);
      const now = new Date();
      const rows = en.lines.map(l => [id, day, TYPES[en.type], txt_(l.item), Number(l.qty), txt_(en.party), txt_(en.bill),
        txt_(en.narration), txt_(en.by), now, 'Active', l.counted === null || l.counted === undefined ? '' : Number(l.counted)]);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
      sh.getRange(sh.getLastRow() - rows.length + 1, 2, rows.length, 1).setNumberFormat('dd-mmm-yyyy');
      return out_({ ok: true, id: id, lines: rows.length });
    } finally { lock.releaseLock(); }
  }

  if (p.action && p.action.indexOf('master') === 0) {
    if (!MASTERS[p.master]) return out_({ ok: false, error: 'Unknown master.' });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const ms = master_(p.master);
      let head = head_(ms);
      if (p.action === 'masterAddColumn') {
        const col = String(p.column || '').trim();
        if (!col) return out_({ ok: false, error: 'Enter a column name.' });
        if (head.some(h => h.toLowerCase() === col.toLowerCase())) return out_({ ok: false, error: 'That column already exists.' });
        ms.getRange(1, head.length + 1).setValue(col).setFontWeight('bold');
        return out_({ ok: true });
      }
      const ids = ms.getLastRow() > 1 ? ms.getRange(2, 1, ms.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
      if (p.action === 'masterSave') {
        const rec = p.record || {};
        const i = rec.ID ? ids.indexOf(String(rec.ID)) : -1;
        if (i >= 0) {
          const cur = ms.getRange(i + 2, 1, 1, head.length).getValues()[0];
          const row = head.map((h, k) => h === 'ID' || !(h in rec) ? cur[k] : rowFor_([h], rec, '')[0]);
          ms.getRange(i + 2, 1, 1, head.length).setValues([row]);
          return out_({ ok: true, id: String(rec.ID) });
        }
        const id = newId_();
        ms.getRange(ms.getLastRow() + 1, 1, 1, head.length).setValues([rowFor_(head, rec, id)]);
        return out_({ ok: true, id: id });
      }
      if (p.action === 'masterBulkAdd') {
        const recs = Array.isArray(p.records) ? p.records : [];
        if (!recs.length) return out_({ ok: true, added: 0 });
        const rows = recs.map(r => rowFor_(head, r, newId_()));
        ms.getRange(ms.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
        return out_({ ok: true, added: rows.length });
      }
      if (p.action === 'masterDelete') {
        const i = ids.indexOf(String(p.id));
        if (i < 0) return out_({ ok: false, error: 'Record not found. Refresh and try again.' });
        ms.deleteRow(i + 2);
        return out_({ ok: true });
      }
      return out_({ ok: false, error: 'Unknown request.' });
    } finally { lock.releaseLock(); }
  }

  if (p.action === 'docSave' || p.action === 'docDelete' || p.action === 'companySave') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (p.action === 'companySave') {
        const sh = company_();
        const v = sh.getDataRange().getValues();
        const at = {};
        v.forEach((r, i) => { if (i > 0 && r[0] !== '') at[String(r[0]).trim()] = i + 1; });
        Object.keys(p.company || {}).forEach(k => {
          const val = txt_(p.company[k]);
          if (at[k]) sh.getRange(at[k], 2).setValue(val); else { sh.appendRow([k, val]); at[k] = sh.getLastRow(); }
        });
        return out_({ ok: true });
      }
      const sh = docs_();
      const markDeleted = id => {
        const v = sh.getDataRange().getValues();
        for (let i = 1; i < v.length; i++) if (String(v[i][0]) === String(id) && v[i][25] !== 'Deleted') sh.getRange(i + 1, 26).setValue('Deleted');
      };
      if (p.action === 'docDelete') { markDeleted(p.id); return out_({ ok: true }); }
      const d = p.doc || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '') || !Array.isArray(d.lines) || !d.lines.length) return out_({ ok: false, error: 'The document needs a date and at least one item.' });
      const id = 'D' + Utilities.formatDate(new Date(), tz, 'yyMMddHHmmss') + Math.floor(100 + Math.random() * 900);
      const dt = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return ''; const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd, 12); };
      const now = new Date();
      const rows = d.lines.map(l => [id, txt_(d.type), txt_(d.no), dt(d.date), txt_(d.party), txt_(d.address), txt_(d.gstin), txt_(d.state), txt_(d.ref), txt_(d.payment),
        txt_(d.dispatch), txt_(d.destination), txt_(d.delivery), dt(d.due), txt_(l.item), txt_(l.hsn), Number(l.qty) || 0, txt_(l.unit), Number(l.rate) || 0,
        Number(l.disc) || 0, Number(l.gst) || 0, Number(l.amount) || 0, txt_(d.narration), txt_(d.by), now, 'Active']);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, DOC_HEAD.length).setValues(rows);
      if (d.replaces) markDeleted(d.replaces);
      return out_({ ok: true, id: id });
    } finally { lock.releaseLock(); }
  }

  if (p.action === 'delete') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const v = sh.getDataRange().getValues();
      let n = 0;
      for (let i = 1; i < v.length; i++) {
        if (String(v[i][0]) === String(p.id) && v[i][10] !== 'Deleted') { sh.getRange(i + 1, 11).setValue('Deleted'); n++; }
      }
      return out_({ ok: true, deleted: n });
    } finally { lock.releaseLock(); }
  }

  // list
  const v = sh.getDataRange().getValues();
  const fmt = x => x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : String(x || '');
  const rows = v.slice(1).filter(r => r[0] !== '' && r[3] !== '').map(r => ({
    id: String(r[0]), date: fmt(r[1]), type: String(r[2]), item: String(r[3]), qty: Number(r[4]),
    party: String(r[5] || ''), bill: String(r[6] || ''), narration: String(r[7] || ''), by: String(r[8] || ''),
    created: r[9] instanceof Date ? r[9].toISOString() : String(r[9] || ''), status: String(r[10] || 'Active'),
    counted: r[11] === '' || r[11] === null ? null : Number(r[11])
  }));
  const masters = {};
  Object.keys(MASTERS).forEach(k => { masters[k] = readMaster_(k, tz); });
  return out_({ ok: true, rows: rows, masters: masters, docs: readDocs_(tz), company: readCompany_(), url: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
}
