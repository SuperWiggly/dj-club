// Fills the club with fake viewers that wander and dance, to test a raid.
// Usage: node test/bots.js [count] [url]
const WebSocket = require('ws');
const count = Number(process.argv[2]) || 60;
const url = process.argv[3] || 'ws://localhost:3000/ws';
const dances = ['none', 'bounce', 'spin', 'sway', 'jump'];
const emotes = ['🔥', '❤️', '🙌', '🎉', '💯'];
let joined = 0, closed = 0;
for (let i = 0; i < count; i++) {
  setTimeout(() => {
    const ws = new WebSocket(url);
    let x = 0, z = 6, tx = 0, tz = 6;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', guestName: 'raider' + i, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') })));
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'welcome') {
        joined++; x = m.you.x; z = m.you.z;
        ws.send(JSON.stringify({ t: 'dance', d: dances[1 + (i % 4)] }));
        setInterval(() => {
          if (Math.random() < 0.02) { tx = (Math.random() - 0.5) * 24; tz = -3 + Math.random() * 15; }
          const dx = tx - x, dz = tz - z, len = Math.hypot(dx, dz);
          if (len > 0.2) { x += dx / len * 0.45; z += dz / len * 0.45; ws.send(JSON.stringify({ t: 'move', x, z, ry: Math.atan2(dx, dz) })); }
          if (Math.random() < 0.01) ws.send(JSON.stringify({ t: 'emote', e: emotes[Math.floor(Math.random() * emotes.length)] }));
        }, 100);
      }
    });
    ws.on('close', (code, reason) => { closed++; if (closed <= 3) console.log('closed', code, String(reason)); });
  }, i * 20);
}
setInterval(() => console.log(`bots joined: ${joined}, closed: ${closed}`), 3000);
