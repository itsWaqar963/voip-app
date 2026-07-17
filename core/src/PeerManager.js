/**
 * PeerManager
 * -----------
 * Manages the map of WebRTC RTCPeerConnections in a full-mesh topology.
 *
 * Each entry in `_connections` is keyed by the remote socket ID (not peerId)
 * because socket IDs are what we use to route signaling messages through the
 * server. peerId is the stable application-level identifier.
 *
 * ── Offer/Answer flow ────────────────────────────────────────────────────────
 *
 *   Joiner (new peer)            Existing peer
 *        │                            │
 *        │── signal:offer ───────────>│
 *        │<─ signal:answer ───────────│
 *        │<─ signal:ice-candidate ────│ (trickle ICE, many messages)
 *        │── signal:ice-candidate ───>│
 *        │                            │
 *        │  (RTCPeerConnection now connected — audio flows P2P)
 *
 * The joiner always sends the offer (createOffer). Existing peers wait for
 * an offer and respond with an answer (handleOffer → createAnswer).
 */

class PeerEntry {
  constructor(socketId, peerId, displayName) {
    this.socketId    = socketId;
    this.peerId      = peerId;
    this.displayName = displayName;
    this.pc          = null;   // RTCPeerConnection
    this.audioEl     = null;   // <audio> element for remote stream
    this.volume      = 1.0;
    this.speaking    = false;
  }
}

class PeerManager {
  constructor(core) {
    this._core        = core;
    this._connections = new Map();  // socketId → PeerEntry
  }

  // ─── Called by VoIPCore when a peer joins but before they send an offer ──

  preparePeer(socketId, peerId, displayName) {
    if (this._connections.has(socketId)) return;
    const entry = new PeerEntry(socketId, peerId, displayName);
    this._connections.set(socketId, entry);
    return entry;
  }

  // ─── Initiate: we send the offer (called when WE join and find existing peers) ──

  async createOffer(socketId, peerId, displayName) {
    const entry = this.preparePeer(socketId, peerId, displayName) ||
                  this._connections.get(socketId);

    const pc = this._createPC(entry);
    entry.pc = pc;

    // Add our local audio track
    const localStream = this._core._audio.localStream;
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    this._core._signal('signal:offer', { to: socketId, offer });
    console.log(`[peer] offer sent → ${displayName}`);
  }

  // ─── Receive an offer, send an answer ────────────────────────────────────

  async handleOffer({ from, peerId, displayName, offer }) {
    // If we got an offer from someone we haven't seen yet, prepare their entry
    let entry = this._connections.get(from);
    if (!entry) {
      entry = this.preparePeer(from, peerId, displayName);
      this._core.emit('peer:joined', { socketId: from, peerId, displayName });
    }

    const pc = this._createPC(entry);
    entry.pc = pc;

    // Add our local audio track so they can hear us
    const localStream = this._core._audio.localStream;
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this._core._signal('signal:answer', { to: from, answer });
    console.log(`[peer] answer sent → ${displayName}`);
  }

  async handleAnswer({ from, answer }) {
    const entry = this._connections.get(from);
    if (!entry?.pc) return;
    await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async handleIceCandidate({ from, candidate }) {
    const entry = this._connections.get(from);
    if (!entry?.pc || !candidate) return;
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[peer] ICE candidate error:', e.message);
    }
  }

  // ─── Volume control ───────────────────────────────────────────────────────

  setPeerVolume(peerId, volume) {
    for (const entry of this._connections.values()) {
      if (entry.peerId === peerId && entry.audioEl) {
        entry.audioEl.volume = Math.max(0, Math.min(1, volume));
        entry.volume = volume;
      }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  closePeer(socketId) {
    const entry = this._connections.get(socketId);
    if (!entry) return;
    entry.pc?.close();
    entry.audioEl?.remove();
    this._connections.delete(socketId);
  }

  closeAll() {
    for (const socketId of this._connections.keys()) {
      this.closePeer(socketId);
    }
  }

  getAll() {
    return [...this._connections.values()].map(({ socketId, peerId, displayName, volume, speaking }) => ({
      socketId, peerId, displayName, volume, speaking,
    }));
  }

  // ─── Internal: create and configure an RTCPeerConnection ─────────────────

  _createPC(entry) {
    const pc = new RTCPeerConnection({
      iceServers: this._core.iceServers,
      // Prefer audio bandwidth. Good for gaming voice chat.
      sdpSemantics: 'unified-plan',
    });

    // Trickle ICE — send candidates as they're discovered
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._core._signal('signal:ice-candidate', {
          to: entry.socketId,
          candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[peer] ${entry.displayName} connection: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        // Attempt ICE restart
        pc.restartIce();
      }
    };

    // Remote audio track arrived
    pc.ontrack = ({ track, streams }) => {
      if (track.kind !== 'audio') return;

      const stream = streams[0];
      console.log(`[peer] remote track from ${entry.displayName}`);

      // Auto-attach to a hidden <audio> element so sound plays immediately
      // without the UI needing to do anything. The UI can replace this by
      // listening to the 'track' event on VoIPCore and handling it manually.
      let audioEl = entry.audioEl;
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.volume   = entry.volume;
        // No need to add to DOM — autoplay works without it in Electron
        entry.audioEl = audioEl;
      }
      audioEl.srcObject = stream;

      this._core._onRemoteTrack(entry.socketId, entry.peerId, entry.displayName, stream);
    };

    return pc;
  }
}

module.exports = PeerManager;
