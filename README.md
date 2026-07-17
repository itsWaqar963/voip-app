# VoIP — Gaming Voice Chat

Peer-to-peer voice chat for you and your friends. Built on WebRTC (audio flows directly between players, not through a server).

```
voip-app/
├── server/          ← Signaling server  (deploy to Railway)
├── core/            ← VoIP engine       (swap UIs without touching this)
└── electron-app/    ← Desktop app       (current UI)
```

---

## Quick start

### 1. Deploy the signaling server to Railway (free)

1. Create a [Railway](https://railway.app) account (GitHub login works).
2. Click **New Project → Deploy from GitHub repo**.
3. Point it at this repo's `server/` folder, or push just `server/` to a new repo.
4. Railway auto-detects Node.js and runs `npm start`.
5. Go to **Settings → Networking → Generate Domain** — copy that URL (e.g. `https://voip-server-production.up.railway.app`).

That URL is your signaling server. Friends paste it into the app.

> **Alternative (no deploy):** Run `cd server && npm install && npm start` locally, then use [ngrok](https://ngrok.com): `ngrok http 3001`. Share the ngrok URL with friends. Free tier works.

---

### 2. Run the Electron app

```bash
# Install dependencies
cd electron-app
npm install

# Start
npm start
```

On first launch:
- Enter your display name (e.g. "Nawaz")
- Enter a room code (anything you and your friends agree on, e.g. "squad")
- Paste the Railway/ngrok server URL
- Click **Join**

Share the same room code + server URL with friends and you're in.

---

## Features

| Feature | How |
|---|---|
| Open mic | Default mode — mic is always on |
| Push-to-talk | Toggle in the connect screen. Hold **Ctrl+Alt+V** to speak (works even when gaming in another window) |
| Speaking indicators | Green ring around avatar when someone is talking (voice activity detection) |
| Per-peer volume | Settings panel → drag per-person volume slider |
| VAD sensitivity | Settings → VAD slider. Raise it if background noise falsely triggers the indicator |
| Mute | 🎙 button in the local bar, or just press the button |
| Minimize to tray | ✕ button hides to system tray. Right-click tray icon to quit |

---

## Connecting friends

1. Everyone installs the Electron app (`npm install && npm start` in `electron-app/`)
2. You share two things:
   - **Server URL** — your Railway URL (or ngrok URL if running locally)
   - **Room code** — any short string (e.g. "game-lobby")
3. Everyone enters the same two values and joins

No accounts, no sign-in, no phone numbers.

---

## Architecture (for future UI swaps)

`VoIPCore` in `core/src/VoIPCore.js` is a plain Node.js `EventEmitter`. It knows nothing about Electron or the DOM. To build a new UI:

```js
const VoIPCore = require('./core/src');

const voip = new VoIPCore({
  serverUrl:   'wss://your-server.railway.app',
  displayName: 'Nawaz',
  pushToTalk:  false,
});

// Wire events to your UI framework
voip.on('peer:joined',  ({ peerId, displayName }) => { /* add user card */ });
voip.on('peer:left',    ({ peerId })               => { /* remove card  */ });
voip.on('speaking',     ({ peerId, speaking })     => { /* glow effect  */ });

await voip.connect('game-lobby');
```

Events emitted by VoIPCore:

| Event | Payload |
|---|---|
| `connected` | `{ roomId, peerId }` |
| `disconnected` | — |
| `peer:joined` | `{ socketId, peerId, displayName }` |
| `peer:left` | `{ socketId, peerId, displayName }` |
| `speaking` | `{ socketId, peerId, displayName, speaking, local? }` |
| `muted` | `{ muted }` |
| `track` | `{ socketId, peerId, displayName, stream }` |
| `signaling:disconnected` | `{ reason }` |

---

## Upgrading to an SFU (for 20+ people or video)

The current mesh topology works great for ≤10 people on audio. When you're ready to scale, swap `PeerManager` for a [LiveKit](https://livekit.io) or [mediasoup](https://mediasoup.org) client. VoIPCore's public API and events stay identical — only `core/src/PeerManager.js` changes.

---

## Troubleshooting

**Friends can't connect / audio is one-way**
This usually means a symmetric NAT is blocking direct P2P. Add a free TURN server to `VoIPCore.js`:
```js
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls:       'turn:openrelay.metered.ca:80',
    username:   'openrelayproject',
    credential: 'openrelayproject',
  },
];
```
(openrelay is a free public TURN server, fine for testing.)

**"Could not start audio" error**
- Check that your mic isn't blocked in OS privacy settings
- On Windows: Settings → Privacy → Microphone → allow apps

**High latency**
- Deploy the signaling server closer to your region on Railway (select region in project settings)
- Latency is mainly determined by the P2P path between players, not the server
