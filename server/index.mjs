/* Serve dist/ over HTTP and rooms over WebSocket. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRegistry } from './room.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const PORT = Number(process.env.PORT || 8787);

const registry = createRegistry();
const defaultRoom = registry.getOrCreate('demo', {
  deckId: '01-internal-beta-review',
  cursor: null,
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent((reqPath || '/').split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(base, cleaned);
  if (!abs.startsWith(base)) return null;
  return abs;
}

function serveStatic(req, res) {
  let filePath = safeJoin(dist, req.url === '/' ? '/index.html' : req.url);
  if (!filePath) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/room')) {
    const u = new URL(req.url, 'http://localhost');
    const id = u.searchParams.get('id') || 'demo';
    const r = registry.getOrCreate(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      roomId: r.room.roomId,
      joinCode: r.room.joinCode,
      // hostKey only when ?host=1 — never put this on guest links
      hostKey: u.searchParams.get('host') === '1' ? r.room.hostKey : undefined,
      deckId: r.room.deckId,
    }));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const u = new URL(req.url || '/ws', 'http://localhost');
  const roomId = u.searchParams.get('room') || 'demo';
  const handle = registry.getOrCreate(roomId);

  ws.on('message', (data) => handle.onMessage(ws, String(data)));
  ws.on('close', () => handle.onClose(ws));
});

server.listen(PORT, () => {
  const r = defaultRoom.room;
  console.log(`flowdeck realtime on http://localhost:${PORT}`);
  console.log(`  host:  http://localhost:${PORT}/${r.deckId}/?ws=1&room=${r.roomId}&hostKey=${r.hostKey}`);
  console.log(`  guest: http://localhost:${PORT}/${r.deckId}/?ws=1&room=${r.roomId}&code=${r.joinCode}`);
});

export { server, registry, defaultRoom, PORT };
