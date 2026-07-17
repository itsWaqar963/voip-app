/**
 * AudioManager
 * ------------
 * Handles microphone capture, muting, push-to-talk, and
 * voice activity detection (VAD).
 *
 * VAD works by polling the Web Audio API AnalyserNode's time-domain data
 * to measure RMS amplitude. When it crosses the threshold, we emit a
 * 'speaking' event upward through VoIPCore so the UI can show indicators.
 *
 * No external libraries — pure Web Audio API.
 */

class AudioManager {
  constructor(core) {
    this._core        = core;
    this.localStream  = null;       // MediaStream from getUserMedia
    this._audioCtx    = null;
    this._analyser    = null;
    this._source      = null;
    this._vadInterval = null;
    this._muted       = false;
    this._speaking    = false;
    this._vadThreshold = 0.01;
  }

  /**
   * Capture the microphone and set up VAD.
   * In PTT mode, mic is captured but muted until setPTT(true).
   */
  async init({ pushToTalk = false, vadThreshold = 0.01 } = {}) {
    this._vadThreshold = vadThreshold;

    // Constraints tuned for voice / gaming:
    //   - echoCancellation  removes game audio bleed-through from speakers
    //   - noiseSuppression  cleans up keyboard/background noise
    //   - autoGainControl   evens out different mic levels between friends
    const constraints = {
      audio: {
        echoCancellation:  true,
        noiseSuppression:  true,
        autoGainControl:   true,
        sampleRate:        48000,
        channelCount:      1,       // Mono is enough for voice, halves bandwidth
      },
      video: false,
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[audio] mic captured');

    // Start muted in PTT mode
    if (pushToTalk) {
      this._setTrackEnabled(false);
      this._muted = true;
    }

    this._setupVAD();
  }

  setMuted(muted) {
    this._muted = muted;
    this._setTrackEnabled(!muted);

    if (muted && this._speaking) {
      this._speaking = false;
      this._core._onLocalSpeaking(false);
    }
  }

  destroy() {
    this._stopVAD();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this._audioCtx?.close();
    this._audioCtx = null;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _setTrackEnabled(enabled) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  _setupVAD() {
    if (!this.localStream) return;

    // Use AudioContext to analyse the mic signal
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._audioCtx.createAnalyser();
    this._analyser.fftSize = 512;

    this._source = this._audioCtx.createMediaStreamSource(this.localStream);
    this._source.connect(this._analyser);
    // Note: do NOT connect analyser to destination — that would create feedback

    const bufferLength = this._analyser.fftSize;
    const dataArray    = new Float32Array(bufferLength);

    // Poll every 100ms — low enough not to feel laggy, high enough to be cheap
    this._vadInterval = setInterval(() => {
      if (this._muted) return;

      this._analyser.getFloatTimeDomainData(dataArray);
      const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v * v, 0) / bufferLength);

      const nowSpeaking = rms > this._vadThreshold;
      if (nowSpeaking !== this._speaking) {
        this._speaking = nowSpeaking;
        this._core._onLocalSpeaking(nowSpeaking);
      }
    }, 100);
  }

  _stopVAD() {
    if (this._vadInterval) {
      clearInterval(this._vadInterval);
      this._vadInterval = null;
    }
  }
}

module.exports = AudioManager;
