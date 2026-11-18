const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const dbm = require('./src/db');
const seed = require('./src/seed');
const { dispatch } = require('./src/api');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'";

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && config.ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100 * 1024) { reject(Object.assign(new Error('Request body too large.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(parsed && typeof parsed === 'object' ? parsed : {}); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.normalize(path.join(config.FRONTEND_DIR, rel));
  if (full !== config.FRONTEND_DIR && !full.startsWith(config.FRONTEND_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const ext = path.extname(full).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' };
    if (ext === '.html') headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

function createServer() {
  dbm.init(seed);
  return http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      applyCors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      try {
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        const result = dispatch({ method: req.method, pathname, query: Object.fromEntries(url.searchParams), body, token, ip: req.socket.remoteAddress });
        return sendJson(res, result.status, result.body);
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message || 'Server error.' });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    serveStatic(req, res, pathname);
  });
}

module.exports = { createServer };

if (require.main === module) {
  createServer().listen(config.PORT, () => {
    console.log(`Timeoff Pro running at http://localhost:${config.PORT}`);
    console.log(`Serving frontend from ${config.FRONTEND_DIR}`);
    console.log(`Data stored in ${config.DATA_DIR}`);
  });
}
