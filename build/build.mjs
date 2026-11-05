// Vercel build: copies the dashboard into dist/ and publishes the Tally files in data/
// as one password-encrypted file (dist/data.enc.json). The password comes from the
// DASHBOARD_PASSWORD environment variable; without it no data is published.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
globalThis.XLSX = require('xlsx');
const P = require('../js/parse.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const f of ['index.html', 'js', 'lib', 'img']) fs.cpSync(path.join(root, f), path.join(dist, f), { recursive: true });

const builtAt = Date.now();
const files = { Payment: null, Receipt: null, Journal: null, Master: null, Opening: null };
const dataDir = path.join(root, 'data');
const names = fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter(n => /\.(xlsx|xlsm|xls|csv)$/i.test(n) && !n.startsWith('~$')).sort() : [];
for (const name of names) {
  try {
    const wb = XLSX.read(fs.readFileSync(path.join(dataDir, name)), { type: 'buffer', cellDates: false });
    const f = P.parseWorkbook(wb, name);
    f.loadedAt = builtAt;
    if (files[f.kind]) console.warn(`data/${name}: a second ${f.kind} file was found; using ${files[f.kind].fileName}.`);
    else { files[f.kind] = f; console.log(`data/${name}: ${f.kind}${f.vouchers ? `, ${f.vouchers.length} vouchers, ${f.periodText}` : `, ${f.count} items${f.periodText ? ', ' + f.periodText : ''}`}`); }
  } catch (e) {
    console.warn(`data/${name}: skipped. ${e.message}`);
  }
}

const password = process.env.DASHBOARD_PASSWORD;
if (!password) {
  console.warn('DASHBOARD_PASSWORD is not set, so the data folder was not published. The site still works with "Load / replace files".');
} else if (!files.Payment && !files.Receipt) {
  console.warn('No Payment or Receipt Register found in data/, so no data was published.');
} else {
  const payload = { Payment: P.pack(files.Payment), Receipt: P.pack(files.Receipt), Journal: P.pack(files.Journal), Master: files.Master, Opening: files.Opening, builtAt };
  const plain = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iter = 250000;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const b64 = u => Buffer.from(u).toString('base64');
  fs.writeFileSync(path.join(dist, 'data.enc.json'), JSON.stringify({ v: 1, iter, gzip: true, builtAt, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  console.log(`Published encrypted data (${Math.round(ct.length / 1024)} KB).`);
}
