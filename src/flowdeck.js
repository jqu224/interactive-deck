/* flowdeck.js — 流程图式可交互演示引擎
 * 一个规格（JSON）→ 一个自包含 HTML 站点。
 * 能力：整页变形相机 / 流程小地图 / 就地编辑 / 标注钉 / 投票评分 / 房间同步
 */
(function () {
  'use strict';

  /* ============ 小工具 ============ */

  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var uid = function (n) { return Math.random().toString(36).slice(2, 2 + (n || 8)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  };

  var NW = 900, NH = 600, PAD = 140;   // 节点尺寸与画布留白
  var KIND_LABEL = { start: '起点', step: '步骤', decision: '抉择', end: '收尾' };

  /* 自查：必须在改写 body 之前把自身资源抓下来，否则导出单文件取不到 CSS/JS */
  var ASSETS = {
    css: (function () { var e = document.querySelector('style[data-flowdeck]'); return e ? e.textContent : ''; })(),
    js: (function () { var e = document.querySelector('script[data-flowdeck]'); return e ? e.textContent : ''; })()
  };

  /* ============ 文档模型 ============ */

  var M = { spec: null, nodes: [], byId: {}, edges: [], order: [], idx: 0, W: 0, H: 0, mode: null };
  var cam = { tx: 0, ty: 0, scale: 1, x: 0, y: 0, w: 0, h: 0 };
  var deckId = 'deck';

  /* ============ 本地可写状态（编辑内容 / 标注 / 投票） ============ */

  var S = { html: {}, notes: {}, polls: {}, dirty: {}, name: '' };
  var LSKEY = function () { return 'flowdeck:v1:' + deckId; };

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LSKEY());
      if (raw) {
        var o = JSON.parse(raw);
        S.html = o.html || {}; S.notes = o.notes || {}; S.polls = o.polls || {}; S.dirty = o.dirty || {};
        S.name = o.name || '';
      }
    } catch (e) { /* 忽略损坏的本地数据 */ }
  }

  var saveLocal = debounce(function () {
    try { localStorage.setItem(LSKEY(), JSON.stringify(S)); } catch (e) { }
  }, 240);

  /* ============ 房间同步层 ============ */
  /* Transport：BroadcastChannel（无 ?ws= 时的本地多窗口）或 WebSocket（服务器权威）。
     WS 路径只发意图、只吃 seq 事实；学员 goto 被钉死，只能跟 nav。 */

  var Room = {
    mode: 'bc',          // 'bc' | 'ws'
    role: null,          // host | guest | null
    pid: null,
    resumeToken: null,
    lastSeq: 0,
    followLocked: false, // guest under WS: local nav blocked
    wsUrl: null,
    roomId: null,
    hostKey: null,
    joinCode: null
  };

  function qs() {
    try { return new URLSearchParams(location.search || ''); } catch (e) { return new URLSearchParams(); }
  }

  function readRoomQuery() {
    var q = qs();
    var ws = q.get('ws');
    if (!ws) return false;
    Room.mode = 'ws';
    Room.roomId = q.get('room') || 'demo';
    Room.hostKey = q.get('hostKey') || null;
    Room.joinCode = q.get('code') || null;
    if (ws === '1' || ws === 'true') {
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      Room.wsUrl = proto + '//' + location.host + '/ws?room=' + encodeURIComponent(Room.roomId);
    } else {
      Room.wsUrl = ws.indexOf('room=') >= 0 ? ws
        : (ws + (ws.indexOf('?') >= 0 ? '&' : '?') + 'room=' + encodeURIComponent(Room.roomId));
    }
    try {
      var tok = sessionStorage.getItem('fd:resume:' + Room.roomId);
      if (tok) Room.resumeToken = tok;
    } catch (e) { }
    return true;
  }

  function cursorToIndex(cursor) {
    if (cursor == null) return -1;
    if (typeof cursor === 'object' && cursor.idx != null) return clamp(Number(cursor.idx), 0, M.order.length - 1);
    var i = M.order.indexOf(String(cursor));
    return i;
  }

  function applyNavFact(fact) {
    if (!fact || fact.seq <= Room.lastSeq) return;
    Room.lastSeq = fact.seq;
    var i = cursorToIndex(fact.cursor);
    if (i < 0) return;
    goto(i, false, true);
  }

  function applyWelcome(msg) {
    if (!msg) return;
    Room.pid = msg.pid;
    Room.role = msg.role;
    Room.resumeToken = msg.resumeToken;
    Room.lastSeq = msg.seq || 0;
    Room.followLocked = Room.role === 'guest';
    try {
      if (Room.roomId && msg.resumeToken) {
        sessionStorage.setItem('fd:resume:' + Room.roomId, msg.resumeToken);
      }
    } catch (e) { }
    if (msg.snapshot && msg.snapshot.participants) {
      Trace.peers = {};
      Object.keys(msg.snapshot.participants).forEach(function (pid) {
        Trace.peers[pid] = Date.now();
      });
      if (Trace.onPeers) Trace.onPeers();
    }
    if (msg.snapshot && msg.snapshot.cursor != null) {
      var i = cursorToIndex(msg.snapshot.cursor);
      if (i >= 0) goto(i, true, true);
    }
  }

  function applyPresence(msg) {
    if (!msg || msg.seq <= Room.lastSeq) return;
    Room.lastSeq = msg.seq;
    Trace.peers = {};
    Object.keys(msg.participants || {}).forEach(function (pid) {
      if (msg.participants[pid] && msg.participants[pid].online !== false) {
        Trace.peers[pid] = Date.now();
      }
    });
    if (Trace.onPeers) Trace.onPeers();
  }

  var Trace = {
    cid: (function () {
      try {
        var v = sessionStorage.getItem('fd:cid');
        if (!v) { v = uid(8); sessionStorage.setItem('fd:cid', v); }
        return v;
      } catch (e) { return uid(8); }
    })(),
    mode: 'bc',
    ch: null, busKey: null, seen: {}, peers: {}, timer: null,
    ws: null, onMsg: null, onPeers: null, backoff: 500,

    join: function (room, onMsg, onPeers) {
      this.onMsg = onMsg; this.onPeers = onPeers;
      if (readRoomQuery()) {
        this.mode = 'ws';
        this.connectWs();
        return;
      }
      this.mode = 'bc';
      this.joinBroadcast(room);
    },

    joinBroadcast: function (room) {
      var self = this;
      if (typeof BroadcastChannel === 'function') {
        this.ch = new BroadcastChannel('flowdeck:' + room);
        this.ch.onmessage = function (e) { self.recv(e.data); };
      } else {
        this.busKey = 'flowdeck:bus:' + room;
        window.addEventListener('storage', function (e) {
          if (e.key === self.busKey && e.newValue) {
            try { self.recv(JSON.parse(e.newValue)); } catch (err) { }
          }
        });
      }
      this.post({ t: 'hello', id: this.cid, name: S.name });
      this.timer = setInterval(function () {
        self.post({ t: 'hello', id: self.cid, name: S.name });
        self.prune();
      }, 3500);
      this.prune();
    },

    connectWs: function () {
      var self = this;
      if (!Room.wsUrl) return;
      try { if (this.ws) this.ws.close(); } catch (e) { }
      var sock = new WebSocket(Room.wsUrl);
      this.ws = sock;
      sock.onopen = function () {
        self.backoff = 500;
        if (Room.resumeToken) {
          sock.send(JSON.stringify({
            t: 'hello', resumeToken: Room.resumeToken,
            name: S.name || '', lastSeq: Room.lastSeq
          }));
        } else if (Room.hostKey) {
          sock.send(JSON.stringify({
            t: 'hello', hostKey: Room.hostKey,
            name: S.name || 'Host', lastSeq: Room.lastSeq
          }));
        } else if (Room.joinCode) {
          sock.send(JSON.stringify({
            t: 'join', code: Room.joinCode,
            name: S.name || 'Guest', deviceId: self.cid
          }));
        }
      };
      sock.onmessage = function (e) {
        try { self.onFact(JSON.parse(e.data)); } catch (err) { }
      };
      sock.onclose = function () {
        if (self.mode !== 'ws') return;
        var wait = self.backoff;
        self.backoff = Math.min(15000, self.backoff * 2);
        setTimeout(function () { self.connectWs(); }, wait);
      };
    },

    onFact: function (m) {
      if (!m || !m.t) return;
      if (m.t === 'welcome') { applyWelcome(m); return; }
      if (m.t === 'nav') { applyNavFact(m); return; }
      if (m.t === 'presence') { applyPresence(m); return; }
      if (m.t === 'error') {
        try { console.warn('[flowdeck]', m.code, m.message); } catch (e) { }
        if (typeof toast === 'function') toast(m.message || m.code || '房间错误');
        return;
      }
      if (m.seq != null && m.seq <= Room.lastSeq) return;
      if (m.seq != null) Room.lastSeq = m.seq;
      if (this.onMsg) this.onMsg(m);
    },

    intent: function (m) {
      if (this.mode !== 'ws' || !this.ws || this.ws.readyState !== 1) return;
      try { this.ws.send(JSON.stringify(m)); } catch (e) { }
    },

    post: function (m) {
      if (this.mode === 'ws') return; // P0: votes/notes stay local until server widgets land
      m._n = uid(12);
      if (this.ch) this.ch.postMessage(m);
      else if (this.busKey) { try { localStorage.setItem(this.busKey, JSON.stringify(m)); } catch (e) { } }
    },

    pub: function (m) { this.post(m); if (this.mode === 'bc') this.recv(m); },

    recv: function (m) {
      if (!m || !m._n || this.seen[m._n]) return;
      this.seen[m._n] = 1;
      if (Object.keys(this.seen).length > 600) this.seen = {};
      if (m.t === 'hello') {
        var fresh = !this.peers[m.id];
        this.peers[m.id] = Date.now();
        if (m.id !== this.cid && fresh) this.post({ t: 'here', id: this.cid, name: S.name });
        if (this.onPeers) this.onPeers();
      } else if (m.t === 'here') {
        this.peers[m.id] = Date.now();
        if (this.onPeers) this.onPeers();
      } else if (m.cid !== this.cid) {
        if (this.onMsg) this.onMsg(m);
      }
    },

    prune: function () {
      var now = Date.now(), self = this;
      Object.keys(this.peers).forEach(function (id) {
        if (now - self.peers[id] > 12000) delete self.peers[id];
      });
      this.peers[this.cid] = now;
      if (this.onPeers) this.onPeers();
    },

    count: function () { return Object.keys(this.peers).length; }
  };

  /* ============ 规格归一化 ============ */

  function normalize(spec) {
    var nodes = (spec.nodes || []).slice();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x || 0); minY = Math.min(minY, n.y || 0);
      maxX = Math.max(maxX, (n.x || 0) + NW); maxY = Math.max(maxY, (n.y || 0) + NH);
    });
    if (!isFinite(minX)) { minX = minY = 0; maxX = NW; maxY = NH; }

    M.nodes = nodes.map(function (n, i) {
      var o = {};
      for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) o[k] = n[k];
      o.x = (n.x || 0) - minX + PAD;
      o.y = (n.y || 0) - minY + PAD;
      o.i = i;
      if (!o.id) o.id = 'n' + (i + 1);
      return o;
    });

    M.byId = {};
    M.nodes.forEach(function (n) { M.byId[n.id] = n; });
    M.W = maxX - minX + PAD * 2;
    M.H = maxY - minY + PAD * 2;
    M.edges = (spec.edges || []).filter(function (e) { return M.byId[e.from] && M.byId[e.to]; });

    var ids = M.nodes.map(function (n) { return n.id; });
    if (spec.order && spec.order.length) {
      M.order = spec.order.filter(function (id) { return M.byId[id]; });
      ids.forEach(function (id) { if (M.order.indexOf(id) < 0) M.order.push(id); });
    } else {
      M.order = deriveOrder(spec, ids);
    }
  }

  function deriveOrder(spec, ids) {
    var incoming = {};
    (spec.edges || []).forEach(function (e) { incoming[e.to] = 1; });
    var start = (spec.start && ids.indexOf(spec.start) >= 0) ? spec.start : null;
    if (!start) {
      for (var i = 0; i < ids.length; i++) { if (!incoming[ids[i]]) { start = ids[i]; break; } }
    }
    start = start || ids[0];
    var out = [], seen = {};
    (function walk(id) {
      if (!id || seen[id] || ids.indexOf(id) < 0) return;
      seen[id] = 1; out.push(id);
      (spec.edges || []).forEach(function (e) { if (e.from === id) walk(e.to); });
    })(start);
    ids.forEach(function (id) { if (!seen[id]) out.push(id); });
    return out;
  }

  var cur = function () { return M.byId[M.order[M.idx]]; };
  var nextOf = function (id) { var i = M.order.indexOf(id); return i >= 0 ? M.byId[M.order[i + 1]] : null; };
  var isMainEdge = function (e) { return M.order.indexOf(e.to) - M.order.indexOf(e.from) === 1; };

  /* ============ 外壳 ============ */

  var ICON = {
    left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    pen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L20 8l-4-4L4 16v4z"/></svg>',
    note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>',
    users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="8" r="3"/><path d="M22 20v-1a4 4 0 0 0-3-3.9"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0l-5-5m5 5l5-5"/><path d="M4 20h16"/></svg>'
  };

  function buildShell() {
    document.body.innerHTML =
      '<div class="fd-stage" id="fd-stage">' +
        '<div class="fd-grid" id="fd-grid"></div>' +
        '<div class="fd-world" id="fd-world">' +
          '<svg class="fd-edges" id="fd-edges"></svg>' +
        '</div>' +
        '<div class="fd-burst" id="fd-burst"></div>' +
      '</div>' +
      '<header class="fd-bar">' +
        '<div class="fd-brand">' + esc(M.spec.title || 'Flow Deck') + '<small>' + esc(M.spec.subtitle || '流程图式可交互演示') + '</small></div>' +
        '<div class="fd-sep"></div>' +
        '<button class="fd-btn" id="fd-m-edit">' + ICON.pen + '就地编辑</button>' +
        '<button class="fd-btn" id="fd-m-note">' + ICON.note + '标注</button>' +
        '<button class="fd-btn" id="fd-m-users">' + ICON.users + '<span id="fd-users">1 人在线</span></button>' +
        '<button class="fd-btn" id="fd-export">' + ICON.down + '导出单文件</button>' +
      '</header>' +
      '<div class="fd-map" id="fd-map">' +
        '<div class="fd-map-hd"><span>流程总览</span><span id="fd-map-pos"></span></div>' +
        '<svg id="fd-map-svg" xmlns="http://www.w3.org/2000/svg"></svg>' +
      '</div>' +
      '<div class="fd-bottom">' +
        '<div class="fd-editbar" id="fd-editbar"></div>' +
        '<div class="fd-dock">' +
          '<button class="fd-nav" id="fd-prev" title="上一个">' + ICON.left + '</button>' +
          '<div class="fd-dots" id="fd-dots"></div>' +
          '<button class="fd-nav fd-nav-main" id="fd-next" title="下一个">' + ICON.right + '</button>' +
        '</div>' +
      '</div>' +
      '<aside class="fd-panel" id="fd-panel">' +
        '<div class="fd-panel-hd">' +
          '<div class="fd-live"><span class="fd-dot" id="fd-dot"></span><span id="fd-people">1 人在线</span></div>' +
          '<div style="margin-left:auto"><button class="fd-btn" id="fd-panel-close">收起</button></div>' +
        '</div>' +
        '<div class="fd-panel-bd" id="fd-panel-bd"></div>' +
        '<div class="fd-panel-ft">' +
          '<button class="fd-btn" id="fd-reset-page">清空本页数据</button>' +
          '<button class="fd-btn" id="fd-reset-all">全部重置</button>' +
        '</div>' +
      '</aside>' +
      '<div class="fd-hint"><kbd>→</kbd> 下一个 · <kbd>←</kbd> 上一个 · <kbd>E</kbd> 编辑 · <kbd>A</kbd> 标注 · 点小地图跳转</div>' +
      '<div class="fd-toast" id="fd-toast"></div>';

    var bar = $('.fd-bar');
    $$('.fd-btn', bar).forEach(function (b) { b.style.flex = 'none'; });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#fd-toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2100);
  }

  /* ============ 节点与连线 ============ */

  function bodyHTML(n) { return S.html[n.id] != null ? S.html[n.id] : (n.html || ''); }

  function buildNodes() {
    var world = $('#fd-world');
    M.nodes.forEach(function (n) {
      var d = document.createElement('div');
      d.className = 'fd-node fd-kind-' + (n.kind || 'step');
      d.id = 'fd-n-' + n.id;
      d.dataset.id = n.id;
      d.style.left = n.x + 'px';
      d.style.top = n.y + 'px';
      d.innerHTML =
        '<div class="fd-head">' +
          '<span class="fd-pill">' + esc(KIND_LABEL[n.kind] || '步骤') + '</span>' +
          '<span class="fd-idx">' + (M.order.indexOf(n.id) + 1) + ' / ' + M.order.length + '</span>' +
        '</div>' +
        '<div class="fd-body" data-body>' + bodyHTML(n) + '</div>' +
        (n.poll ? '<div class="fd-poll" data-poll contenteditable="false"></div>' : '') +
        '<div class="fd-foot" data-foot></div>';
      world.appendChild(d);

      if (n.poll) {
        var spec = n.poll;
        if (spec.type === 'rating') {
          if (!S.polls[n.id]) S.polls[n.id] = { raters: {} };
          if (!S.polls[n.id].raters) S.polls[n.id].raters = {};
        } else {
          if (!S.polls[n.id]) S.polls[n.id] = { voters: {} };
          if (!S.polls[n.id].voters) S.polls[n.id].voters = {};
        }
      }
      stagger(d);
    });
    renderEdges();
  }

  function stagger(node) {
    var kids = $$('[data-body] > *', node);
    kids.forEach(function (k, i) { k.style.setProperty('--i', i); });
    return kids.length;
  }

  function anchorOf(n, dx, dy) {
    var cx = n.x + NW / 2, cy = n.y + NH / 2, m = 40;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: dx > 0 ? n.x + NW + m : n.x - m, y: cy };
    return { x: cx, y: dy > 0 ? n.y + NH + m : n.y - m };
  }

  function edgePath(a, b) {
    var dx = (b.x + NW / 2) - (a.x + NW / 2);
    var dy = (b.y + NH / 2) - (a.y + NH / 2);
    var p1 = anchorOf(a, dx, dy), p2 = anchorOf(b, dx, dy);
    var horiz = Math.abs(dx) >= Math.abs(dy);
    var c1 = horiz ? { x: (p1.x + p2.x) / 2, y: p1.y } : { x: p1.x, y: (p1.y + p2.y) / 2 };
    var c2 = horiz ? { x: (p1.x + p2.x) / 2, y: p2.y } : { x: p2.x, y: (p1.y + p2.y) / 2 };
    return 'M' + p1.x + ' ' + p1.y + 'C' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + p2.x + ' ' + p2.y;
  }

  function renderEdges() {
    var svg = $('#fd-edges');
    svg.setAttribute('viewBox', '0 0 ' + M.W + ' ' + M.H);
    var n = cur();
    var out = '<defs><marker id="fd-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#c9c6bb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>';

    M.edges.forEach(function (e) {
      var a = M.byId[e.from], b = M.byId[e.to];
      var cls = 'fd-edge' + (isMainEdge(e) ? '' : ' is-branch');
      if (n && e.to === n.id) cls += ' is-live';
      out += '<path class="' + cls + '" d="' + edgePath(a, b) + '" marker-end="url(#fd-arrow)"/>';
      if (e.label) {
        var mx = (a.x + b.x) / 2 + NW / 2, my = (a.y + b.y) / 2 + NH / 2;
        var w = String(e.label).length * 26 + 24;
        out += '<rect class="fd-lbl-bg" x="' + (mx - w / 2) + '" y="' + (my - 22) + '" width="' + w + '" height="44" rx="12"/>';
        out += '<text class="fd-lbl" x="' + mx + '" y="' + my + '" text-anchor="middle" dominant-baseline="central">' + esc(e.label) + '</text>';
      }
    });
    svg.innerHTML = out;
  }

  /* ============ 相机 ============ */

  function applyCam(animate) {
    var stage = $('#fd-stage'), world = $('#fd-world'), grid = $('#fd-grid');
    var vw = stage.clientWidth, vh = stage.clientHeight;
    var n = cur();
    var pad = vw < 1000 ? 56 : 150;
    var scale = clamp(Math.min((vw - pad * 2) / NW, (vh - pad * 2) / NH), 0.2, 1);
    var nx = nextOf(n.id);
    var k = nx ? 0.13 : 0;   // 相机朝下一个节点偏一点，方向感就出来了
    var cx = n.x + NW / 2 + (nx ? (nx.x - n.x) * k : 0);
    var cy = n.y + NH / 2 + (nx ? (nx.y - n.y) * k : 0);

    cam.scale = scale;
    cam.tx = vw / 2 - cx * scale;
    cam.ty = vh / 2 - cy * scale;

    if (!animate) world.style.transition = 'none';
    world.style.transform = 'translate(' + cam.tx + 'px,' + cam.ty + 'px) scale(' + scale + ')';
    if (!animate) { void world.offsetWidth; world.style.transition = ''; }

    world.style.setProperty('--fd-scale', scale);
    world.style.setProperty('--fd-inv', 1 / scale);
    grid.style.backgroundPosition = (cam.tx * 0.3) + 'px ' + (cam.ty * 0.3) + 'px';

    cam.x = -cam.tx / scale; cam.y = -cam.ty / scale;
    cam.w = vw / scale; cam.h = vh / scale;
  }

  /* ============ 跳转 ============ */

  function goto(i, noPush, fromFact) {
    i = clamp(i, 0, M.order.length - 1);
    /* WS guest: only nav facts move the camera. WS host: local clicks become host:nav intents. */
    if (Room.mode === 'ws' && !fromFact) {
      if (Room.followLocked || Room.role === 'guest') return;
      if (Room.role === 'host' || Room.role === 'cohost') {
        Trace.intent({ t: 'host:nav', nodeId: M.order[i] });
        return;
      }
      /* role still null (pre-welcome): allow local bootstrap jump */
    }
    M.idx = i;
    var n = cur();

    $$('.fd-node').forEach(function (d) {
      d.classList.toggle('is-current', d.dataset.id === n.id);
    });
    applyCam(true);
    stagger($('#fd-n-' + n.id));
    renderEdges();
    renderMap();
    renderPoll(n.id);
    renderNotes();
    renderOutline();
    renderDots();
    burst();
    if (!noPush && location.hash !== '#' + n.id) {
      try { history.replaceState(null, '', '#' + n.id); } catch (e) { }
    }
  }

  function burst() {
    var host = $('#fd-burst');
    var n = cur();
    var sx = cam.tx + (n.x + NW / 2) * cam.scale;
    var sy = cam.ty + (n.y + NH / 2) * cam.scale;
    host.innerHTML = '';
    var colors = ['#5b6cff', '#ff6b4a', '#17b978', '#e39b16'];
    for (var i = 0; i < 12; i++) {
      var d = document.createElement('i');
      var a = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
      var r = 70 + Math.random() * 110;
      d.style.left = sx + 'px';
      d.style.top = sy + 'px';
      d.style.background = colors[i % colors.length];
      d.style.setProperty('--tx', Math.cos(a) * r + 'px');
      d.style.setProperty('--ty', Math.sin(a) * r + 'px');
      d.style.animationDelay = (i * 16) + 'ms';
      host.appendChild(d);
    }
    setTimeout(function () { host.innerHTML = ''; }, 900);
  }

  /* ============ 小地图 ============ */

  function renderMap() {
    var svg = $('#fd-map-svg');
    svg.setAttribute('viewBox', '0 0 ' + M.W + ' ' + M.H);
    var n = cur();
    var done = {};
    M.order.slice(0, M.idx).forEach(function (id) { done[id] = 1; });
    var out = '';
    M.edges.forEach(function (e) {
      var a = M.byId[e.from], b = M.byId[e.to];
      var live = (e.to === n.id) ? ' is-live' : '';
      out += '<path class="fd-me' + live + '" d="' + edgePath(a, b) + '"/>';
    });
    M.nodes.forEach(function (m) {
      var cls = 'fd-mn' + (m.id === n.id ? ' is-cur' : (done[m.id] ? ' is-done' : ''));
      out += '<rect class="' + cls + '" data-id="' + esc(m.id) + '" x="' + m.x + '" y="' + m.y + '" width="' + NW + '" height="' + NH + '" rx="48"/>';
      if (m.poll) out += '<circle class="fd-mp" cx="' + (m.x + 70) + '" cy="' + (m.y + 70) + '" r="34"/>';
      if (S.dirty[m.id]) out += '<circle class="fd-md" cx="' + (m.x + NW - 70) + '" cy="' + (m.y + 70) + '" r="34"/>';
    });
    out += '<rect class="fd-mc" x="' + cam.x + '" y="' + cam.y + '" width="' + cam.w + '" height="' + cam.h + '" rx="40"/>';
    svg.innerHTML = out;
    $('#fd-map-pos').textContent = (M.idx + 1) + ' / ' + M.order.length;
  }

  /* ============ 投票 / 评分 ============ */

  /* 中位数：平均数会被极端值拽跑，中位数才反映真实水位 */
  function median(nums) {
    if (!nums || !nums.length) return null;
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  var numTxt = function (v) { return v == null ? '—' : (v % 1 === 0 ? String(v) : v.toFixed(1)); };

  function pollData(n) {
    if (!S.polls[n.id]) S.polls[n.id] = n.poll.type === 'rating' ? { raters: {} } : { voters: {} };
    return S.polls[n.id];
  }

  function renderPoll(id) {
    var n = M.byId[id];
    if (!n || !n.poll) return;
    var host = document.querySelector('#fd-n-' + id + ' [data-poll]');
    if (!host) return;

    var spec = n.poll, st = pollData(n), html = '';

    if (spec.type === 'rating') {
      var vals = Object.keys(st.raters).map(function (k) { return st.raters[k]; });
      var sum = vals.reduce(function (a, b) { return a + b; }, 0);
      var avg = vals.length ? (sum / vals.length) : 0;
      var mine = st.raters[Trace.cid] || 0;
      html += '<div class="fd-poll-q">' + esc(spec.q || '打个分') + '</div><div class="fd-stars">';
      for (var s = 1; s <= 5; s++) {
        html += '<button class="fd-star' + (mine >= s ? ' is-on' : '') + '" data-vote="' + s + '">' + s + '</button>';
      }
      var md = median(vals);
      html += '</div><div class="fd-poll-meta">' + vals.length + ' 人评分 · 平均 ' + (vals.length ? avg.toFixed(1) : '—') +
        ' · 中位数 ' + numTxt(md) + ' 分' + (mine ? ' · 你给了 ' + mine + ' 分' : '') + '</div>';
    } else {
      var opts = spec.options || [];
      var counts = opts.map(function (o, i) { return Object.keys(st.voters).filter(function (k) { return st.voters[k] === i; }).length; });
      var total = counts.reduce(function (a, b) { return a + b; }, 0);
      var myPick = st.voters[Trace.cid];
      html += '<div class="fd-poll-q">' + esc(spec.q || '选一个') + '</div>';
      opts.forEach(function (o, i) {
        var pct = total ? Math.round(counts[i] / total * 100) : 0;
        html += '<button class="fd-opt' + (myPick === i ? ' is-mine' : '') + '" data-vote="' + i + '">' +
          '<span class="fd-opt-b" style="width:' + pct + '%"></span>' +
          '<span class="fd-opt-t"><span>' + esc(o) + '</span><span class="fd-opt-n">' + pct + '% · ' + counts[i] + '</span></span>' +
          '</button>';
      });
      html += '<div class="fd-poll-meta">' + total + ' 人已投' + (myPick != null ? ' · 你选了「' + esc(opts[myPick]) + '」' : '') + '</div>';
    }
    host.innerHTML = html;
  }

  function vote(id, value) {
    var n = M.byId[id];
    if (!n || !n.poll) return;
    var st = pollData(n);
    if (n.poll.type === 'rating') st.raters[Trace.cid] = value;
    else st.voters[Trace.cid] = value;
    saveLocal();
    renderPoll(id);
    Trace.pub({ t: 'vote', cid: Trace.cid, nodeId: id, value: value });
  }

  /* ============ 标注钉 ============ */

  function noteList(id) { return S.notes[id] || []; }

  function renderPins(id) {
    var node = $('#fd-n-' + id);
    if (!node) return;
    $$('.fd-pin', node).forEach(function (p) { p.remove(); });
    noteList(id).forEach(function (note, i) {
      var b = document.createElement('button');
      b.className = 'fd-pin';
      b.textContent = i + 1;
      b.style.left = (note.x * 100) + '%';
      b.style.top = (note.y * 100) + '%';
      b.title = note.who + '：' + note.text;
      b.dataset.note = note.id;
      node.appendChild(b);
    });
  }

  var composer = null;

  function openComposer(clientX, clientY, id) {
    closeComposer();
    var stage = $('#fd-stage');
    var stageRect = stage.getBoundingClientRect();
    var node = $('#fd-n-' + id);
    var nr = node.getBoundingClientRect();
    var rx = clamp((clientX - nr.left) / nr.width, 0, 1);
    var ry = clamp((clientY - nr.top) / nr.height, 0, 1);

    composer = document.createElement('div');
    composer.className = 'fd-composer';
    composer.innerHTML =
      '<textarea placeholder="在这一点上写点什么…"></textarea>' +
      '<div class="fd-composer-ft"><span class="fd-who">' + esc(S.name || '访客') + '</span>' +
      '<button class="fd-btn" data-act="cancel">取消</button>' +
      '<button class="fd-btn is-primary" data-act="save">钉上</button></div>';
    document.body.appendChild(composer);

    var w = 300, h = composer.offsetHeight || 150;
    var left = clamp(clientX - stageRect.left - w / 2, 12, window.innerWidth - w - 12);
    var top = clamp(clientY - stageRect.top + 14, 70, window.innerHeight - h - 90);
    composer.style.left = left + 'px';
    composer.style.top = top + 'px';

    var ta = $('textarea', composer);
    ta.focus();

    composer.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'cancel') { closeComposer(); return; }
      if (act === 'save') {
        var text = ta.value.trim();
        if (!text) { closeComposer(); return; }
        var note = { id: uid(8), x: rx, y: ry, text: text, who: S.name || '访客', cid: Trace.cid, ts: Date.now() };
        if (!S.notes[id]) S.notes[id] = [];
        S.notes[id].push(note);
        saveLocal();
        renderPins(id); renderNotes(); renderDots(); renderOutline();
        Trace.pub({ t: 'note:add', cid: Trace.cid, nodeId: id, note: note });
        closeComposer();
        toast('已钉上第 ' + S.notes[id].length + ' 条标注');
      }
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('[data-act="save"]', composer).click();
      if (e.key === 'Escape') closeComposer();
    });

    function onDocDown(e) { if (composer && !composer.contains(e.target)) closeComposer(); }
    setTimeout(function () { document.addEventListener('mousedown', onDocDown); }, 0);
    composer._off = function () { document.removeEventListener('mousedown', onDocDown); };
  }

  function closeComposer() {
    if (!composer) return;
    if (composer._off) composer._off();
    composer.remove();
    composer = null;
  }

  function removeNote(id, noteId) {
    S.notes[id] = noteList(id).filter(function (n) { return n.id !== noteId; });
    saveLocal();
    renderPins(id); renderNotes(); renderDots(); renderOutline();
    Trace.pub({ t: 'note:del', cid: Trace.cid, nodeId: id, noteId: noteId });
  }

  /* ============ 侧栏 ============ */

  function renderNotes() {
    var n = cur(), host = $('#fd-notes');
    if (!host) return;
    var list = noteList(n.id);
    $('#fd-note-count').textContent = list.length;
    if (!list.length) {
      host.innerHTML = '<div class="fd-empty">本页还没有标注。打开「标注」后，点页面上任意位置就能钉一条意见。</div>';
      return;
    }
    host.innerHTML = list.map(function (x, i) {
      return '<div class="fd-note"><div class="fd-note-hd"><span class="fd-note-n">' + (i + 1) + '</span>' +
        '<span class="fd-note-who">' + esc(x.who) + '</span>' +
        (x.cid === Trace.cid ? '<button class="fd-note-del" data-del="' + esc(x.id) + '">删除</button>' : '') +
        '</div>' + esc(x.text) + '</div>';
    }).join('');
  }

  function renderOutline() {
    var host = $('#fd-out');
    if (!host) return;
    host.innerHTML = M.order.map(function (id, i) {
      var m = M.byId[id];
      var tags = '';
      if (m.poll) tags += '<span class="fd-tag t-poll">投票</span>';
      if (noteList(id).length) tags += '<span class="fd-tag t-note">' + noteList(id).length + '</span>';
      if (S.dirty[id]) tags += '<span class="fd-tag t-dirty">改</span>';
      return '<li data-i="' + i + '" class="' + (i === M.idx ? 'is-cur' : '') + '"><b>' + esc(m.label || m.id) + '</b>' + tags + '</li>';
    }).join('');
  }

  function renderPanel() {
    var host = $('#fd-panel-bd');
    if (!host) return;
    host.innerHTML =
      '<h4>你是</h4>' +
      '<input class="fd-name" id="fd-name" placeholder="填个名字，标注和投票会带上" value="' + esc(S.name) + '">' +
      '<h4>本页标注 <span id="fd-note-count">0</span></h4>' +
      '<div id="fd-notes"></div>' +
      '<h4>流程</h4>' +
      '<ol class="fd-out" id="fd-out"></ol>';
    renderNotes();
    renderOutline();
    var input = $('#fd-name');
    input.addEventListener('input', function () {
      S.name = input.value.trim();
      try { localStorage.setItem('flowdeck:name', S.name); } catch (e) { }
      saveLocal();
      Trace.pub({ t: 'here', cid: Trace.cid, name: S.name });
    });
    host.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('#fd-out li') : null;
      if (li) { goto(parseInt(li.dataset.i, 10)); return; }
      var del = e.target.getAttribute && e.target.getAttribute('data-del');
      if (del) removeNote(cur().id, del);
    });
  }

  function renderDots() {
    var host = $('#fd-dots');
    if (!host) return;
    host.innerHTML = M.order.map(function (id, i) {
      var cls = (i === M.idx ? 'is-on is-cur' : '') + (noteList(id).length ? ' has-note' : '');
      return '<button class="' + cls + '" data-i="' + i + '" title="' + esc(M.byId[id].label || id) + '"></button>';
    }).join('');
  }

  function renderPeople() {
    var c = Trace.count();
    var label = c + ' 人在线';
    $('#fd-people').textContent = label;
    $('#fd-users').textContent = label;
    $('#fd-dot').className = 'fd-dot' + (c > 1 ? '' : ' is-idle');
  }

  /* ============ 就地编辑 ============ */

  var EDIT_TOOLS = [
    { act: 'h2', label: '大标题' },
    { act: 'p', label: '正文' },
    { act: 'bold', label: '加粗' },
    { act: 'ul', label: '列表' },
    { act: 'table', label: '表格' },
    { act: 'image', label: '图片' },
    { act: 'shape', label: '图形' },
    { act: 'hr', label: '分隔' },
    { act: 'undo', label: '撤销' },
    { act: 'done', label: '完成' }
  ];

  var SHAPES = [
    '<svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="46" fill="#eceefe" stroke="#5b6cff" stroke-width="3"/><path d="M40 62l14 14 26-30" fill="none" stroke="#5b6cff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '<svg width="220" height="60" viewBox="0 0 220 60"><rect x="2" y="10" width="140" height="40" rx="10" fill="#eceefe" stroke="#5b6cff" stroke-width="3"/><path d="M150 30h48m0 0l-14-12m14 12l-14 12" fill="none" stroke="#5b6cff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '<svg width="120" height="120" viewBox="0 0 120 120"><path d="M60 12l15 30 33 5-24 23 6 33-30-16-30 16 6-33-24-23 33-5z" fill="#fff3c4" stroke="#e39b16" stroke-width="3" stroke-linejoin="round"/></svg>'
  ];
  var shapeI = 0;

  function buildEditBar() {
    var bar = $('#fd-editbar');
    bar.innerHTML = EDIT_TOOLS.map(function (t) {
      return '<button class="fd-btn" data-tool="' + t.act + '">' + t.label + '</button>';
    }).join('') + '<input type="file" accept="image/*" id="fd-file" hidden>';
  }

  function caretTo(el, atStart) {
    try {
      var r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(!!atStart);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) { }
  }

  function cleanHTML(root) {
    var c = root.cloneNode(true);
    $$('[style]', c).forEach(function (e) {
      e.style.removeProperty('--i');
      if (!e.getAttribute('style')) e.removeAttribute('style');
    });
    return c.innerHTML;
  }

  function exec(cmd, val) {
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { }
    try { document.execCommand(cmd, false, val || null); } catch (e) { }
    afterEdit();
  }

  function afterEdit() {
    var n = cur();
    var b = document.querySelector('#fd-n-' + n.id + ' [data-body]');
    if (!b) return;
    S.html[n.id] = cleanHTML(b);
    S.dirty[n.id] = 1;
    stagger($('#fd-n-' + n.id));
    saveLocal();
    renderMap();
    renderOutline();
  }

  function insertHTML(html) { exec('insertHTML', html); }

  function applyTool(act) {
    var n = cur();
    var b = document.querySelector('#fd-n-' + n.id + ' [data-body]');
    if (b) {
      b.focus();
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !b.contains(sel.anchorNode)) caretTo(b, false);
    }
    if (act === 'h2') return exec('formatBlock', '<h2>');
    if (act === 'p') return exec('formatBlock', '<p>');
    if (act === 'bold') return exec('bold');
    if (act === 'ul') return exec('insertUnorderedList');
    if (act === 'undo') return exec('undo');
    if (act === 'hr') return insertHTML('<hr>');
    if (act === 'table') {
      var rows = 3, cols = 3, h = '<table>';
      for (var r = 0; r < rows; r++) {
        h += '<tr>';
        for (var c = 0; c < cols; c++) h += (r === 0 ? '<th>表头 ' + (c + 1) + '</th>' : '<td>内容</td>');
        h += '</tr>';
      }
      return insertHTML(h + '</table><p><br></p>');
    }
    if (act === 'shape') { insertHTML(SHAPES[shapeI % SHAPES.length]); shapeI++; return; }
    if (act === 'image') { $('#fd-file').click(); return; }
    if (act === 'done') { setMode(null); return; }
  }

  function wireFile() {
    $('#fd-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) { toast('图片请控制在 4MB 以内（会内联进单文件）'); e.target.value = ''; return; }
      var fr = new FileReader();
      fr.onload = function () {
        insertHTML('<img src="' + fr.result + '" alt="' + esc(f.name) + '"><p><br></p>');
        toast('图片已插入并内联');
      };
      fr.readAsDataURL(f);
      e.target.value = '';
    });
  }

  function setMode(m) {
    M.mode = (M.mode === m) ? null : m;
    var n = cur();
    $$('.fd-node').forEach(function (d) {
      d.classList.remove('is-editing');
      var b = $('[data-body]', d);
      if (b) b.removeAttribute('contenteditable');
    });
    var node = $('#fd-n-' + n.id), body = $('[data-body]', node);
    if (M.mode === 'edit' && body) {
      body.setAttribute('contenteditable', 'true');
      node.classList.add('is-editing');
      body.focus();
      caretTo(body, false);   // 否则浏览器会把整段内容选中，插入会覆盖全文
    }
    if (M.mode !== 'annotate') closeComposer();
    document.body.classList.toggle('fd-editing', M.mode === 'edit');
    document.body.classList.toggle('fd-annotating', M.mode === 'annotate');
    $('#fd-m-edit').classList.toggle('is-on', M.mode === 'edit');
    $('#fd-m-note').classList.toggle('is-on', M.mode === 'annotate');
    if (M.mode === 'edit') toast('直接改文字；表格 / 图片 / 图形用下面工具条');
    if (M.mode === 'annotate') toast('点页面上任意位置钉一条标注');
  }

  var onBodyInput = debounce(afterEdit, 320);

  /* ============ 导出单文件 ============ */

  function snapshot() {
    var spec = JSON.parse(JSON.stringify({
      id: M.spec.id, title: M.spec.title, subtitle: M.spec.subtitle,
      start: M.spec.start, order: M.order, nodes: M.spec.nodes, edges: M.spec.edges
    }));
    spec.nodes = spec.nodes.map(function (n) {
      var o = JSON.parse(JSON.stringify(n));
      if (S.html[o.id] != null) o.html = S.html[o.id];
      return o;
    });
    return spec;
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'text/html;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      return true;
    } catch (e) { return false; }
  }

  function exportSingle() {
    if (!ASSETS.css || !ASSETS.js) { toast('请先 npm run build，从构建产物里导出'); return; }
    var spec = snapshot();
    var json = JSON.stringify(spec).replace(/</g, '\\u003c');
    var doc = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + esc(spec.title || spec.id) + '</title>\n' +
      '<style data-flowdeck>' + ASSETS.css + '</style>\n</head>\n<body>\n' +
      '<script>window.__DECK__=' + json + ';<\/script>\n' +
      '<script data-flowdeck>' + ASSETS.js + '<\/script>\n</body>\n</html>\n';
    if (download((spec.id || 'deck') + '.html', doc)) toast('已导出自包含单文件');
    else toast('浏览器拦下了下载，允许下载后重试');
  }

  /* ============ 事件编排 ============ */

  function wire() {
    $('#fd-next').addEventListener('click', function () { goto(M.idx + 1); });
    $('#fd-prev').addEventListener('click', function () { goto(M.idx - 1); });

    $('#fd-dots').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (b) goto(parseInt(b.dataset.i, 10));
    });

    $('#fd-map-svg').addEventListener('click', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-id');
      if (id) goto(M.order.indexOf(id));
    });

    $('#fd-m-edit').addEventListener('click', function () { setMode('edit'); });
    $('#fd-m-note').addEventListener('click', function () { setMode('annotate'); });
    $('#fd-m-users').addEventListener('click', function () {
      var p = $('#fd-panel');
      var open = !p.classList.contains('is-open');
      p.classList.toggle('is-open', open);
      document.body.classList.toggle('fd-panel-open', open);
    });
    $('#fd-panel-close').addEventListener('click', function () {
      $('#fd-panel').classList.remove('is-open');
      document.body.classList.remove('fd-panel-open');
    });
    $('#fd-export').addEventListener('click', exportSingle);

    $('#fd-reset-page').addEventListener('click', function () {
      var id = cur().id;
      delete S.html[id]; delete S.notes[id]; S.polls[id] = null; delete S.dirty[id];
      var n = M.byId[id];
      if (n.poll) S.polls[id] = n.poll.type === 'rating' ? { raters: {} } : { voters: {} };
      $('[data-body]', $('#fd-n-' + id)).innerHTML = n.html || '';
      stagger($('#fd-n-' + id));
      saveLocal();
      renderPins(id); renderPoll(id); renderNotes(); renderOutline(); renderMap();
      toast('本页已回到初始状态');
    });

    $('#fd-reset-all').addEventListener('click', function () {
      S.html = {}; S.notes = {}; S.polls = {}; S.dirty = {};
      M.nodes.forEach(function (n) {
        $('[data-body]', $('#fd-n-' + n.id)).innerHTML = n.html || '';
        renderPins(n.id); renderPoll(n.id);
        stagger($('#fd-n-' + n.id));
      });
      try { localStorage.removeItem(LSKEY()); } catch (e) { }
      renderNotes(); renderOutline(); renderMap(); renderDots();
      toast('全部数据已重置');
    });

    $('#fd-editbar').addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-tool');
      if (act) applyTool(act);
    });

    $('#fd-world').addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('[data-body]')) onBodyInput();
    });

    $('#fd-world').addEventListener('click', function (e) {
      var voteBtn = e.target.closest ? e.target.closest('[data-vote]') : null;
      if (voteBtn) {
        /* 票要记到按钮所属的节点，而不是当前节点：画布上多个节点同时可见，
           点邻居页的星星不该把票算到当前页（当前页没组件时还会直接丢票） */
        var hostN = e.target.closest('.fd-node');
        vote(hostN ? hostN.id.slice(5) : cur().id, parseInt(voteBtn.dataset.vote, 10));
        return;
      }

      var pin = e.target.closest ? e.target.closest('.fd-pin') : null;
      if (pin) {
        var hostP = e.target.closest('.fd-node');
        var id = hostP ? hostP.id.slice(5) : cur().id;
        var note = noteList(id).filter(function (x) { return x.id === pin.dataset.note; })[0];
        if (note) toast(note.who + '：' + note.text);
        return;
      }

      if (M.mode === 'annotate') {
        var nodeEl = e.target.closest ? e.target.closest('.fd-node') : null;
        if (nodeEl && nodeEl.classList.contains('is-current')) openComposer(e.clientX, e.clientY, cur().id);
      }
    });

    document.addEventListener('keydown', function (e) {
      var editing = M.mode === 'edit' || (e.target.matches && e.target.matches('[contenteditable="true"], textarea, input'));
      if (editing) { if (e.key === 'Escape') setMode(null); return; }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); goto(M.idx + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goto(M.idx - 1); }
      else if (e.key === 'e' || e.key === 'E') setMode('edit');
      else if (e.key === 'a' || e.key === 'A') setMode('annotate');
      else if (e.key === 'Escape') setMode(null);
    });

    var onResize = debounce(function () { applyCam(false); renderMap(); }, 120);
    window.addEventListener('resize', onResize);

    Trace.onPeers = renderPeople;
  }

  function onRemote(m) {
    if (m.t === 'vote') {
      var st = S.polls[m.nodeId];
      if (!st) return;
      if (M.byId[m.nodeId].poll.type === 'rating') st.raters[m.cid] = m.value;
      else st.voters[m.cid] = m.value;
      renderPoll(m.nodeId);
      return;
    }
    if (m.t === 'note:add') {
      if (!S.notes[m.nodeId]) S.notes[m.nodeId] = [];
      var exists = S.notes[m.nodeId].some(function (x) { return x.id === m.note.id; });
      if (!exists) S.notes[m.nodeId].push(m.note);
      renderPins(m.nodeId); renderNotes(); renderDots(); renderOutline();
      if (m.nodeId === cur().id) toast(m.note.who + ' 钉了一条标注');
      return;
    }
    if (m.t === 'note:del') {
      S.notes[m.nodeId] = noteList(m.nodeId).filter(function (x) { return x.id !== m.noteId; });
      renderPins(m.nodeId); renderNotes(); renderDots(); renderOutline();
      return;
    }
    if (m.t === 'poll:reset') { S.polls[m.nodeId] = null; renderPoll(m.nodeId); }
  }

  /* ============ 启动 ============ */

  function boot(spec) {
    M.spec = spec;
    deckId = spec.id || 'deck';
    normalize(spec);
    readRoomQuery();

    loadLocal();
    try { S.name = S.name || localStorage.getItem('flowdeck:name') || ''; } catch (e) { }

    buildShell();
    buildEditBar();
    buildNodes();
    renderPanel();
    renderDots();
    wire();
    wireFile();

    M.nodes.forEach(function (n) { renderPoll(n.id); renderPins(n.id); });

    var h = (location.hash || '').replace('#', '');
    var i = M.order.indexOf(h);
    goto(i >= 0 ? i : 0, true);

    Trace.join(deckId, onRemote, renderPeople);

    requestAnimationFrame(function () { applyCam(false); renderMap(); });
    setTimeout(function () { applyCam(false); renderMap(); }, 220);
  }

  function start() {
    if (window.__DECK__) { boot(window.__DECK__); return; }
    var src = document.body.getAttribute('data-deck') || './deck.json';
    fetch(src).then(function (r) { return r.json(); }).then(boot).catch(function (e) {
      document.body.innerHTML = '<div style="padding:40px;font:14px -apple-system,sans-serif;color:#6b6b76">' +
        '没有读到规格文件：' + esc(src) + '<br>（localStorage 之外的本地读取需要起一个静态服务，例如 npm start）</div>';
    });
  }

  window.FlowDeck = {
    goto: goto, snapshot: snapshot, exportSingle: exportSingle,
    state: S, model: M, transport: Trace, room: Room, assets: ASSETS
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
