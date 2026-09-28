// 球球大王 聯機中繼伺服器 (Node.js + ws)
const http = require('http');
const { WebSocketServer } = require('ws');
const port = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const rooms = {};
const queue = []; // 快速配對佇列

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcastRoom(room, msg) {
  send(room.host, msg);
  room.guests.forEach((g, guestWs) => send(guestWs, msg));
}

wss.on('connection', (ws) => {
  ws._wsId = Math.random().toString(36).slice(2, 10);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'createRoom') {
      let code;
      do { code = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[code]);
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
      send(ws, { t: 'joined', code: msg.code, yourId: ws._wsId });
      send(room.host, { t: 'guestJoined', wsId: ws._wsId, name: msg.name });
    }

    else if (msg.t === 'quickMatch') {
      // 快速配對：從佇列找一個等待中的人
      if (queue.length > 0) {
        const host = queue.shift();
        if (host.readyState !== 1) return;
        let code;
        do { code = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[code]);
        rooms[code] = { host, guests: new Map() };
        host.roomCode = code;
        rooms[code].guests.set(ws, { name: msg.name || '玩家' });
        ws.roomCode = code;
        send(host, { t: 'roomCreated', code, autoMatched: true, opponentName: msg.name });
        send(ws, { t: 'joined', code: code, autoMatched: true, hostName: host.playerName || '玩家' });
        console.log('快速配對成功', code);
      } else {
        ws.queueName = msg.name || '玩家';
        queue.push(ws);
        send(ws, { t: 'queueWait' });
        console.log('排隊中');
      }
    }

    else if (msg.t === 'hostStart') {
      const room = rooms[ws.roomCode];
      if (!room || room.host !== ws) return;
      // 伺服器隨機分配地圖
      const maps = ['original','grass','hell','cyber'];
      const mapId = maps[Math.floor(Math.random()*maps.length)];
      send(room.host, { t:'mapChosen', mapId });
      room.guests.forEach((g, guestWs) => {
        send(guestWs, { t: 'start', myIndex: msg.indexMap[g.name], ballStates: msg.ballStates, mapId });
      });
    }

    else {
      const room = rooms[ws.roomCode];
      if (!room) return;
      if (room.host === ws) {
        if (msg.guestTarget) {
          const target = [...room.guests.keys()].find(g => g._wsId === msg.guestTarget);
          if (target) send(target, msg);
        } else {
          room.guests.forEach((g, guestWs) => send(guestWs, msg));
        }
      } else if (room.guests.has(ws)) {
        send(room.host, Object.assign({}, msg, { fromGuest: ws._wsId }));
      }
    }
  });

  ws.on('close', () => {
    const qi = queue.indexOf(ws);
    if (qi >= 0) queue.splice(qi, 1);
    const room = rooms[ws.roomCode];
    if (!room) return;
    if (room.host === ws) {
      room.guests.forEach((g, guestWs) => send(guestWs, { t: 'hostLeft' }));
      delete rooms[ws.roomCode];
    } else {
      room.guests.delete(ws);
      send(room.host, { t: 'guestLeft', wsId: ws._wsId });
    }
  });
});

server.listen(port, () => console.log('球球大王伺服器啟動，port', port));
