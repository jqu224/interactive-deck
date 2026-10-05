/* In-memory server-authoritative room (P0: identity + follow-lock). */
import { randomBytes } from 'node:crypto';

const uid = (n = 8) => randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);

export function createRoom(opts = {}) {
  const room = {
    roomId: opts.roomId || uid(8),
    deckId: opts.deckId || 'deck',
    hostKey: opts.hostKey || uid(16),
    joinCode: opts.joinCode || uid(6),
    seq: 0,
    cursor: opts.cursor || null,
    participants: Object.create(null),
    sockets: new Map(), // ws -> pid
  };

  function snapshot() {
    return {
      roomId: room.roomId,
      deckId: room.deckId,
      joinCode: room.joinCode,
      cursor: room.cursor,
      seq: room.seq,
      participants: Object.fromEntries(
        Object.entries(room.participants).map(([pid, p]) => [
          pid,
          { name: p.name, role: p.role, online: p.online },
        ])
      ),
    };
  }

  function nextSeq() {
    room.seq += 1;
    return room.seq;
  }

  function send(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(msg, exceptPid) {
    for (const [ws, pid] of room.sockets) {
      if (exceptPid && pid === exceptPid) continue;
      send(ws, msg);
    }
  }

  function welcome(ws, pid) {
    const p = room.participants[pid];
    send(ws, {
      t: 'welcome',
      pid,
      role: p.role,
      resumeToken: p.resumeToken,
      snapshot: snapshot(),
      seq: room.seq,
    });
  }

  function attach(ws, pid) {
    const prev = [...room.sockets.entries()].find(([, id]) => id === pid);
    if (prev) {
      try { prev[0].close(); } catch { /* ignore */ }
      room.sockets.delete(prev[0]);
    }
    room.sockets.set(ws, pid);
    const p = room.participants[pid];
    p.online = true;
    p.lastSeen = Date.now();
    p.ws = ws;
  }

  function findByResume(token) {
    return Object.entries(room.participants).find(([, p]) => p.resumeToken === token);
  }

  function claimHost(ws, name) {
    const existing = Object.entries(room.participants).find(([, p]) => p.role === 'host');
    let pid;
    if (existing) {
      pid = existing[0];
      existing[1].name = name || existing[1].name || 'Host';
    } else {
      pid = uid(10);
      room.participants[pid] = {
        name: name || 'Host',
        role: 'host',
        online: true,
        resumeToken: uid(24),
        lastSeen: Date.now(),
      };
    }
    attach(ws, pid);
    welcome(ws, pid);
    broadcast({ t: 'presence', seq: nextSeq(), participants: snapshot().participants });
    return pid;
  }

  function joinGuest(ws, { code, name, deviceId }) {
    if (String(code || '') !== room.joinCode) {
      send(ws, { t: 'error', code: 'bad_code', message: 'invalid join code' });
      return null;
    }
    const pid = uid(10);
    room.participants[pid] = {
      name: name || 'Guest',
      role: 'guest',
      online: true,
      resumeToken: uid(24),
      deviceId: deviceId || null,
      lastSeen: Date.now(),
    };
    attach(ws, pid);
    welcome(ws, pid);
    broadcast({ t: 'presence', seq: nextSeq(), participants: snapshot().participants });
    return pid;
  }

  function resume(ws, { resumeToken, lastSeq, name }) {
    const hit = findByResume(resumeToken);
    if (!hit) {
      send(ws, { t: 'error', code: 'bad_resume', message: 'unknown resume token' });
      return null;
    }
    const [pid, p] = hit;
    if (name) p.name = name;
    attach(ws, pid);
    welcome(ws, pid);
    // welcome carries full snapshot; lastSeq is acknowledged for future deltas
    void lastSeq;
    broadcast({ t: 'presence', seq: nextSeq(), participants: snapshot().participants });
    return pid;
  }

  function hostNav(ws, { nodeId, idx }) {
    const pid = room.sockets.get(ws);
    const p = pid && room.participants[pid];
    if (!p || (p.role !== 'host' && p.role !== 'cohost')) {
      send(ws, { t: 'error', code: 'forbidden', message: 'host only' });
      return;
    }
    if (nodeId != null) room.cursor = String(nodeId);
    else if (idx != null) room.cursor = { idx: Number(idx) };
    const seq = nextSeq();
    const fact = { t: 'nav', seq, cursor: room.cursor, by: pid };
    broadcast(fact);
  }

  function onMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    const pid = room.sockets.get(ws);
    if (pid && room.participants[pid]) room.participants[pid].lastSeen = Date.now();

    if (m.t === 'hello') {
      if (m.resumeToken) return resume(ws, m);
      if (m.hostKey && m.hostKey === room.hostKey) return claimHost(ws, m.name);
      send(ws, { t: 'error', code: 'need_join', message: 'send join or valid hostKey' });
      return;
    }
    if (m.t === 'join') return joinGuest(ws, m);
    if (m.t === 'host:nav') return hostNav(ws, m);
    if (m.t === 'ping') {
      send(ws, { t: 'pong', seq: room.seq });
      return;
    }
    send(ws, { t: 'error', code: 'unknown', message: 'unsupported: ' + m.t });
  }

  function onClose(ws) {
    const pid = room.sockets.get(ws);
    room.sockets.delete(ws);
    if (!pid || !room.participants[pid]) return;
    room.participants[pid].online = false;
    room.participants[pid].ws = null;
    broadcast({ t: 'presence', seq: nextSeq(), participants: snapshot().participants });
  }

  return {
    room,
    snapshot,
    onMessage,
    onClose,
    send,
  };
}

export function createRegistry() {
  const rooms = new Map();

  function getOrCreate(roomId, opts) {
    let r = rooms.get(roomId);
    if (!r) {
      r = createRoom({ ...opts, roomId });
      rooms.set(r.room.roomId, r);
    }
    return r;
  }

  return { rooms, getOrCreate, createRoom };
}
