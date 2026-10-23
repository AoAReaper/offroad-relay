const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8090;
const MAX_PLAYERS = 4;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const rooms = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Off Road relay: ${rooms.size} room(s) open\n`);
});
const wss = new WebSocketServer({ server });

function send(ws, msg) { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); }
function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}
function roster(room) {
  return room.players.map((p, i) => (p ? { id: i, name: p.name } : null)).filter(Boolean);
}

wss.on('connection', (ws) => {
  ws.room = null; ws.id = -1; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'host') {
      const code = newCode();
      const room = { players: [ws], started: false };
      rooms.set(code, room);
      ws.room = code; ws.id = 0; ws.name = String(msg.name || 'P1').slice(0, 12);
      send(ws, { t: 'room', code, you: 0, players: roster(room) });
      console.log(`room ${code} opened`);
    } else if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', why: 'No race with that code' });
      if (room.started) return send(ws, { t: 'error', why: 'That race has already started' });
      let slot = room.players.indexOf(null);
      if (slot < 0) slot = room.players.length;
      if (slot >= MAX_PLAYERS) return send(ws, { t: 'error', why: 'That race is full' });
      room.players[slot] = ws;
      ws.room = code; ws.id = slot; ws.name = String(msg.name || `P${slot + 1}`).slice(0, 12);
      send(ws, { t: 'room', code, you: slot, players: roster(room) });
      for (const p of room.players) if (p && p !== ws) send(p, { t: 'peers', players: roster(room) });
    } else if (msg.t === 'to' && ws.room) {
      const room = rooms.get(ws.room);
      if (!room) return;
      if (msg.lock) room.started = true;
      if (msg.unlock) room.started = false;
      const out = JSON.stringify({ t: 'msg', from: ws.id, d: msg.d });
      room.players.forEach((p, i) => {
        if (p && p !== ws && (msg.to === 'all' || msg.to === i) && p.readyState === p.OPEN) p.send(out);
      });
    }
  });
  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    if (ws.id === 0) {
      for (const p of room.players) if (p && p !== ws) { send(p, { t: 'closed' }); p.close(); }
      rooms.delete(ws.room);
    } else {
      room.players[ws.id] = null;
      for (const p of room.players) if (p) send(p, { t: 'left', id: ws.id, players: roster(room) });
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Off Road relay listening on port ${PORT}`));
