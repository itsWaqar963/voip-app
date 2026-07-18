/**
 * VoIP Signaling Server
 * ---------------------
 * Lightweight Socket.io server that coordinates WebRTC peer discovery.
 * It NEVER touches audio — it only relays SDP offers/answers and ICE
 * candidates so peers can negotiate a direct connection.
 *
 * Rooms are ephemeral (in-memory). For persistence across restarts,
 * swap `rooms` Map for Redis. That's the only change needed.
 *
 * Deploy: Railway / Render / any Node host. See README.
 */

const { createServer } = require('http');
const { Server }       = require('socket.io');

const PORT = process.env.PORT || 3001;

const httpServer = createServer((req, res) => {
  // Health-check endpoint (Railway uses this)
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',          // Lock this down in production if you want
    methods: ['GET', 'POST'],
  },
});

// rooms: Map<roomId, Map<socketId, { peerId, displayName }>>
const rooms = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function getRoomPeers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.entries()].map(([socketId, info]) => ({ socketId, ...info }));
}

function leaveRoom(socket) {
  const { roomId, peerId, displayName } = socket.data ?? {};
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (room) {
    room.delete(socket.id);
    if (room.size === 0) {
      rooms.delete(roomId);
      console.log(`[room] "${roomId}" empty, removed`);
    } else {
      // Tell remaining peers this one left
      socket.to(roomId).emit('peer:left', { socketId: socket.id, peerId, displayName });
    }
  }
}

// ─── Connection handler ──────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  /**
   * Join a named room.
   * Client sends: { roomId, peerId, displayName }
   * Server responds: { peers: [...existing peers] }
   */
  socket.on('room:join', ({ roomId, peerId, displayName } = {}, ack) => {
    if (!roomId || !peerId) {
      ack?.({ error: 'roomId and peerId required' });
      return;
    }

    // Leave any previous room first
    leaveRoom(socket);

    const room = getOrCreateRoom(roomId);

    // Collect existing peers BEFORE adding self
    const existingPeers = getRoomPeers(roomId);

    // Add self
    room.set(socket.id, { peerId, displayName: displayName || peerId });
    socket.data = { roomId, peerId, displayName };
    socket.join(roomId);

    console.log(`[join] "${displayName}" (${peerId}) → room "${roomId}" (${room.size} peers)`);

    // Tell existing peers that a new peer arrived
    socket.to(roomId).emit('peer:joined', {
      socketId: socket.id,
      peerId,
      displayName: displayName || peerId,
    });

    // Return existing peers to the new joiner so they can initiate offers
    ack?.({ peers: existingPeers });
  });

  /**
   * WebRTC signaling relay — just forward to the target socket.
   * We relay three message types: offer, answer, ice-candidate
   */
  socket.on('signal:offer', ({ to, offer }) => {
    io.to(to).emit('signal:offer', {
      from: socket.id,
      peerId: socket.data?.peerId,
      displayName: socket.data?.displayName,
      offer,
    });
  });

  socket.on('signal:answer', ({ to, answer }) => {
    io.to(to).emit('signal:answer', {
      from: socket.id,
      answer,
    });
  });

  socket.on('signal:ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('signal:ice-candidate', {
      from: socket.id,
      candidate,
    });
  });

  /**
   * Optional: broadcast speaking state so the UI can show who's talking.
   * Client sends { speaking: true/false } based on VAD.
   */
  socket.on('peer:speaking', ({ speaking }) => {
    const { roomId, peerId, displayName } = socket.data ?? {};
    if (!roomId) return;
    socket.to(roomId).emit('peer:speaking', {
      socketId: socket.id,
      peerId,
      displayName,
      speaking,
    });
  });

  // ── Disconnect / leave ────────────────────────────────────────────────────

  socket.on('room:leave', () => {
    leaveRoom(socket);
    socket.data = {};
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
    console.log(`[disconnect] ${socket.id}`);
  });
});

// ─── Boot ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`VoIP signaling server listening on port ${PORT}`);
});
