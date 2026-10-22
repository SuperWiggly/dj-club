// Virtual DJ club server: serves the web page and relays avatar positions,
// dances and emotes between everyone in the club over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CHANNEL = (process.env.TWITCH_CHANNEL || 'we_love_super').toLowerCase();
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 100;
// Guests (no Twitch login) are handy for testing. Off by default once a client ID is set.
const ALLOW_GUESTS = process.env.ALLOW_GUESTS
  ? process.env.ALLOW_GUESTS === 'true'
  : !TWITCH_CLIENT_ID;

const TICK_MS = 100; // how often positions are sent out (10 times a second)
const ROOM = { minX: -14, maxX: 14, minZ: -9, maxZ: 13 }; // walkable floor
const STAGE = { minX: -5, maxX: 5, minZ: -9, maxZ: -5 }; // the DJ and invited guests only
const VIP = { minX: 3, maxX: 13.5, minZ: -15.5, maxZ: -10.8 }; // green room behind the back wall
const DOOR = { minX: 7.4, maxX: 8.6, minZ: -11, maxZ: -8.9 }; // doorway from the club into the green room
const DANCES = ['none', 'bounce', 'spin', 'sway', 'jump'];
const EMOTES = ['🔥', '❤️', '🙌', '😂', '🎉', '💯', '👏', '🕺'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config.json') {
    return sendJson(res, {
      clientId: TWITCH_CLIENT_ID,
      channel: TWITCH_CHANNEL,
      allowGuests: ALLOW_GUESTS,
      maxPlayers: MAX_PLAYERS,
      dances: DANCES,
      emotes: EMOTES,
      room: ROOM,
      stage: STAGE,
      vip: VIP,
      door: DOOR,
    });
  }
  if (url.pathname === '/health') return sendJson(res, { ok: true, players: players.size });

  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function sendJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function notFound(res) {
  res.writeHead(404);
  res.end('Not found');
}

// ---- Twitch login check ----
// The browser logs in with Twitch and sends us its token. We ask Twitch who it
// belongs to, so nobody can pretend to be someone else (or pretend to be the DJ).
const tokenCache = new Map(); // token -> { login, name, expires }
async function whoIs(token) {
  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) return cached;
  const v = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!v.ok) return null;
  const info = await v.json();
  if (info.client_id !== TWITCH_CLIENT_ID || !info.login) return null;
  let name = info.login;
  try {
    const u = await fetch(`https://api.twitch.tv/helix/users?id=${info.user_id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': TWITCH_CLIENT_ID },
    });
    if (u.ok) name = (await u.json()).data?.[0]?.display_name || name;
  } catch {}
  const who = { login: info.login, name, expires: Date.now() + 10 * 60 * 1000 };
  tokenCache.set(token, who);
  return who;
}

// ---- Club state ----
const players = new Map(); // id -> player
let nextId = 1;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Same rules as canStand() in public/club.js.
const inBox = (b, x, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
function canStand(x, z, p) {
  const inMain = inBox(ROOM, x, z);
  if (inMain && x > STAGE.minX - 0.5 && x < STAGE.maxX + 0.5 && z < STAGE.maxZ + 0.5) return p.stage;
  if (inMain) return true;
  if (inBox(DOOR, x, z) || inBox(VIP, x, z)) return p.vip;
  return false;
}

function publicInfo(p) {
  return { id: p.id, name: p.name, isDj: p.isDj, stage: p.stage, vip: p.vip, x: p.x, z: p.z, ry: p.ry, dance: p.dance };
}

function broadcast(msg, except) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const p of players.values()) {
    if (p !== except && p.ws.readyState === 1) p.ws.send(data);
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 });

wss.on('connection', (ws) => {
  let player = null;
  let msgCount = 0;
  const rateTimer = setInterval(() => (msgCount = 0), 1000);
  const helloTimeout = setTimeout(() => !player && ws.close(4000, 'No hello'), 10000);

  ws.on('message', async (raw) => {
    if (++msgCount > 40) return; // ignore spam (normal clients send ~10/second)
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'hello' && !player && !ws._joining) {
      ws._joining = true;
      if (players.size >= MAX_PLAYERS) return ws.close(4001, 'The club is full right now');

      let login, name, testDj = false;
      if (typeof m.token === 'string' && TWITCH_CLIENT_ID) {
        const who = await whoIs(m.token).catch(() => null);
        if (!who) return ws.close(4002, 'Twitch login expired, please log in again');
        ({ login, name } = who);
      } else if (ALLOW_GUESTS) {
        name = String(m.guestName || '').replace(/[^\w ]/g, '').trim().slice(0, 20) || 'Guest';
        // Testing only: lets a guest stand behind the booth when TEST_DJ_NAME is set.
        testDj = !!process.env.TEST_DJ_NAME && name.toLowerCase() === process.env.TEST_DJ_NAME.toLowerCase();
        name += '#' + Math.floor(Math.random() * 900 + 100);
        login = null;
      } else {
        return ws.close(4003, 'Please log in with Twitch');
      }
      if (ws.readyState !== 1) return;
      if (players.size >= MAX_PLAYERS) return ws.close(4001, 'The club is full right now');

      // One avatar per Twitch account: a new tab replaces the old one.
      if (login) {
        for (const other of players.values()) if (other.login === login) other.ws.close(4004, 'You joined from another tab');
      }

      const isDj = testDj || (!!login && login === TWITCH_CHANNEL);
      player = {
        id: nextId++, ws, login, name, isDj,
        stage: isDj, vip: isDj,
        x: isDj ? 0 : (Math.random() - 0.5) * 16,
        z: isDj ? -7 : 4 + Math.random() * 7,
        ry: isDj ? 0 : Math.PI, dance: 'none', moved: true,
      };
      players.set(player.id, player);
      clearTimeout(helloTimeout);
      ws.send(JSON.stringify({ t: 'welcome', you: publicInfo(player), players: [...players.values()].map(publicInfo) }));
      broadcast({ t: 'join', p: publicInfo(player) }, player);
      return;
    }
    if (!player) return;

    if (m.t === 'move') {
      // Trust the browser's position, but only where this person is allowed to stand.
      const x = num(m.x, player.x), z = num(m.z, player.z);
      if (Math.hypot(x - player.x, z - player.z) > 3) return; // no teleporting
      if (canStand(x, z, player)) { player.x = x; player.z = z; }
      else if (canStand(x, player.z, player)) player.x = x;
      else if (canStand(player.x, z, player)) player.z = z;
      player.ry = num(m.ry, player.ry);
      player.moved = true;
    } else if (m.t === 'dance' && DANCES.includes(m.d)) {
      player.dance = m.d;
      broadcast({ t: 'dance', id: player.id, d: m.d });
    } else if (m.t === 'emote' && EMOTES.includes(m.e)) {
      const now = Date.now();
      if (now - (player.lastEmote || 0) < 300) return;
      player.lastEmote = now;
      broadcast({ t: 'emote', id: player.id, e: m.e });
    } else if (m.t === 'grant' && player.isDj && (m.perm === 'stage' || m.perm === 'vip')) {
      // The DJ invites someone on stage / into the green room, or takes it back.
      const target = players.get(m.id);
      if (!target || target.isDj) return;
      target[m.perm] = !!m.on;
      broadcast({ t: 'perms', id: target.id, stage: target.stage, vip: target.vip, perm: m.perm, on: !!m.on });
      if (!canStand(target.x, target.z, target)) {
        // Walk them back out to the dance floor.
        target.x = (Math.random() - 0.5) * 8;
        target.z = 2 + Math.random() * 4;
        target.moved = true;
        if (target.ws.readyState === 1) target.ws.send(JSON.stringify({ t: 'tp', x: target.x, z: target.z }));
      }
    }
  });

  ws.on('close', () => {
    clearInterval(rateTimer);
    clearTimeout(helloTimeout);
    if (player && players.get(player.id) === player) {
      players.delete(player.id);
      broadcast({ t: 'leave', id: player.id });
    }
  });
  ws.on('error', () => {});
});

// Send everyone the positions of whoever moved since last tick.
setInterval(() => {
  const moved = [];
  for (const p of players.values()) {
    if (!p.moved) continue;
    p.moved = false;
    moved.push([p.id, Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100, Math.round(p.ry * 100) / 100]);
  }
  if (moved.length) broadcast({ t: 'pos', m: moved });
}, TICK_MS);

// Drop dead connections (closed laptops, lost Wi-Fi).
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._dead) { ws.terminate(); continue; }
    ws._dead = true;
    ws.ping();
  }
}, 30000);
wss.on('connection', (ws) => ws.on('pong', () => (ws._dead = false)));

// Forget old login checks.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenCache) if (v.expires < now) tokenCache.delete(k);
}, 60000);

server.listen(PORT, () => {
  console.log(`DJ club running at http://localhost:${PORT}`);
  console.log(`Channel: ${TWITCH_CHANNEL || '(not set)'} | Twitch login: ${TWITCH_CLIENT_ID ? 'on' : 'off'} | Guests: ${ALLOW_GUESTS ? 'allowed' : 'off'} | Max: ${MAX_PLAYERS}`);
});
