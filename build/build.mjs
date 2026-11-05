// Vercel build: copies the dashboard into dist/. All data is read live from the Google Sheet
// through /api/entries, so nothing else is published.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const f of ['index.html', 'js', 'lib', 'img']) fs.cpSync(path.join(root, f), path.join(dist, f), { recursive: true });
console.log('Copied the dashboard to dist/.');
