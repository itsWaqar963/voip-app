/**
 * VoIPCore — plug-and-play WebRTC voice engine
 * =============================================
 * This class is the heart of the application. It knows nothing about
 * Electron, the DOM, or any UI framework. Wire it up anywhere:
 *   - Electron renderer (current)
 *   - A React/Vue component
 *   - A plain HTML page
 *   - A future mobile WebView
 *
 * Usage:
 *   const voip = new VoIPCore({ serverUrl: 'wss://...', displayName: 'Nawaz' });
 *   voip.on('peer:joined', ({ peerId, displayName }) => renderUserCard(...));
 *   voip.on('speaking', ({ peerId, speaking }) => highlightUser(...));
 *   await voip.connect('my-game-lobby');
 *
 * ── Upgrade path to SFU (mediasoup / livekit) ───────────────────────────────
 * The mesh topology (every peer ↔ every peer) works great for ≤10 people
 * on audio-only. When you want 20+ people or video, swap PeerManager for
 * an SFU client: the event API exposed by VoIPCore stays the same, only
 * PeerManager's internals change.
 */

const { io }          = require('socket.io-client');
const PeerManager     = require('./PeerManager');
const AudioManager    = require('./AudioManager');
const EventEmitter    = require('events');

// Free STUN servers (Google). For robust NAT traversal add a TURN server.
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Add TURN here if friends can't connect (symmetric NAT):
  // { urls: 'turn:your-turn-server.com', username: '...', credential: '...' }
];

class VoIPCore extends EventEmitter {
  /**
   * @param {object}  opts
   * @param {string}  opts.serverUrl       - Signaling server WebSocket URL
   * @param {string}  opts.displayName     - Local user's display name
   * @param {string}  [opts.peerId]        - Stable peer ID (random UUID by default)
   * @param {object}  [opts.iceServers]    - Override ICE config
   * @param {boolean} [opts.pushToTalk]    - Start in PTT mode (default: false = open mic)
   * @param {number}  [opts.vadThreshold]  - VAD silence threshold 0-1 (default 0.01)
   */
  constructor(opts = {}) {
    super();

    this.serverUrl    = opts.serverUrl;
    this.displayName  = opts.displayName || 'Anonymous';
    this.peerId       = opts.peerId      || VoIPCore.generateId();
    this.iceServers   = opts.iceServers  || DEFAULT_ICE_SERVERS;
    this.pushToTalk   = opts.pushToTalk  ?? false;
    this.vadThreshold = opts.vadThreshold ?? 0.01;

    this._roomId    = null;
    this._socket    = null;
    this._peers     = new PeerManager(this);
    this._audio     = new AudioManager(this);
    this._muted     = false;
    this._pttActive = false;   // only relevant in PTT mode
    this._connected = false;
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Connect to the signaling server and join a room.
   * Resolves when signaling is established and mic is captured.
   *
   * @param {string} roomId
   */
  async connect(roomId) {
    if (this._connected) throw new Error('Already connected. Call disconnect() first.');

    this._roomId = roomId;

    // 1. Capture microphone
    await this._audio.init({ pushToTalk: this.pushToTalk, vadThreshold: this.vadThreshold });

    // 2. Connect to signaling server
    await this._connectSignaling();

    // 3. Join room — server returns existing peers
    const { peers, error } = await this._joinRoom(roomId);
    if (error) throw new Error(`Failed to join room: ${error}`);

    // 4. Initiate peer connections to everyone already in the room
    for (const peer of peers) {
      await this._peers.createOffer(peer.socketId, peer.peerId, peer.displayName);
    }

    this._connected = true;
    this.emit('connected', { roomId, peerId: this.peerId });
  }

  /**
   * Leave the room and clean up everything.
   */
  async disconnect() {
    if (this._socket) {
      this._socket.emit('room:leave');
      this._socket.disconnect();
      this._socket = null;
    }
    this._peers.closeAll();
    this._audio.destroy();
    this._connected = false;
    this._roomId    = null;
    this.emit('disconnected');
  }

  /** Mute/unmute local mic. */
  setMuted(muted) {
    this._muted = muted;
    this._audio.setMuted(muted);
    this.emit('muted', { muted });
  }

  toggleMute() { this.setMuted(!this._muted); }

  get isMuted() { return this._muted; }

  /**
   * Push-to-talk: call with true on keydown, false on keyup.
   * Only has effect when pushToTalk mode is enabled.
   */
  setPTT(active) {
    if (!this.pushToTalk) return;
    this._pttActive = active;
    this._audio.setMuted(!active);   // unmute while holding, mute when released
  }

  /**
   * Set volume for a specific remote peer (0.0 – 1.0).
   * Affects only that peer's audio element.
   */
  setPeerVolume(peerId, volume) {
    this._peers.setPeerVolume(peerId, volume);
  }

  /** Returns array of connected peer info objects. */
  getPeers() {
    return this._peers.getAll();
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  _connectSignaling() {
    return new Promise((resolve, reject) => {
      this._socket = io(this.serverUrl, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      this._socket.once('connect', () => {
        console.log('[signaling] connected:', this._socket.id);
        this._bindSignalingEvents();
        resolve();
      });

      this._socket.once('connect_error', (err) => {
        reject(new Error(`Signaling connection failed: ${err.message}`));
      });
    });
  }

  _joinRoom(roomId) {
    return new Promise((resolve) => {
      this._socket.emit('room:join', {
        roomId,
        peerId:      this.peerId,
        displayName: this.displayName,
      }, resolve);
    });
  }

  _bindSignalingEvents() {
    const s = this._socket;

    // New peer joined after us — they will send an offer
    s.on('peer:joined', ({ socketId, peerId, displayName }) => {
      console.log(`[signaling] peer:joined ${displayName}`);
      this._peers.preparePeer(socketId, peerId, displayName);
      this.emit('peer:joined', { socketId, peerId, displayName });
    });

    s.on('peer:left', ({ socketId, peerId, displayName }) => {
      console.log(`[signaling] peer:left ${displayName}`);
      this._peers.closePeer(socketId);
      this.emit('peer:left', { socketId, peerId, displayName });
    });

    // WebRTC signaling relay
    s.on('signal:offer',         (data) => this._peers.handleOffer(data));
    s.on('signal:answer',        (data) => this._peers.handleAnswer(data));
    s.on('signal:ice-candidate', (data) => this._peers.handleIceCandidate(data));

    // Speaking notifications from other peers
    s.on('peer:speaking', (data) => {
      this.emit('speaking', data);
    });

    s.on('disconnect', (reason) => {
      console.log('[signaling] disconnected:', reason);
      this.emit('signaling:disconnected', { reason });
    });

    s.on('reconnect', () => {
      console.log('[signaling] reconnected — rejoining room');
      this._joinRoom(this._roomId);
    });
  }

  /**
   * Called by AudioManager when VAD detects local speaking state change.
   * Broadcasts to peers via signaling so their UIs can show indicators.
   */
  _onLocalSpeaking(speaking) {
    this.emit('speaking', {
      socketId:    this._socket?.id,
      peerId:      this.peerId,
      displayName: this.displayName,
      speaking,
      local:       true,
    });
    this._socket?.emit('peer:speaking', { speaking });
  }

  /**
   * Called by PeerManager when a remote track arrives.
   * Emits 'track' so the UI can attach it to an <audio> element (or ignore it
   * — AudioManager auto-attaches by default).
   */
  _onRemoteTrack(socketId, peerId, displayName, stream) {
    this.emit('track', { socketId, peerId, displayName, stream });
  }

  /** Send a signaling message through the server. */
  _signal(event, payload) {
    this._socket?.emit(event, payload);
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  static generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

module.exports = VoIPCore;
