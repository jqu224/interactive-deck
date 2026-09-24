/* P0 acceptance: 50 guests follow host:nav <300ms; reconnect keeps pid + page. */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';

const N = Number(process.env.BOTS || 50);
const NAV_MS = Number(process.env.NAV_MS || 300);
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 30000);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function onceMessage(ws, pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error('timeout waiting for message'));
    }, timeoutMs);
    function onMsg(data) {
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (!pred(m)) return;
      cleanup();
      resolve(m);
    }
    function cleanup() {
      clearTimeout(t);
      ws.off('message', onMsg);
    }
    ws.on('message', onMsg);
  });
}

function connect(port, roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${encodeURIComponent(roomId)}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function main() {
  const room = createRoom({
    roomId: 'bots',
    deckId: 'bots',
    hostKey: 'host-key-bots',
    joinCode: 'join01',
    cursor: 'n1',
  });

  const server = http.createServer((_req, res) => {
    res.writeHead(200); res.end('ok');
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => room.onMessage(ws, String(data)));
    ws.on('close', () => room.onClose(ws));
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const host = await connect(port, 'bots');
  host.send(JSON.stringify({ t: 'hello', hostKey: 'host-key-bots', name: 'Host' }));
  const hostWelcome = await onceMessage(host, (m) => m.t === 'welcome', 2000);
  assert(hostWelcome.role === 'host', 'host role');
  assert(hostWelcome.pid, 'host pid');

  const guests = [];
  for (let i = 0; i < N; i++) {
    const ws = await connect(port, 'bots');
    ws.send(JSON.stringify({ t: 'join', code: 'join01', name: 'G' + i, deviceId: 'd' + i }));
    const welcome = await onceMessage(ws, (m) => m.t === 'welcome', 2000);
    assert(welcome.role === 'guest', 'guest role');
    guests.push({
      ws,
      pid: welcome.pid,
      resumeToken: welcome.resumeToken,
      cursor: welcome.snapshot.cursor,
      lastSeq: welcome.seq,
    });
  }
  assert(guests.length === N, 'guest count');

  const target = 'n3';
  const waiters = guests.map((g) =>
    onceMessage(g.ws, (m) => m.t === 'nav' && m.cursor === target, NAV_MS).then((m) => {
      g.cursor = m.cursor;
      g.lastSeq = m.seq;
      return m;
    })
  );
  const t0 = Date.now();
  host.send(JSON.stringify({ t: 'host:nav', nodeId: target }));
  await Promise.all(waiters);
  const elapsed = Date.now() - t0;
  assert(elapsed <= NAV_MS, `nav follow ${elapsed}ms > ${NAV_MS}ms`);
  console.log(`ok  nav: ${N} guests followed to ${target} in ${elapsed}ms`);

  const victim = guests[0];
  const oldPid = victim.pid;
  const oldCursor = victim.cursor;
  victim.ws.close();
  await new Promise((r) => setTimeout(r, RECONNECT_MS));

  const again = await connect(port, 'bots');
  again.send(JSON.stringify({
    t: 'hello',
    resumeToken: victim.resumeToken,
    lastSeq: victim.lastSeq,
    name: 'G0',
  }));
  const resumed = await onceMessage(again, (m) => m.t === 'welcome', 2000);
  assert(resumed.pid === oldPid, `resume pid ${resumed.pid} != ${oldPid}`);
  assert(resumed.snapshot.cursor === oldCursor, `resume cursor ${resumed.snapshot.cursor} != ${oldCursor}`);
  console.log(`ok  resume: pid=${oldPid} cursor=${oldCursor} after ${RECONNECT_MS}ms`);

  host.close();
  again.close();
  for (const g of guests.slice(1)) g.ws.close();
  await new Promise((r) => server.close(r));
  console.log('ok  P0 bots passed');
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
