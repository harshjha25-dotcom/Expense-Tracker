const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CSV_FILE = path.join(DATA_DIR, 'transactions.csv');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HEADER = 'id,type,description,category,amount,date,createdAt';
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, `${HEADER}\n`);

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function parseLine(line) {
  const cells = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell); return cells;
}
function readAll() {
  const lines = fs.readFileSync(CSV_FILE, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const keys = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseLine(line); const item = {};
    keys.forEach((key, index) => { item[key] = cells[index] || ''; });
    item.amount = Number(item.amount) || 0; return item;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
}
function writeAll(items) {
  const rows = items.map((item) => [item.id, item.type, item.description, item.category, Number(item.amount).toFixed(2), item.date, item.createdAt].map(escapeCsv).join(','));
  fs.writeFileSync(CSV_FILE, `${HEADER}\n${rows.join('\n')}${rows.length ? '\n' : ''}`);
}
function json(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(payload)); }
function body(request) { return new Promise((resolve, reject) => { let value = ''; request.on('data', (chunk) => { value += chunk; }); request.on('end', () => { try { resolve(value ? JSON.parse(value) : {}); } catch { reject(new Error('Invalid JSON')); } }); request.on('error', reject); }); }
function valid(input, old = {}) {
  const amount = Number(input.amount);
  if (!input.description || !input.date || !Number.isFinite(amount) || amount <= 0) return null;
  const type = input.type === 'income' ? 'income' : 'expense';
  return { id: old.id || crypto.randomUUID(), type, description: String(input.description).trim(), category: type === 'income' ? 'Income' : String(input.category || 'Other').trim(), amount: Math.round(amount * 100) / 100, date: String(input.date), createdAt: old.createdAt || new Date().toISOString() };
}
function file(response, pathname) {
  const ext = path.extname(pathname); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  fs.readFile(pathname, (error, data) => { if (error) { response.writeHead(404); response.end('Not found'); return; } response.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); response.end(data); });
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/api/transactions' && request.method === 'GET') return json(response, 200, readAll());
    if (url.pathname === '/api/transactions' && request.method === 'POST') { const item = valid(await body(request)); if (!item) return json(response, 400, { error: 'Please provide a description, amount, and date.' }); const items = readAll(); items.push(item); writeAll(items); return json(response, 201, item); }
    const match = url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
    if (match && (request.method === 'PUT' || request.method === 'DELETE')) {
      const items = readAll(); const index = items.findIndex((item) => item.id === match[1]); if (index < 0) return json(response, 404, { error: 'Transaction not found.' });
      if (request.method === 'DELETE') { items.splice(index, 1); writeAll(items); return json(response, 200, { ok: true }); }
      const item = valid(await body(request), items[index]); if (!item) return json(response, 400, { error: 'Please provide a description, amount, and date.' }); items[index] = item; writeAll(items); return json(response, 200, item);
    }
    if (request.method === 'GET') { const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const pathname = path.normalize(path.join(PUBLIC_DIR, requested)); if (!pathname.startsWith(PUBLIC_DIR)) { response.writeHead(403); return response.end('Forbidden'); } return file(response, pathname); }
    response.writeHead(404); response.end('Not found');
  } catch (error) { console.error(error); json(response, 500, { error: 'Something went wrong on the server.' }); }
});
server.listen(PORT, () => console.log(`Ledgerly running at http://localhost:${PORT}`));
