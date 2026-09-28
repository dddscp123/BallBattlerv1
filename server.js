// 球球大王 聯機中繼伺服器 (Node.js + ws)
// 部署到 Render/Railway/Fly.io 免費層即可
// 啟動: node server.js
const http = require('http');
const { WebSocketServer } = require('ws');
const port = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

// rooms: { [code]: { host: ws, guests: Map<ws, {name, peerId}> } }
const rooms = {};

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws._wsId = Math.random().toString(36).slice(2, 10);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'createRoom') {
      // 房主建立房間
      let code;
      do {
        code = Math.random().toString(36).slice(2, 6).toUpperCase();
      } while (rooms[code]);
      rooms[code] = { host: ws, guests: new Map() };
      ws.roomCode = code;
      send(ws, { t: 'roomCreated', code });
      console.log('房間建立', code);
    }

    else if (msg.t === 'joinRoom') {
      const room = rooms[msg.code];
      if (!room) { send(ws, { t: 'joinError', reason: '房間不存在' }); return; }
      room.guests.set(ws, { name: msg.name || '玩家' });
      ws.roomCode = msg.code;
      send(ws, { t: 'joined', code: msg.code });
      // 轉告房主有新客人
      send(room.host, { t: 'guestJoined', wsId: ws._wsId, name: msg.name });
      console.log('客人加入', msg.code, msg.name);
    }

    else if (msg.t === 'hostStart') {
      const room = rooms[ws.roomCode];
      if (!room || room.host !== ws) return;
      // 廣播開始給所有客人
      room.guests.forEach((g, guestWs) => {
        send(guestWs, { t: 'start', myIndex: msg.indexMap[g.name] });
      });
    }

    else {
      // 其他訊息：房主廣播給客人，客人發給房主
      const room = rooms[ws.roomCode];
      if (!room) return;
      if (room.host === ws) {
        // 房主 -> 指定客人 or 全部客人
        if (msg.guestTarget) {
          const target = [...room.guests.keys()].find(g => g._wsId === msg.guestTarget);
          if (target) send(target, msg);
        } else {
          room.guests.forEach((g, guestWs) => send(guestWs, msg));
        }
      } else if (room.guests.has(ws)) {
        // 客人 -> 房主
        send(room.host, Object.assign({}, msg, { fromGuest: ws._wsId }));
      }
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    if (room.host === ws) {
      // 房主離開，廣播給客人
      room.guests.forEach((g, guestWs) => send(guestWs, { t: 'hostLeft' }));
      delete rooms[ws.roomCode];
      console.log('房主離開', ws.roomCode);
    } else {
      room.guests.delete(ws);
      send(room.host, { t: 'guestLeft', wsId: ws._wsId });
      console.log('客人離開', ws.roomCode);
    }
  });
});

server.listen(port, () => console.log('球球大王伺服器啟動，port', port));
