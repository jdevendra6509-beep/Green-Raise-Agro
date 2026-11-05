// Server side of the New Entry page. Checks the dashboard password, then reads from or
// writes to the Google Sheet through its Apps Script web app. The sheet's secret
// (SHEET_SECRET) and address (SHEET_WEBAPP_URL) stay in Vercel's environment.
const crypto = require('node:crypto');

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function checkEntry(en) {
  if (!en || typeof en !== 'object') return 'No entry was sent.';
  if (!DAY.test(en.date || '')) return 'Enter a valid date.';
  if (!['IN', 'OUT', 'ADJ'].includes(en.type)) return 'Choose Inward, Outward or Adjustment.';
  if (!Array.isArray(en.lines) || !en.lines.length) return 'Add at least one item.';
  if (en.lines.length > 100) return 'An entry can have at most 100 items.';
  for (const l of en.lines) {
    if (!l || !String(l.item || '').trim()) return 'Every line needs an item.';
    const q = Number(l.qty);
    if (!isFinite(q) || q === 0) return `Enter a quantity for ${l.item}.`;
    if (en.type !== 'ADJ' && q < 0) return `Quantity for ${l.item} must be more than zero.`;
  }
  for (const k of ['party', 'bill', 'narration', 'by']) if (en[k] && String(en[k]).length > 300) return 'One of the text fields is too long.';
  return null;
}

const MASTERS = ['Items', 'Customers', 'Vendors'];
const cleanValue = v => typeof v === 'number' && isFinite(v) ? v : String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 500);
function cleanRecord(r) {
  const o = {};
  for (const [k, v] of Object.entries(r || {}).slice(0, 80)) { const key = String(k).trim().slice(0, 60); if (key) o[key] = cleanValue(v); }
  return o;
}
function checkDoc(d) {
  if (!d || typeof d !== 'object') return 'No document was sent.';
  if (!['Proforma Invoice', 'Purchase Order'].includes(d.type)) return 'Unknown document type.';
  if (!DAY.test(d.date || '')) return 'Enter the document date.';
  if (!String(d.party || '').trim()) return 'Choose the party.';
  if (!Array.isArray(d.lines) || !d.lines.length || d.lines.length > 200) return 'Add between 1 and 200 items.';
  for (const l of d.lines) {
    if (!String(l.item || '').trim()) return 'Every line needs an item.';
    if (!isFinite(Number(l.qty)) || Number(l.qty) <= 0) return `Enter a quantity for ${l.item}.`;
  }
  return null;
}
function checkMaster(b) {
  if (!MASTERS.includes(b.master)) return 'Unknown master.';
  if (b.action === 'masterAddColumn') {
    const c = String(b.column || '').trim();
    if (!c || c.length > 60) return 'Column names must be 1 to 60 characters.';
    if (/^id$/i.test(c)) return 'That column name is reserved.';
  }
  if (b.action === 'masterSave' && (!b.record || typeof b.record !== 'object')) return 'Nothing to save.';
  if (b.action === 'masterDelete' && !b.id) return 'Choose a record to delete.';
  if (b.action === 'masterBulkAdd' && (!Array.isArray(b.records) || b.records.length > 5000)) return 'Send between 1 and 5,000 records.';
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password || !same(req.headers['x-dashboard-password'] || '', password)) {
    return res.status(401).json({ ok: false, error: 'The dashboard password is wrong.' });
  }
  const url = process.env.SHEET_WEBAPP_URL, secret = process.env.SHEET_SECRET;
  if (!url || !secret) return res.status(503).json({ ok: false, error: 'not-configured' });

  try {
    let r;
    if (req.method === 'GET') {
      r = await fetch(`${url}?action=list&secret=${encodeURIComponent(secret)}`, { redirect: 'follow' });
    } else if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      let payload;
      if (body.action === 'add') {
        const err = checkEntry(body.entry);
        if (err) return res.status(400).json({ ok: false, error: err });
        const en = body.entry;
        payload = { action: 'add', entry: {
          date: en.date, type: en.type, party: String(en.party || '').trim(), bill: String(en.bill || '').trim(),
          narration: String(en.narration || '').trim(), by: String(en.by || '').trim(),
          lines: en.lines.map(l => ({ item: String(l.item).replace(/\s+/g, ' ').trim(), qty: Number(l.qty),
            counted: l.counted === null || l.counted === undefined || l.counted === '' ? null : Number(l.counted) })) } };
      } else if (body.action === 'docSave') {
        const err = checkDoc(body.doc);
        if (err) return res.status(400).json({ ok: false, error: err });
        const d = body.doc, t = v => cleanValue(v === undefined ? '' : v);
        payload = { action: 'docSave', doc: {
          type: d.type, no: t(d.no), date: d.date, due: DAY.test(d.due || '') ? d.due : '', party: t(d.party), address: String(d.address || '').trim().slice(0, 500),
          gstin: t(d.gstin), state: t(d.state), ref: t(d.ref), payment: t(d.payment), dispatch: t(d.dispatch), destination: t(d.destination),
          delivery: t(d.delivery), narration: t(d.narration), by: t(d.by), replaces: d.replaces ? String(d.replaces) : '',
          lines: d.lines.map(l => ({ item: t(l.item), hsn: t(l.hsn), qty: Number(l.qty), unit: t(l.unit), rate: Number(l.rate) || 0, disc: Number(l.disc) || 0, gst: Number(l.gst) || 0, amount: Number(l.amount) || 0 })) } };
      } else if (body.action === 'docDelete' && body.id) {
        payload = { action: 'docDelete', id: String(body.id) };
      } else if (body.action === 'companySave' && body.company && typeof body.company === 'object') {
        payload = { action: 'companySave', company: cleanRecord(body.company) };
      } else if (/^master(Save|Delete|AddColumn|BulkAdd)$/.test(body.action || '')) {
        const err = checkMaster(body);
        if (err) return res.status(400).json({ ok: false, error: err });
        payload = { action: body.action, master: body.master, id: body.id, column: body.column && String(body.column).trim(),
          record: body.record && cleanRecord(body.record), records: Array.isArray(body.records) ? body.records.map(cleanRecord) : undefined };
      } else if (body.action === 'delete' && body.id) {
        payload = { action: 'delete', id: String(body.id) };
      } else {
        return res.status(400).json({ ok: false, error: 'Unknown request.' });
      }
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, secret }), redirect: 'follow' });
    } else {
      return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    }
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { return res.status(502).json({ ok: false, error: 'The Google Sheet did not answer properly. Check the Apps Script deployment.' }); }
    return res.status(j.ok ? 200 : 502).json(j);
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'Could not reach the Google Sheet. Try again.' });
  }
};
