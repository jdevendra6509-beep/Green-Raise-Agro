const crypto = require('node:crypto');
// Server side of the dashboard. Signs people in, checks what their role may do, then reads from or writes to the Google Sheet through its Apps Script web app. The sheet's secret
// (SHEET_SECRET) and address (SHEET_WEBAPP_URL) stay in Vercel's environment.
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


// ---------- sign-in ----------
// Roles: Admin can do everything; Warehouse Manager can only read entries and save Inward / Outward entries.
const ADMIN = 'Admin', WAREHOUSE = 'Warehouse Manager';
const ROLES = [ADMIN, WAREHOUSE];
const b64u = b => Buffer.from(b).toString('base64url');
const signKey = () => crypto.createHmac('sha256', process.env.AUTH_SECRET || process.env.SHEET_SECRET).update('green-raise-agro-login').digest();
function makeToken(user, days) {
  const body = b64u(JSON.stringify({ u: user.username, n: user.name || user.username, r: user.role, exp: Date.now() + days * 864e5 }));
  return body + '.' + b64u(crypto.createHmac('sha256', signKey()).update(body).digest());
}
function readToken(req) {
  const h = String(req.headers.authorization || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', signKey()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() && ROLES.includes(p.r) ? p : null; } catch (e) { return null; }
}
// password hashes: s1$<salt>$<scrypt key>, base64
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return 's1$' + salt.toString('base64') + '$' + crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64');
}
function checkPassword(pw, stored) {
  const [v, s, k] = String(stored || '').split('$');
  if (v !== 's1' || !s || !k) return false;
  const want = Buffer.from(k, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, want);
}
const pwProblem = pw => typeof pw !== 'string' || pw.length < 8 ? 'Passwords must be at least 8 characters.' : pw.length > 200 ? 'That password is too long.' : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sheet(url, secret, payload) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, secret }), redirect: 'follow' });
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { const err = new Error('The Google Sheet did not answer properly. Check the Apps Script deployment.'); err.bad = true; throw err; }
}
const OLD_SCRIPT = 'The Google Sheet script is out of date. Paste the latest google-apps-script/Code.gs into Extensions → Apps Script and deploy a new version.';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.SHEET_WEBAPP_URL, secret = process.env.SHEET_SECRET;
  if (!url || !secret) return res.status(503).json({ ok: false, error: 'not-configured' });
  const send = (code, j) => res.status(code).json(j);

  try {
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {};

    // ---- sign in (no token yet) ----
    if (req.method === 'POST' && body.action === 'login') {
      const name = String(body.username || '').trim().toLowerCase(), pw = String(body.password || '');
      if (!name || !pw) return send(400, { ok: false, error: 'Enter your username and password.' });
      const j = await sheet(url, secret, { action: 'users' });
      if (!j.ok) return send(502, j);
      if (!Array.isArray(j.users)) return send(502, { ok: false, error: OLD_SCRIPT });
      const u = j.users.find(x => String(x.username).toLowerCase() === name);
      const good = u && /^active$/i.test(u.status) && ROLES.includes(u.role) && checkPassword(pw, u.hash);
      if (!good) { await sleep(700); return send(401, { ok: false, error: 'login-failed' }); }
      const days = body.remember ? 30 : 1;
      return send(200, { ok: true, token: makeToken(u, days), user: { username: u.username, name: u.name || u.username, role: u.role } });
    }

    const me = readToken(req);
    if (!me) return send(401, { ok: false, error: 'signed-out' });
    const admin = me.r === ADMIN;
    const actor = { username: me.u, role: me.r };
    const deny = () => send(403, { ok: false, error: 'Your login (' + me.r + ') is not allowed to do this. Ask the admin.' });

    let payload;
    if (req.method === 'GET') {
      payload = { action: 'list' };
    } else if (req.method === 'POST') {
      if (body.action === 'add') {
        const err = checkEntry(body.entry);
        if (err) return send(400, { ok: false, error: err });
        const en = body.entry;
        if (!admin && en.type === 'ADJ') return deny();
        payload = { action: 'add', entry: {
          date: en.date, type: en.type, party: String(en.party || '').trim(), bill: String(en.bill || '').trim(),
          narration: String(en.narration || '').trim(), by: me.n,
          lines: en.lines.map(l => ({ item: String(l.item).replace(/\s+/g, ' ').trim(), qty: Number(l.qty),
            counted: l.counted === null || l.counted === undefined || l.counted === '' ? null : Number(l.counted) })) } };
      } else if (body.action === 'passwordChange') {
        const err = pwProblem(body.newPassword);
        if (err) return send(400, { ok: false, error: err });
        const j = await sheet(url, secret, { action: 'users' });
        if (!Array.isArray(j.users)) return send(502, { ok: false, error: OLD_SCRIPT });
        const u = j.users.find(x => String(x.username).toLowerCase() === me.u.toLowerCase());
        if (!u || !checkPassword(String(body.oldPassword || ''), u.hash)) { await sleep(700); return send(400, { ok: false, error: 'Your current password is not right.' }); }
        payload = { action: 'userSave', user: { username: u.username, hash: hashPassword(body.newPassword) } };
      } else if (!admin) {
        return deny();
      } else if (body.action === 'userSave' || body.action === 'userDelete') {
        const u = body.user || {};
        const username = String(u.username || '').trim();
        if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return send(400, { ok: false, error: 'Usernames are 3 to 40 letters, digits, dots, dashes or underscores, with no spaces.' });
        if (u.role !== undefined && !ROLES.includes(u.role)) return send(400, { ok: false, error: 'Choose a role.' });
        if (u.status !== undefined && !['Active', 'Inactive'].includes(u.status)) return send(400, { ok: false, error: 'Status must be Active or Inactive.' });
        if (u.password) { const e = pwProblem(u.password); if (e) return send(400, { ok: false, error: e }); }
        const self = username.toLowerCase() === me.u.toLowerCase();
        if (self && (body.action === 'userDelete' || (u.role && u.role !== ADMIN) || u.status === 'Inactive')) return send(400, { ok: false, error: 'You cannot remove, switch off or demote your own login. Another admin can.' });
        if (body.action === 'userDelete') payload = { action: 'userDelete', user: { username } };
        else payload = { action: 'userSave', user: { username, name: u.name === undefined ? undefined : cleanValue(u.name).slice(0, 80), role: u.role, status: u.status, hash: u.password ? hashPassword(u.password) : undefined } };
      } else if (body.action === 'docSave') {
        const err = checkDoc(body.doc);
        if (err) return send(400, { ok: false, error: err });
        const d = body.doc, t = v => cleanValue(v === undefined ? '' : v);
        payload = { action: 'docSave', doc: {
          type: d.type, no: t(d.no), date: d.date, due: DAY.test(d.due || '') ? d.due : '', party: t(d.party), address: String(d.address || '').trim().slice(0, 500),
          gstin: t(d.gstin), state: t(d.state), ref: t(d.ref), payment: t(d.payment), dispatch: t(d.dispatch), destination: t(d.destination),
          delivery: t(d.delivery), narration: t(d.narration), by: t(d.by) || me.n, replaces: d.replaces ? String(d.replaces) : '',
          lines: d.lines.map(l => ({ item: t(l.item), hsn: t(l.hsn), qty: Number(l.qty), unit: t(l.unit), rate: Number(l.rate) || 0, disc: Number(l.disc) || 0, gst: Number(l.gst) || 0, amount: Number(l.amount) || 0 })) } };
      } else if (body.action === 'docDelete' && body.id) {
        payload = { action: 'docDelete', id: String(body.id) };
      } else if (body.action === 'companySave' && body.company && typeof body.company === 'object') {
        payload = { action: 'companySave', company: cleanRecord(body.company) };
      } else if (/^master(Save|Delete|AddColumn|BulkAdd)$/.test(body.action || '')) {
        const err = checkMaster(body);
        if (err) return send(400, { ok: false, error: err });
        payload = { action: body.action, master: body.master, id: body.id, column: body.column && String(body.column).trim(),
          record: body.record && cleanRecord(body.record), records: Array.isArray(body.records) ? body.records.map(cleanRecord) : undefined };
      } else if (body.action === 'delete' && body.id) {
        payload = { action: 'delete', id: String(body.id) };
      } else {
        return send(400, { ok: false, error: 'Unknown request.' });
      }
    } else {
      return send(405, { ok: false, error: 'Method not allowed.' });
    }

    const j = await sheet(url, secret, { ...payload, actor });
    if (!j.ok && j.error === 'signed-out') return send(401, j);
    if (!j.ok) return send(502, j);
    if (payload.action === 'list') {
      if (!Array.isArray(j.users)) return send(502, { ok: false, error: OLD_SCRIPT });
      j.me = { username: me.u, name: me.n, role: me.r };
      if (!admin) { delete j.docs; delete j.company; delete j.users; }
    }
    return send(200, j);
  } catch (e) {
    return send(502, { ok: false, error: e.bad ? e.message : 'Could not reach the Google Sheet. Try again.' });
  }
};
