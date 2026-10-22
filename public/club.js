import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

const $ = (id) => document.getElementById(id);
const config = await fetch('/config.json').then((r) => r.json());
const BPM = 124; // lights pulse to this tempo (not synced to the real music yet)

// ---------------------------------------------------------------- login
const TOKEN_KEY = 'club.twitchToken';
const COLOR_KEY = 'club.color';
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

$('color').value = store.get(COLOR_KEY) || randomColor();
$('color').addEventListener('input', () => {
  store.set(COLOR_KEY, $('color').value);
  send({ t: 'color', color: $('color').value });
  if (me) avatars.get(me.id)?.setColor($('color').value);
});
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

function randomColor() {
  return '#' + new THREE.Color().setHSL(Math.random(), 0.75, 0.6).getHexString();
}

// ---------------------------------------------------------------- network
let ws = null;
let me = null;
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

function connect(hello) {
  $('error').textContent = 'Joining…';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => send({ t: 'hello', color: $('color').value, ...hello });
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
      // The DJ looks out at the crowd; everyone else looks toward the booth.
      camYaw = me.isDj ? Math.PI : 0;
      enterClub();
      break;
    case 'join': addAvatar(m.p); break;
    case 'leave': avatars.get(m.id)?.dispose(); avatars.delete(m.id); updateCount(); break;
    case 'pos':
      for (const [id, x, z, ry] of m.m) {
        if (id === me?.id) continue;
        const a = avatars.get(id);
        if (a) { a.tx = x; a.tz = z; a.try = ry; }
      }
      break;
    case 'dance': avatars.get(m.id)?.setDance(m.d); break;
    case 'emote': avatars.get(m.id)?.emote(m.e); break;
    case 'color': if (m.id !== me?.id) avatars.get(m.id)?.setColor(m.color); break;
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
function updateCount() {
  const n = avatars.size;
  $('count').textContent = `${n} in the club`;
}

// ---------------------------------------------------------------- 3D setup
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
const cssRenderer = new CSS3DRenderer({ element: $('css3d') });

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x07060d, 18, 45);
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

scene.add(new THREE.HemisphereLight(0x8877ff, 0x110822, 0.9));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
keyLight.position.set(4, 10, 8);
scene.add(keyLight);

const { room, stage } = config;
const W = room.maxX - room.minX + 2, D = room.maxZ - room.minZ + 2;
const CX = (room.maxX + room.minX) / 2, CZ = (room.maxZ + room.minZ) / 2;

// Floor, walls, ceiling
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(W, D),
  new THREE.MeshStandardMaterial({ color: 0x14111f, roughness: 0.35, metalness: 0.4 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(CX, 0, CZ);
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1430, roughness: 0.9 });
const H = 9;
function wall(w, x, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
  m.position.set(x, H / 2, z);
  m.rotation.y = ry;
  scene.add(m);
}
wall(W, CX, room.minZ - 1, 0);
wall(W, CX, room.maxZ + 1, Math.PI);
wall(D, room.minX - 1, CZ, Math.PI / 2);
wall(D, room.maxX + 1, CZ, -Math.PI / 2);
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: 0x08060f }));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.set(CX, H, CZ);
scene.add(ceiling);

// Neon strips along the side and back walls
const neonMats = [];
function neon(color, w, x, y, z, ry) {
  const mat = new THREE.MeshBasicMaterial({ color });
  neonMats.push(mat);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.08), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  scene.add(m);
}
for (const [y, c] of [[1.2, 0xff2bd6], [7.5, 0x29e7ff]]) {
  neon(c, D, room.minX - 0.95, y, CZ, Math.PI / 2);
  neon(c, D, room.maxX + 0.95, y, CZ, Math.PI / 2);
  neon(c, W, CX, y, room.maxZ + 0.95, 0);
}

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

// Stage and DJ booth
const stageH = 0.6;
const stageMesh = new THREE.Mesh(
  new THREE.BoxGeometry(stage.maxX - stage.minX + 1, stageH, stage.maxZ - stage.minZ + 1),
  new THREE.MeshStandardMaterial({ color: 0x221a3d, roughness: 0.6 }),
);
stageMesh.position.set((stage.minX + stage.maxX) / 2, stageH / 2, (stage.minZ + stage.maxZ) / 2 - 0.5);
scene.add(stageMesh);
const stageEdge = new THREE.MeshBasicMaterial({ color: 0x9146ff });
neonMats.push(stageEdge);
const edge = new THREE.Mesh(new THREE.BoxGeometry(stage.maxX - stage.minX + 1, 0.08, 0.08), stageEdge);
edge.position.set(0, stageH, stage.maxZ + 0.02);
scene.add(edge);

const booth = new THREE.Group();
booth.position.set(0, stageH, -6);
scene.add(booth);
const boothBody = new THREE.Mesh(
  new THREE.BoxGeometry(4.2, 1.1, 1.1),
  new THREE.MeshStandardMaterial({ color: 0x0e0b18, metalness: 0.6, roughness: 0.3 }),
);
boothBody.position.y = 0.55;
booth.add(boothBody);
const boothStripMat = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
neonMats.push(boothStripMat);
const boothStrip = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.02), boothStripMat);
boothStrip.position.set(0, 0.6, 0.56);
booth.add(boothStrip);
const decks = [];
for (const x of [-1.2, 1.2]) {
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.05, 32),
    new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.25 }),
  );
  deck.position.set(x, 1.13, 0);
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0x29e7ff }));
  deck.add(label);
  booth.add(deck);
  decks.push(deck);
}
const mixer = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.7), new THREE.MeshStandardMaterial({ color: 0x333040 }));
mixer.position.set(0, 1.13, 0);
booth.add(mixer);

// Big screen behind the booth showing the Twitch stream.
// The video is a real web page placed in 3D; the 3D scene leaves a see-through hole for it.
const SCREEN_W = 12, SCREEN_H = 6.75, SCREEN_Y = 5, SCREEN_Z = room.minZ - 0.9;
const PX_W = 1280, PX_H = 720;
const screenEl = document.createElement('div');
screenEl.id = 'twitchPlayer';
screenEl.style.cssText = `width:${PX_W}px;height:${PX_H}px;background:#000;display:grid;place-items:center;color:#a49cc4;font:600 42px system-ui;`;
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
const frameMat = new THREE.MeshBasicMaterial({ color: 0x29e7ff });
neonMats.push(frameMat);
for (const [w, h, x, y] of [
  [SCREEN_W + 0.3, 0.12, 0, SCREEN_H / 2 + 0.06], [SCREEN_W + 0.3, 0.12, 0, -SCREEN_H / 2 - 0.06],
  [0.12, SCREEN_H, SCREEN_W / 2 + 0.06, 0], [0.12, SCREEN_H, -SCREEN_W / 2 - 0.06, 0],
]) {
  const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameMat);
  f.position.set(x, SCREEN_Y + y, SCREEN_Z + 0.01);
  scene.add(f);
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

// Moving light beams and colored spotlights
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
const eyeGeo = new THREE.SphereGeometry(0.07, 10, 8);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pupilGeo = new THREE.SphereGeometry(0.035, 8, 6);
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const phonesGeo = new THREE.TorusGeometry(0.38, 0.05, 8, 24, Math.PI);
const phonesMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7 });
const cupGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16);
const ringGeo = new THREE.RingGeometry(0.42, 0.55, 32);
const emoteTextures = new Map();

function textSprite(text, { color = '#fff', size = 44, bg = 'rgba(10,8,20,.65)' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 32;
  c.width = w; c.height = size + 24;
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, c.height / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
  const k = 0.32 / c.height * (size / 44);
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
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    emoteTextures.set(e, tex);
  }
  return emoteTextures.get(e);
}

class Avatar {
  constructor(p) {
    this.id = p.id;
    this.isDj = p.isDj;
    this.x = this.tx = p.x; this.z = this.tz = p.z; this.ry = this.try = p.ry;
    this.dance = p.dance;
    this.phase = Math.random() * 10;
    this.floats = [];

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.4, emissive: p.color, emissiveIntensity: 0.15 });
    const torso = new THREE.Mesh(bodyGeo, this.mat);
    torso.position.y = 0.7;
    this.body.add(torso);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(0.13 * s, 1.15, 0.31);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.05;
      eye.add(pupil);
      this.body.add(eye);
    }
    if (p.isDj) {
      const phones = new THREE.Mesh(phonesGeo, phonesMat);
      phones.position.y = 1.15;
      this.body.add(phones);
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(cupGeo, phonesMat);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(0.38 * s, 1.12, 0);
        this.body.add(cup);
      }
    }
    if (p.id === me?.id) {
      // A ring under your own avatar so you can find yourself in a crowd.
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      this.root.add(ring);
    }
    this.label = textSprite(p.isDj ? `🎧 ${p.name}` : p.name, { color: p.isDj ? '#ffd12b' : '#ffffff' });
    this.label.position.y = 1.85;
    this.root.add(this.label);
    scene.add(this.root);
  }
  setColor(c) { this.mat.color.set(c); this.mat.emissive.set(c); }
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
    const y = this.isDj ? stageHeightAt(this.x, this.z) : 0;
    this.root.position.set(this.x, y, this.z);
    this.root.rotation.y = this.ry;
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
    this.mat.dispose();
    this.label.material.map.dispose();
    this.label.material.dispose();
    for (const f of this.floats) f.s.material.dispose();
  }
}

function addAvatar(p) {
  if (avatars.has(p.id)) return;
  avatars.set(p.id, new Avatar(p));
  updateCount();
}

function onStage(x, z) {
  return x > stage.minX - 0.5 && x < stage.maxX + 0.5 && z < stage.maxZ + 0.5;
}
function stageHeightAt(x, z) { return onStage(x, z) ? stageH : 0; }

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
  keys.add(k);
  const n = Number(e.key);
  if (n >= 1 && n <= config.dances.length) setMyDance(config.dances[n - 1]);
  const ei = EMOTE_KEYS.indexOf(k);
  if (ei >= 0 && config.emotes[ei]) sendEmote(config.emotes[ei]);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// Drag to look around, tap/click the floor to walk there.
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
    const hit = raycaster.intersectObjects([floor, tileMesh, stageMesh])[0];
    if (hit) target = { x: hit.point.x, z: hit.point.z };
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
let sendTimer = 0, lastSent = '';
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
    let nx = THREE.MathUtils.clamp(local.x + dx * speed, room.minX, room.maxX);
    let nz = THREE.MathUtils.clamp(local.z + dz * speed, room.minZ, room.maxZ);
    if (!me.isDj && onStage(nx, nz)) {
      // Slide along the edge of the stage instead of walking onto it.
      if (!onStage(nx, local.z)) nz = local.z;
      else if (!onStage(local.x, nz)) nx = local.x;
      else { nx = local.x; nz = local.z; }
      target = null;
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
  boothStripMat.color.setHSL((t * 0.1) % 1, 1, 0.55);

  // Camera follows you (or slowly circles the room on the login screen).
  if (me) {
    camTarget.lerp(new THREE.Vector3(local.x, 1.4 + stageHeightAt(local.x, local.z), local.z), 1 - Math.exp(-dt * 8));
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
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, room.minX - 0.6, room.maxX + 0.6);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, room.minZ - 0.6, room.maxZ + 0.6);
  camera.position.y = Math.min(camera.position.y, H - 0.5);
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
  cssRenderer.render(cssScene, camera);
  requestAnimationFrame(frame);
}
frame();
startTwitchPlayer();

// Logged in already (came back from Twitch, or refreshed the page)? Join straight away.
const savedToken = store.get(TOKEN_KEY, sessionStorage);
if (savedToken && config.clientId) connect({ token: savedToken });

// For automated testing only.
window.__club = { avatars, local, get me() { return me; } };
