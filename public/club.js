import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
const config = await fetch('/config.json').then((r) => r.json());
const BPM = 124; // lights pulse to this tempo (not synced to the real music yet)
const FONT = '"Chakra Petch", system-ui, sans-serif';

// ---------------------------------------------------------------- login
const TOKEN_KEY = 'club.twitchToken';
const store = {
  get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, v); } catch {} },
  del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
};

// Coming back from Twitch login: the token is in the address bar after "#".
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('access_token')) {
  store.set(TOKEN_KEY, hash.get('access_token'), sessionStorage);
  history.replaceState(null, '', location.pathname + location.search);
} else if (hash.get('error')) {
  $('error').textContent = 'Twitch login was cancelled.';
  history.replaceState(null, '', location.pathname + location.search);
}

if (config.channel) $('subtitle').textContent = `Come dance while ${config.channel} plays live.`;
if (config.clientId) $('twitchLogin').hidden = false;
if (config.allowGuests) $('guestBox').hidden = false;
if (!config.clientId && !config.allowGuests) $('error').textContent = 'Login is not set up yet.';

$('twitchLogin').onclick = () => {
  const p = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: location.origin + '/',
    response_type: 'token',
    scope: '',
  });
  location.href = 'https://id.twitch.tv/oauth2/authorize?' + p;
};
$('guestJoin').onclick = () => connect({ guestName: $('guestName').value });
$('guestName').addEventListener('keydown', (e) => e.key === 'Enter' && $('guestJoin').click());

// ---------------------------------------------------------------- network
let ws = null;
let me = null;
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

function connect(hello) {
  $('error').textContent = 'Joining…';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => send({ t: 'hello', ...hello });
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = (e) => {
    if (e.code === 4002) store.del(TOKEN_KEY, sessionStorage);
    leaveClub(e.reason || 'Disconnected. Refresh to rejoin.');
  };
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      me = m.you;
      for (const p of m.players) addAvatar(p);
      local.x = me.x; local.z = me.z; local.ry = me.isDj ? 0 : me.ry;
      $('crowdBtn').hidden = !me.isDj;
      // The DJ looks out at the crowd; everyone else looks toward the booth.
      camYaw = me.isDj ? Math.PI : 0;
      enterClub();
      break;
    case 'join': addAvatar(m.p); break;
    case 'leave':
      avatars.get(m.id)?.dispose(); avatars.delete(m.id); updateCount();
      if (djMenuFor === m.id) closeDjMenu();
      renderCrowd();
      break;
    case 'pos':
      for (const [id, x, z, ry] of m.m) {
        if (id === me?.id) continue;
        const a = avatars.get(id);
        if (a) { a.tx = x; a.tz = z; a.try = ry; }
      }
      break;
    case 'dance': avatars.get(m.id)?.setDance(m.d); break;
    case 'emote': avatars.get(m.id)?.emote(m.e); break;
    case 'perms': {
      const a = avatars.get(m.id);
      if (a) a.setPerms(m.stage, m.vip);
      if (m.id === me?.id) {
        me.stage = m.stage; me.vip = m.vip;
        const what = m.perm === 'stage' ? 'on stage' : 'into the green room';
        toast(m.on ? `The DJ invited you ${what}` : `The DJ took back your access ${m.perm === 'stage' ? 'to the stage' : 'to the green room'}`);
      }
      if (djMenuFor === m.id) openDjMenu(m.id);
      renderCrowd();
      break;
    }
    case 'tp':
      local.x = m.x; local.z = m.z; target = null;
      break;
  }
}

function enterClub() {
  $('login').hidden = true;
  $('hud').hidden = false;
  $('error').textContent = '';
  updateCount();
}
function leaveClub(reason) {
  for (const a of avatars.values()) a.dispose();
  avatars.clear();
  me = null;
  $('hud').hidden = true;
  $('login').hidden = false;
  $('error').textContent = reason;
}
let toastTimer = 0;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}
function updateCount() {
  const n = avatars.size;
  $('count').textContent = `${n} in the club`;
  renderCrowd();
}

// ---------------------------------------------------------------- 3D setup
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
const cssRenderer = new CSS3DRenderer({ element: $('css3d') });

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x030304, 18, 45);
// A soft studio reflection so black chrome actually looks like chrome.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const cssScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  cssRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w < h ? 75 : 60;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

scene.add(new THREE.HemisphereLight(0xb8bcc8, 0x050506, 0.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.5);
keyLight.position.set(4, 10, 8);
scene.add(keyLight);

const { room, stage, vip, door } = config;
const W = room.maxX - room.minX + 2, D = room.maxZ - room.minZ + 2;
const CX = (room.maxX + room.minX) / 2, CZ = (room.maxZ + room.minZ) / 2;
const H = 9;
const BACK_Z = room.minZ - 1;
const VIP_H = 4.8;
const VIP_BOX = { minX: vip.minX - 0.6, maxX: vip.maxX + 1.1, minZ: vip.minZ - 1.1, maxZ: BACK_Z };

// ---- Sigils: spiky, mirrored line art drawn on a canvas (the "cyber sigilism" look)
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A curve that starts thick and ends in a sharp point.
function thorn(ctx, pts, width) {
  const steps = 28;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [a, b, c] = pts;
    const x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0];
    const y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1];
    if (prev) {
      ctx.lineWidth = Math.max(0.6, width * (1 - t) ** 1.4);
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke();
    }
    prev = [x, y];
  }
}
function sigilCanvas(seed, color = '#e6e9f0', size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = rng(seed);
  const k = size / 512;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * k;
  const mid = size / 2;
  // Spine
  thorn(ctx, [[mid, mid], [mid, mid - 120 * k], [mid, 30 * k]], 7 * k);
  thorn(ctx, [[mid, mid], [mid, mid + 120 * k], [mid, size - 30 * k]], 7 * k);
  // Mirrored arms with small thorns branching off
  const arms = 3 + Math.floor(r() * 3);
  for (let i = 0; i < arms; i++) {
    const y0 = mid + (r() - 0.5) * 300 * k;
    const cx = 60 + r() * 120, cy = (r() - 0.5) * 260;
    const ex = 90 + r() * 140, ey = (r() - 0.5) * 380;
    const w = (3 + r() * 4) * k;
    const tx = 30 + r() * 60, ty = (r() - 0.5) * 120;
    for (const s of [-1, 1]) {
      const p0 = [mid, y0], p1 = [mid + s * cx * k, y0 + cy * k], p2 = [mid + s * ex * k, y0 + ey * k];
      thorn(ctx, [p0, p1, p2], w);
      const bx = (p0[0] + 2 * p1[0] + p2[0]) / 4, by = (p0[1] + 2 * p1[1] + p2[1]) / 4;
      thorn(ctx, [[bx, by], [bx + s * tx * 0.5 * k, by + ty * 0.2 * k], [bx + s * tx * k, by + ty * k]], w * 0.6);
    }
  }
  // Small diamond at the heart
  ctx.lineWidth = 2.5 * k;
  ctx.beginPath();
  ctx.moveTo(mid, mid - 18 * k); ctx.lineTo(mid + 10 * k, mid); ctx.lineTo(mid, mid + 18 * k); ctx.lineTo(mid - 10 * k, mid);
  ctx.closePath(); ctx.stroke();
  return c;
}
// A round sigil, used as the marker under your own avatar.
function ringSigilCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const m = size / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(m, m, m * 0.62, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = (ang, rad) => [m + Math.cos(ang) * rad, m + Math.sin(ang) * rad];
    thorn(ctx, [p(a, m * 0.62), p(a + 0.25, m * 0.8), p(a + 0.5, m * 0.96)], 5);
    thorn(ctx, [p(a, m * 0.62), p(a - 0.12, m * 0.5), p(a - 0.3, m * 0.42)], 3);
  }
  return c;
}
function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function decal(seed, sizeM, x, y, z, ry, color, opacity = 0.45) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(sizeM, sizeM),
    new THREE.MeshBasicMaterial({ map: canvasTexture(sigilCanvas(seed, color)), transparent: true, opacity, depthWrite: false }),
  );
  m.position.set(x, y, z);
  m.rotation.y = ry;
  scene.add(m);
  return m;
}
// The login screen gets a faint sigil behind the card.
try { $('login').style.setProperty('--sigil', `url(${sigilCanvas(7, '#ffffff').toDataURL()})`); } catch {}

// ---- Room
const floorMat = new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.3, metalness: 0.6 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.set(CX, 0, CZ);
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.85, metalness: 0.2, envMapIntensity: 0.15 });
function wall(w, x, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
  m.position.set(x, H / 2, z);
  m.rotation.y = ry;
  scene.add(m);
}
function box(w, h, d, x, y, z, mat = wallMat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}
wall(W, CX, room.maxZ + 1, Math.PI);
wall(D, room.minX - 1, CZ, Math.PI / 2);
wall(D, room.maxX + 1, CZ, -Math.PI / 2);
// Back wall (a solid slab, so the green room behind it can't see through) with a doorway.
const doorL = door.minX - 0.2, doorR = door.maxX + 0.2, DOOR_H = 3.2;
const wallL = room.minX - 1, wallR = room.maxX + 1;
box(doorL - wallL, H, 0.2, (wallL + doorL) / 2, H / 2, BACK_Z - 0.1);
box(wallR - doorR, H, 0.2, (wallR + doorR) / 2, H / 2, BACK_Z - 0.1);
box(doorR - doorL, H - DOOR_H, 0.2, (doorL + doorR) / 2, DOOR_H + (H - DOOR_H) / 2, BACK_Z - 0.1);

const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: 0x020203 }));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.set(CX, H, CZ);
scene.add(ceiling);

// Thin chrome lines along the walls
const chromeLine = new THREE.MeshBasicMaterial({ color: 0x8e939e });
function line(w, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.035), chromeLine);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  scene.add(m);
}
for (const y of [1.2, 7.6]) {
  line(D, room.minX - 0.97, y, CZ, Math.PI / 2);
  line(D, room.maxX + 0.97, y, CZ, Math.PI / 2);
  line(W, CX, y, room.maxZ + 0.97, 0);
}
// Sigils on the walls
[-6, 2, 10].forEach((z, i) => {
  decal(11 + i, 5.5, room.minX - 0.95, 4.4, z, Math.PI / 2, '#d7dbe4');
  decal(21 + i, 5.5, room.maxX + 0.95, 4.4, z, -Math.PI / 2, '#d7dbe4');
});
decal(31, 6, -9.5, 4.6, BACK_Z + 0.02, 0, '#d7dbe4', 0.4);
decal(32, 5, 11.8, 5.2, BACK_Z + 0.02, 0, '#d7dbe4', 0.4);
decal(33, 7, 0, 4.5, room.maxZ + 0.95, Math.PI, '#d7dbe4', 0.35);

// Light-up dance floor tiles
const TILE = 2;
const tiles = [];
for (let x = -7; x <= 7; x += TILE) for (let z = -3; z <= 9; z += TILE) tiles.push([x, z]);
const tileMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(TILE * 0.94, 0.04, TILE * 0.94),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
  tiles.length,
);
const tmp = new THREE.Object3D();
tiles.forEach(([x, z], i) => {
  tmp.position.set(x, 0.02, z);
  tmp.updateMatrix();
  tileMesh.setMatrixAt(i, tmp.matrix);
  tileMesh.setColorAt(i, new THREE.Color(0x000000));
});
scene.add(tileMesh);

// ---- Stage and DJ booth
const stageH = 0.6;
const blackChrome = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.9, roughness: 0.22 });
const stageMesh = new THREE.Mesh(
  new THREE.BoxGeometry(stage.maxX - stage.minX + 1, stageH, stage.maxZ - stage.minZ + 1),
  new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.4, metalness: 0.5 }),
);
stageMesh.position.set((stage.minX + stage.maxX) / 2, stageH / 2, (stage.minZ + stage.maxZ) / 2 - 0.5);
scene.add(stageMesh);
const edgeMat = new THREE.MeshBasicMaterial({ color: 0xe6e9f0 });
box(stage.maxX - stage.minX + 1, 0.04, 0.04, 0, stageH, stage.maxZ + 0.02, edgeMat);

const booth = new THREE.Group();
booth.position.set(0, stageH, -6);
scene.add(booth);
const boothBody = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.1), blackChrome);
boothBody.position.y = 0.55;
booth.add(boothBody);
const boothFront = new THREE.Mesh(
  new THREE.PlaneGeometry(4.0, 1.0),
  new THREE.MeshBasicMaterial({ map: canvasTexture(sigilCanvas(41, '#ffffff', 512)), transparent: true, opacity: 0.55, depthWrite: false }),
);
boothFront.position.set(0, 0.55, 0.56);
boothFront.scale.set(1, 1, 1);
booth.add(boothFront);
const boothStripMat = new THREE.MeshBasicMaterial({ color: 0xff2a4d });
const boothStrip = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.05, 0.02), boothStripMat);
boothStrip.position.set(0, 1.08, 0.56);
booth.add(boothStrip);
const decks = [];
for (const x of [-1.2, 1.2]) {
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.05, 32),
    new THREE.MeshStandardMaterial({ color: 0x151517, metalness: 0.9, roughness: 0.2 }),
  );
  deck.position.set(x, 1.13, 0);
  deck.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.04), edgeMat));
  booth.add(deck);
  decks.push(deck);
}
const mixer = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.7), blackChrome);
mixer.position.set(0, 1.13, 0);
booth.add(mixer);

// ---- Big screen behind the booth showing the Twitch stream.
// The video is a real web page placed in 3D; the 3D scene leaves a see-through hole for it.
const SCREEN_W = 12, SCREEN_H = 6.75, SCREEN_Y = 5, SCREEN_Z = BACK_Z + 0.1;
const PX_W = 1280, PX_H = 720;
const screenEl = document.createElement('div');
screenEl.id = 'twitchPlayer';
screenEl.style.cssText = `width:${PX_W}px;height:${PX_H}px;background:#000;display:grid;place-items:center;color:#8b8f99;font:600 42px ${FONT};`;
screenEl.textContent = config.channel ? 'Loading stream…' : 'Stream channel not set up yet';
const screenObj = new CSS3DObject(screenEl);
screenObj.position.set(0, SCREEN_Y, SCREEN_Z);
screenObj.scale.setScalar(SCREEN_W / PX_W);
cssScene.add(screenObj);
const hole = new THREE.Mesh(
  new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
  new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending }),
);
hole.position.copy(screenObj.position);
scene.add(hole);
const frameMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 1, roughness: 0.15 });
for (const [w, h, x, y] of [
  [SCREEN_W + 0.16, 0.08, 0, SCREEN_H / 2 + 0.04], [SCREEN_W + 0.16, 0.08, 0, -SCREEN_H / 2 - 0.04],
  [0.08, SCREEN_H, SCREEN_W / 2 + 0.04, 0], [0.08, SCREEN_H, -SCREEN_W / 2 - 0.04, 0],
]) {
  box(w, h, 0.05, x, SCREEN_Y + y, SCREEN_Z + 0.01, frameMat);
}

let twitchPlayer = null;
// Called after the first frame, once the screen element is on the page.
// If Twitch fails to load, the club still works; only the screen stays empty.
function startTwitchPlayer() {
  if (!config.channel) return;
  try {
    if (!window.Twitch?.Player) throw new Error('Twitch player script did not load');
    screenEl.textContent = '';
    twitchPlayer = new Twitch.Player(screenEl.id, {
      channel: config.channel,
      parent: [location.hostname],
      width: PX_W, height: PX_H,
      muted: true, autoplay: true,
    });
  } catch (err) {
    console.error(err);
    twitchPlayer = null;
    screenEl.textContent = "Couldn't load the stream. Watch on twitch.tv/" + config.channel;
  }
}
let soundOn = false;
$('sound').onclick = () => {
  if (!twitchPlayer) return;
  soundOn = !soundOn;
  twitchPlayer.setMuted(!soundOn);
  if (soundOn) { twitchPlayer.setVolume(Number($('volume').value)); twitchPlayer.play(); }
  $('sound').textContent = soundOn ? '🔊 Sound on' : '🔇 Tap for sound';
};
$('volume').oninput = () => twitchPlayer?.setVolume(Number($('volume').value));
if (!config.channel) $('sound').hidden = $('volume').hidden = true;

// ---- Green room / VIP lounge behind the back wall
{
  const bx = VIP_BOX, w = bx.maxX - bx.minX, d = bx.maxZ - bx.minZ;
  const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
  const vFloor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  vFloor.rotation.x = -Math.PI / 2;
  vFloor.position.set(cx, 0.001, cz);
  scene.add(vFloor);
  floor.userData.extra = vFloor;
  const vCeil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x020203 }));
  vCeil.rotation.x = Math.PI / 2;
  vCeil.position.set(cx, VIP_H, cz);
  scene.add(vCeil);
  box(w, VIP_H, 0.2, cx, VIP_H / 2, bx.minZ - 0.1);
  box(0.2, VIP_H, d, bx.minX - 0.1, VIP_H / 2, cz);
  box(0.2, VIP_H, d, bx.maxX + 0.1, VIP_H / 2, cz);
  // Lounge furniture: black leather sofas, a chrome-topped bar
  const leather = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.55, metalness: 0.1 });
  box(4, 0.45, 1, cx - 1, 0.23, bx.minZ + 0.6, leather);
  box(4, 0.8, 0.25, cx - 1, 0.6, bx.minZ + 0.2, leather);
  box(1, 0.45, 3, bx.minX + 0.6, 0.23, cz - 0.5, leather);
  box(0.25, 0.8, 3, bx.minX + 0.2, 0.6, cz - 0.5, leather);
  box(0.7, 1.05, 3.2, bx.maxX - 0.5, 0.53, cz, blackChrome);
  box(0.8, 0.05, 3.3, bx.maxX - 0.5, 1.08, cz, frameMat);
  // A red sigil glowing on the back wall
  decal(51, 3.6, cx, 2.5, bx.minZ + 0.02, 0, '#ff2a4d', 0.85);
  const red = new THREE.PointLight(0xff2a4d, 6, 9, 1.5);
  red.position.set(cx, 3.6, cz);
  scene.add(red);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xff2a4d });
  box(w, 0.03, 0.03, cx, 3.9, bx.minZ + 0.02, lineMat);
}
// Doorway: chrome frame, a red bar across it, and a sign above
for (const x of [doorL, doorR]) box(0.06, DOOR_H, 0.26, x, DOOR_H / 2, BACK_Z - 0.1, frameMat);
box(doorR - doorL + 0.06, 0.06, 0.26, (doorL + doorR) / 2, DOOR_H, BACK_Z - 0.1, frameMat);
const ropeMat = new THREE.MeshBasicMaterial({ color: 0xff2a4d, transparent: true, opacity: 0.8 });
const rope = box(doorR - doorL, 0.03, 0.03, (doorL + doorR) / 2, 1.0, BACK_Z + 0.05, ropeMat);
const vipSign = textSprite('GREEN ROOM · VIP', { size: 40, border: '#ff2a4d' });
vipSign.position.set((doorL + doorR) / 2, DOOR_H + 0.45, BACK_Z + 0.15);
vipSign.scale.multiplyScalar(1.4);
scene.add(vipSign);

// ---- Moving light beams and colored spotlights (the lights stay colorful)
const beams = [];
const beamGeo = new THREE.ConeGeometry(1.4, 9, 24, 1, true);
beamGeo.translate(0, -4.5, 0);
const beamColors = [0xff2bd6, 0x29e7ff, 0x9146ff, 0x3dff8b, 0xffd12b, 0xff2bd6];
beamColors.forEach((c, i) => {
  const mat = new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beam = new THREE.Mesh(beamGeo, mat);
  beam.position.set(-10 + i * 4, H - 0.2, -2);
  scene.add(beam);
  beams.push(beam);
});
const spots = [0xff2bd6, 0x29e7ff, 0x9146ff].map((c, i) => {
  const l = new THREE.PointLight(c, 30, 16, 1.6);
  l.position.set(-6 + i * 6, 4, 2);
  scene.add(l);
  return l;
});

// ---------------------------------------------------------------- avatars
const avatars = new Map();
const bodyGeo = new THREE.CapsuleGeometry(0.35, 0.7, 6, 16);
const eyeGeo = new THREE.BoxGeometry(0.12, 0.028, 0.02);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const phonesGeo = new THREE.TorusGeometry(0.38, 0.045, 8, 24, Math.PI);
const cupGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16);
const ringGeo = new THREE.PlaneGeometry(1.5, 1.5);
const ringTex = canvasTexture(ringSigilCanvas());
const emoteTextures = new Map();
const torsos = []; // for clicking on people

function textSprite(text, { color = '#f2f4f8', size = 44, border = 'rgba(255,255,255,.22)' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `600 ${size}px ${FONT}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  c.width = w; c.height = size + 26;
  ctx.font = font;
  ctx.fillStyle = 'rgba(4,4,6,.72)';
  ctx.strokeStyle = border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(2, 2, c.width - 4, c.height - 4, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(c), depthWrite: false, fog: false }));
  const k = 0.3 / c.height * (size / 44);
  s.scale.set(c.width * k, c.height * k, 1);
  return s;
}

function emojiTexture(e) {
  if (!emoteTextures.has(e)) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.font = '96px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e, 64, 72);
    emoteTextures.set(e, canvasTexture(c));
  }
  return emoteTextures.get(e);
}

class Avatar {
  constructor(p) {
    this.id = p.id;
    this.name = p.name;
    this.isDj = p.isDj;
    this.stage = p.stage; this.vip = p.vip;
    this.x = this.tx = p.x; this.z = this.tz = p.z; this.ry = this.try = p.ry;
    this.dance = p.dance;
    this.phase = Math.random() * 10;
    this.floats = [];

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    // Everyone starts as black chrome. Colors and effects are meant to be unlocked later.
    this.torso = new THREE.Mesh(bodyGeo, blackChrome);
    this.torso.position.y = 0.7;
    this.torso.userData.id = p.id;
    this.body.add(this.torso);
    torsos.push(this.torso);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(0.13 * s, 1.15, 0.335);
      eye.rotation.z = -0.25 * s;
      this.body.add(eye);
    }
    if (p.isDj) {
      const phones = new THREE.Mesh(phonesGeo, frameMat);
      phones.position.y = 1.15;
      this.body.add(phones);
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(cupGeo, frameMat);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(0.38 * s, 1.12, 0);
        this.body.add(cup);
      }
    }
    if (p.id === me?.id) {
      // A sigil under your own avatar so you can find yourself in a crowd.
      this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, opacity: 0.75, depthWrite: false }));
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.position.y = 0.05;
      this.root.add(this.ring);
    }
    this.makeLabel();
    scene.add(this.root);
  }
  makeLabel() {
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map.dispose();
      this.label.material.dispose();
    }
    this.label = this.isDj
      ? textSprite(`🎧 ${this.name}`, { border: '#ff2a4d' })
      : textSprite(this.vip ? `${this.name} ✦` : this.name, { border: this.vip ? '#e6e9f0' : 'rgba(255,255,255,.22)' });
    this.label.position.y = 1.85;
    this.root.add(this.label);
  }
  setPerms(stageOk, vipOk) {
    const changed = this.vip !== vipOk;
    this.stage = stageOk; this.vip = vipOk;
    if (changed) this.makeLabel();
  }
  setDance(d) { this.dance = d; }
  emote(e) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(e), transparent: true, depthWrite: false, fog: false }));
    s.scale.setScalar(0.7);
    s.position.set((Math.random() - 0.5) * 0.4, 2.2, 0);
    this.root.add(s);
    this.floats.push({ s, born: clock.elapsedTime });
    if (this.floats.length > 6) this.removeFloat(this.floats.shift());
  }
  removeFloat(f) { this.root.remove(f.s); f.s.material.dispose(); }
  update(t, dt) {
    if (this.id !== me?.id) {
      const k = 1 - Math.exp(-dt * 12);
      this.x += (this.tx - this.x) * k;
      this.z += (this.tz - this.z) * k;
      let d = this.try - this.ry;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.ry += d * k;
    }
    this.root.position.set(this.x, stageHeightAt(this.x, this.z), this.z);
    this.root.rotation.y = this.ry;
    if (this.ring) this.ring.rotation.z = t * 0.4 - this.ry;
    // Fade name tags that are right in front of the camera so they don't cover the view.
    const camDistance = camera.position.distanceTo(this.root.position);
    this.label.material.opacity = THREE.MathUtils.clamp((camDistance - 3) / 3, 0, 1);

    // Dances
    const beat = (t * BPM) / 60;
    const b = this.body;
    b.position.set(0, 0, 0); b.rotation.set(0, 0, 0); b.scale.set(1, 1, 1);
    switch (this.dance) {
      case 'bounce': {
        const v = Math.abs(Math.sin(beat * Math.PI));
        b.position.y = v * 0.25;
        b.scale.set(1 + (1 - v) * 0.08, 1 - (1 - v) * 0.1, 1 + (1 - v) * 0.08);
        break;
      }
      case 'spin': b.rotation.y = (beat * Math.PI) / 2; b.position.y = Math.abs(Math.sin(beat * Math.PI)) * 0.1; break;
      case 'sway': b.rotation.z = Math.sin(beat * Math.PI) * 0.25; b.position.x = Math.sin(beat * Math.PI) * 0.1; break;
      case 'jump': b.position.y = Math.max(0, Math.sin(beat * Math.PI / 2)) * 0.8; break;
      default: b.position.y = Math.sin(t * 2 + this.phase) * 0.02;
    }

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      const age = t - f.born;
      if (age > 1.8) { this.removeFloat(f); this.floats.splice(i, 1); continue; }
      f.s.position.y = 2.2 + age * 1.1;
      f.s.material.opacity = 1 - Math.max(0, age - 1.1) / 0.7;
    }
  }
  dispose() {
    scene.remove(this.root);
    torsos.splice(torsos.indexOf(this.torso), 1);
    this.label.material.map.dispose();
    this.label.material.dispose();
    this.ring?.material.dispose();
    for (const f of this.floats) f.s.material.dispose();
  }
}

function addAvatar(p) {
  if (avatars.has(p.id)) return;
  avatars.set(p.id, new Avatar(p));
  updateCount();
}

// Where someone may stand. Same rules as canStand() in server.js.
const inBox = (b, x, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
function onStage(x, z) {
  return inBox(room, x, z) && x > stage.minX - 0.5 && x < stage.maxX + 0.5 && z < stage.maxZ + 0.5;
}
function canStand(x, z, p) {
  if (onStage(x, z)) return !!p.stage;
  if (inBox(room, x, z)) return true;
  if (inBox(door, x, z) || inBox(vip, x, z)) return !!p.vip;
  return false;
}
function stageHeightAt(x, z) { return onStage(x, z) ? stageH : 0; }
const inGreenRoom = (z) => z < BACK_Z - 0.3;

// ---------------------------------------------------------------- DJ tools
// The DJ can click anyone (or open the crowd list) to invite them on stage or into the green room.
let djMenuFor = null;
function grant(id, perm, on) { send({ t: 'grant', id, perm, on }); }
function openDjMenu(id) {
  const a = avatars.get(id);
  if (!a || !me?.isDj || a.isDj) return closeDjMenu();
  djMenuFor = id;
  $('djName').textContent = a.name;
  $('djStage').textContent = a.stage ? 'Remove from stage' : 'Invite on stage';
  $('djVip').textContent = a.vip ? 'Remove from green room' : 'Let into green room';
  $('djStage').classList.toggle('on', a.stage);
  $('djVip').classList.toggle('on', a.vip);
  $('djMenu').hidden = false;
}
function closeDjMenu() { djMenuFor = null; $('djMenu').hidden = true; }
$('djStage').onclick = () => { const a = avatars.get(djMenuFor); if (a) grant(a.id, 'stage', !a.stage); };
$('djVip').onclick = () => { const a = avatars.get(djMenuFor); if (a) grant(a.id, 'vip', !a.vip); };
$('djClose').onclick = closeDjMenu;

$('crowdBtn').onclick = () => { $('crowd').hidden = !$('crowd').hidden; renderCrowd(); };
$('crowdClose').onclick = () => { $('crowd').hidden = true; };
$('crowdSearch').oninput = () => renderCrowd();
function renderCrowd() {
  if ($('crowd').hidden || !me?.isDj) return;
  const q = $('crowdSearch').value.trim().toLowerCase();
  const people = [...avatars.values()]
    .filter((a) => !a.isDj && a.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const list = $('crowdList');
  list.replaceChildren();
  if (!people.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = q ? 'Nobody by that name.' : 'Nobody else is here yet.';
    list.append(empty);
  }
  for (const a of people) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = a.name;
    const st = document.createElement('button');
    st.textContent = 'Stage';
    st.classList.toggle('on', a.stage);
    st.onclick = () => grant(a.id, 'stage', !a.stage);
    const vp = document.createElement('button');
    vp.textContent = 'VIP';
    vp.classList.toggle('on', a.vip);
    vp.onclick = () => grant(a.id, 'vip', !a.vip);
    li.append(name, st, vp);
    list.append(li);
  }
}

// ---------------------------------------------------------------- controls
const local = { x: 0, z: 8, ry: Math.PI };
let target = null; // where a tap/click asked us to walk
let camYaw = 0, camPitch = 0.38, camDist = 7.5;
const keys = new Set();
const joy = { x: 0, y: 0 };

const DANCE_LABELS = { none: 'Stand', bounce: 'Bounce', spin: 'Spin', sway: 'Sway', jump: 'Jump' };
const EMOTE_KEYS = ['q', 'e', 'r', 't', 'y', 'u', 'i', 'o'];
let myDance = 'none';
function setMyDance(d) {
  myDance = d;
  avatars.get(me?.id)?.setDance(d);
  send({ t: 'dance', d });
  for (const btn of $('dances').children) btn.classList.toggle('on', btn.dataset.d === d);
}
config.dances.forEach((d, i) => {
  const btn = document.createElement('button');
  btn.dataset.d = d;
  btn.textContent = `${DANCE_LABELS[d] || d}`;
  btn.title = `Key ${i + 1}`;
  btn.onclick = () => setMyDance(d);
  if (d === 'none') btn.classList.add('on');
  $('dances').append(btn);
});
let lastEmote = 0;
function sendEmote(e) {
  const now = performance.now();
  if (now - lastEmote < 300) return;
  lastEmote = now;
  send({ t: 'emote', e });
}
config.emotes.forEach((e, i) => {
  const btn = document.createElement('button');
  btn.textContent = e;
  btn.title = `Key ${EMOTE_KEYS[i]?.toUpperCase() || ''}`;
  btn.onclick = () => sendEmote(e);
  $('emotes').append(btn);
});

addEventListener('keydown', (e) => {
  if (!me || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { closeDjMenu(); $('crowd').hidden = true; return; }
  keys.add(k);
  const n = Number(e.key);
  if (n >= 1 && n <= config.dances.length) setMyDance(config.dances[n - 1]);
  const ei = EMOTE_KEYS.indexOf(k);
  if (ei >= 0 && config.emotes[ei]) sendEmote(config.emotes[ei]);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// Drag to look around, tap/click the floor to walk there. The DJ can tap a person for options.
const raycaster = new THREE.Raycaster();
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.moved > 8) {
    camYaw -= dx * 0.006;
    camPitch = THREE.MathUtils.clamp(camPitch + dy * 0.004, 0.05, 1.2);
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  if (drag.moved <= 8 && me) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const person = me.isDj && raycaster.intersectObjects(torsos, false).find((h) => h.object.userData.id !== me.id);
    if (person) openDjMenu(person.object.userData.id);
    else {
      const hit = raycaster.intersectObjects([floor, floor.userData.extra, tileMesh, stageMesh])[0];
      if (hit) target = { x: hit.point.x, z: hit.point.z };
    }
  }
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 3, 14);
}, { passive: true });

// Touch joystick
const joyEl = $('joystick'), stickEl = $('stick');
joyEl.addEventListener('pointerdown', (e) => { joyEl.setPointerCapture(e.pointerId); moveJoy(e); });
joyEl.addEventListener('pointermove', (e) => { if (joyEl.hasPointerCapture(e.pointerId)) moveJoy(e); });
joyEl.addEventListener('pointerup', () => { joy.x = joy.y = 0; stickEl.style.transform = ''; });
function moveJoy(e) {
  const r = joyEl.getBoundingClientRect();
  let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
  let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  joy.x = x; joy.y = y;
  stickEl.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
}

const SPEED = 4.5;
let sendTimer = 0, lastSent = '', blockedHint = 0;
function updateLocal(dt) {
  let fx = 0, fz = 0;
  if (keys.has('w') || keys.has('arrowup')) fz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) fz += 1;
  if (keys.has('a') || keys.has('arrowleft')) fx -= 1;
  if (keys.has('d') || keys.has('arrowright')) fx += 1;
  fx += joy.x; fz += joy.y;

  let dx = 0, dz = 0, speed = 0;
  if (fx || fz) {
    target = null;
    // Move relative to where the camera is looking.
    const s = Math.sin(camYaw), c = Math.cos(camYaw);
    dx = fx * c + fz * s;
    dz = -fx * s + fz * c;
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    speed = SPEED * Math.min(1, len) * dt;
  } else if (target) {
    dx = target.x - local.x; dz = target.z - local.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) target = null;
    else { dx /= len; dz /= len; speed = Math.min(SPEED * dt, len); }
  }
  if (speed > 0) {
    let nx = local.x + dx * speed, nz = local.z + dz * speed;
    if (!canStand(nx, nz, me)) {
      // Slide along walls and the edge of places you're not allowed into.
      const blocked = onStage(nx, nz) || inBox(door, nx, nz);
      if (canStand(nx, local.z, me)) nz = local.z;
      else if (canStand(local.x, nz, me)) nx = local.x;
      else { nx = local.x; nz = local.z; target = null; }
      if (blocked && performance.now() - blockedHint > 6000) {
        blockedHint = performance.now();
        toast(onStage(local.x + dx, local.z + dz) ? 'The stage is invite only' : 'The green room is VIP only');
      }
      // A tap-to-walk keeps sliding along the edge, but gives up after a few seconds of being stuck.
      if (target && (target.stuck = (target.stuck || 0) + dt) > 3) target = null;
    }
    local.x = nx; local.z = nz;
    local.ry = Math.atan2(dx, dz);
  }
  const a = avatars.get(me.id);
  if (a) { a.x = local.x; a.z = local.z; a.ry = local.ry; }

  sendTimer += dt;
  if (sendTimer > 0.1) {
    sendTimer = 0;
    const key = `${local.x.toFixed(2)},${local.z.toFixed(2)},${local.ry.toFixed(2)}`;
    if (key !== lastSent) { lastSent = key; send({ t: 'move', x: local.x, z: local.z, ry: local.ry }); }
  }
}

// ---------------------------------------------------------------- render loop
const clock = new THREE.Clock();
const tileColor = new THREE.Color();
const palette = [0xff2bd6, 0x29e7ff, 0x9146ff, 0x3dff8b, 0xffd12b].map((c) => new THREE.Color(c));
const camTarget = new THREE.Vector3(0, 1.4, 8);
const followPoint = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const beat = (t * BPM) / 60;
  const pulse = Math.pow(1 - (beat % 1), 3);

  if (me) updateLocal(dt);
  for (const a of avatars.values()) a.update(t, dt);

  // Dance floor pattern changes every 4 beats
  const pattern = Math.floor(beat / 4) % 3;
  tiles.forEach(([x, z], i) => {
    let v;
    if (pattern === 0) v = (Math.floor(beat) + (x + z) / TILE) % 5;
    else if (pattern === 1) v = (Math.floor(beat) + Math.floor(Math.hypot(x, z - 3) / TILE)) % 5;
    else v = ((x / TILE + z / TILE) & 1) ? Math.floor(beat) % 5 : (Math.floor(beat) + 2) % 5;
    tileColor.copy(palette[(Math.abs(Math.floor(v)) + 5) % 5]).multiplyScalar(0.25 + pulse * 0.55);
    tileMesh.setColorAt(i, tileColor);
  });
  tileMesh.instanceColor.needsUpdate = true;

  beams.forEach((b, i) => {
    b.rotation.z = Math.sin(t * 0.7 + i) * 0.6;
    b.rotation.x = Math.cos(t * 0.5 + i * 1.3) * 0.5;
    b.material.opacity = 0.06 + pulse * 0.1;
  });
  spots.forEach((l, i) => {
    l.position.x = Math.sin(t * 0.6 + i * 2.1) * 9;
    l.position.z = 3 + Math.cos(t * 0.4 + i) * 5;
    l.intensity = 15 + pulse * 35;
  });
  decks.forEach((d) => (d.rotation.y += dt * 3.5));
  boothStripMat.color.setRGB(0.6 + pulse * 0.4, 0.08 + pulse * 0.1, 0.18 + pulse * 0.12);
  ropeMat.opacity = me?.vip ? 0.15 : 0.55 + pulse * 0.35;

  // Camera follows you (or slowly circles the room on the login screen).
  if (me) {
    followPoint.set(local.x, 1.4 + stageHeightAt(local.x, local.z), local.z);
    camTarget.lerp(followPoint, 1 - Math.exp(-dt * 8));
  } else {
    camYaw = Math.sin(t * 0.1) * 0.6;
    camTarget.set(0, 2.5, 4);
  }
  const dist = me ? camDist : 11;
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
    camTarget.y + Math.sin(camPitch) * dist,
    camTarget.z + Math.cos(camYaw) * Math.cos(camPitch) * dist,
  );
  // Keep the camera inside whichever room you're in.
  const inside = me && inGreenRoom(local.z) ? VIP_BOX : { minX: room.minX - 0.6, maxX: room.maxX + 0.6, minZ: room.minZ - 0.6, maxZ: room.maxZ + 0.6 };
  const pad = me && inGreenRoom(local.z) ? 0.3 : 0;
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, inside.minX + pad, inside.maxX - pad);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, inside.minZ + pad, inside.maxZ - pad);
  camera.position.y = Math.min(camera.position.y, (me && inGreenRoom(local.z) ? VIP_H : H) - 0.4);
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
  cssRenderer.render(cssScene, camera);
  requestAnimationFrame(frame);
}
frame();
startTwitchPlayer();
// Name tags are drawn with the club font; redraw them once it has loaded.
document.fonts.load(`600 44px ${FONT}`).then(() => {
  for (const a of avatars.values()) a.makeLabel();
}).catch(() => {});

// Logged in already (came back from Twitch, or refreshed the page)? Join straight away.
const savedToken = store.get(TOKEN_KEY, sessionStorage);
if (savedToken && config.clientId) connect({ token: savedToken });

// For automated testing only.
window.__club = { avatars, local, get me() { return me; }, grant, walkTo: (x, z) => (target = { x, z }) };
