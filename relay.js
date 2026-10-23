// Off Road online relay: puts players into rooms (lobbies) and passes their
// messages along. Lobbies are listed for anyone to find; a lobby can have a
// passcode, and every lobby also has a 4-letter code for joining directly. The game itself runs on the host's device;
// this just connects everyone (phones and browsers can't connect to each
// other directly). Run with:  npm install && npm start   (PORT env sets the port)

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8090;
const MAX_PLAYERS = 4;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I or O (they look like 1 and 0)

const rooms = new Map();   // code -> { players: [ws or null], started, pass, cls, track }

const server = http.createServer((req, res) => {
  // Plain web requests (and health checks) get a short status line
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Off Road relay: ${rooms.size} room(s) open\n`);
});
const wss = new WebSocketServer({ server });

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

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
  ws.room = null;
  ws.id = -1;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'list') {
      // The lobby browser: every lobby, newest first
      const list = [...rooms.entries()].reverse().slice(0, 30).map(([code, r]) => ({
        code, host: r.players[0] ? r.players[0].name : '?', players: roster(r).length, max: MAX_PLAYERS,
        locked: !!r.pass, racing: r.started, cls: r.cls, track: r.track,
      }));
      send(ws, { t: 'rooms', rooms: list });
    } else if (msg.t === 'info' && ws.room && ws.id === 0) {
      // The host picked a class / track: shown in the lobby browser
      const room = rooms.get(ws.room);
      if (room) { room.cls = String(msg.cls || '').slice(0, 20); room.track = String(msg.track || '').slice(0, 20); }
    } else if (msg.t === 'host') {
      const code = newCode();
      const room = { players: [ws], started: false, pass: String(msg.pass || '').slice(0, 8),
        cls: String(msg.cls || '').slice(0, 20), track: String(msg.track || '').slice(0, 20) };
      rooms.set(code, room);
      ws.room = code; ws.id = 0; ws.name = String(msg.name || 'P1').slice(0, 12);
      send(ws, { t: 'room', code, you: 0, players: roster(room) });
      console.log(`room ${code} opened${room.pass ? ' (with a passcode)' : ''}`);
    } else if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', why: 'That race has gone' });
      if (room.pass && String(msg.pass || '') !== room.pass) return send(ws, { t: 'error', why: 'Wrong passcode' });
      if (room.started) return send(ws, { t: 'error', why: 'That race has already started' });
      let slot = room.players.indexOf(null);
      if (slot < 0) slot = room.players.length;
      if (slot >= MAX_PLAYERS) return send(ws, { t: 'error', why: 'That race is full' });
      room.players[slot] = ws;
      ws.room = code; ws.id = slot; ws.name = String(msg.name || `P${slot + 1}`).slice(0, 12);
      send(ws, { t: 'room', code, you: slot, players: roster(room) });
      for (const p of room.players) if (p && p !== ws) send(p, { t: 'peers', players: roster(room) });
    } else if (msg.t === 'to' && ws.room) {
      // Pass a message on: to one player (id) or everyone else ("all")
      const room = rooms.get(ws.room);
      if (!room) return;
      if (msg.lock) room.started = true;   // the host started the race: no more joining
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
      // The host left: the race is over for everyone
      for (const p of room.players) if (p && p !== ws) { send(p, { t: 'closed' }); p.close(); }
      rooms.delete(ws.room);
    } else {
      room.players[ws.id] = null;
      for (const p of room.players) if (p) send(p, { t: 'left', id: ws.id, players: roster(room) });
    }
  });
});

// Drop connections that have gone quiet (phone went to sleep etc.)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Off Road relay listening on port ${PORT}`));
