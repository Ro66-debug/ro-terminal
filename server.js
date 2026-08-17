#!/usr/bin/env node
/**
 * Static dev server for Ro Terminal.
 *
 * Serves the repo root exactly the way GitHub Pages does, so what you see on
 * http://localhost:8080 is what ships. Playwright's local suite boots this.
 *
 *   node server.js [--port 8080] [--root .]
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const opts = { port: Number(process.env.PORT) || 8080, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) opts.port = Number(argv[++i]);
    else if (argv[i] === '--root' && argv[i + 1]) opts.root = argv[++i];
  }
  opts.root = path.resolve(opts.root);
  return opts;
}

const { port, root } = parseArgs(process.argv.slice(2));

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    return send(res, 400, 'Bad Request', { 'content-type': MIME['.txt'] });
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  // Resolve inside root only — no traversal out of the served directory.
  const filePath = path.join(root, path.normalize(pathname));
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return send(res, 403, 'Forbidden', { 'content-type': MIME['.txt'] });
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      return send(res, 301, '', { location: `${pathname}/` });
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, `404 Not Found: ${pathname}\n`, { 'content-type': MIME['.txt'] });
  }
});

server.listen(port, () => {
  console.log(`Ro Terminal dev server → http://localhost:${port} (root: ${root})`);
});
