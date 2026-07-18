# voip-signaling-server

Lightweight WebRTC signaling server built with Node.js + Socket.io.

Deployed on Railway at: https://voip-app-production-fc3c.up.railway.app

## What it does

Coordinates WebRTC peer discovery — it never touches audio.
Clients connect via Socket.io, join rooms, and relay SDP offers/answers
and ICE candidates so peers can establish direct P2P connections.

## API (Socket.io events)

| Event | Direction | Payload |
|---|---|---|
| `room:join` | client → server | `{ roomId, peerId, displayName }` |
| `peer:joined` | server → client | `{ socketId, peerId, displayName }` |
| `peer:left` | server → client | `{ socketId, peerId, displayName }` |
| `signal:offer` | relay | `{ to, offer }` |
| `signal:answer` | relay | `{ to, answer }` |
| `signal:ice-candidate` | relay | `{ to, candidate }` |
| `peer:speaking` | relay | `{ speaking }` |

## Health check

GET /health → `{ "status": "ok", "rooms": <count> }`

## Run locally

```bash
npm install
npm start        # port 3001
npm run dev      # with auto-reload
```

## Deploy (Railway)

Push this repo to GitHub, connect to Railway, set Root Directory to the repo root.
Railway auto-detects Node.js and runs `npm start`.
