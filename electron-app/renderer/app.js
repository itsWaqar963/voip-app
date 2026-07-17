/**
 * Renderer — app.js
 * -----------------
 * Thin UI controller that wires VoIPCore events to DOM updates.
 * It knows nothing about WebRTC internals — all audio/networking
 * logic is inside VoIPCore.
 *
 * If you want to rewrite the UI in React/Vue later, replicate
 * only this file (and index.html/style.css). VoIPCore stays the same.
 */

'use strict';

const VoIPCore = require('../../../core/src/index');

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const statusDot      = $('statusDot');
const screenConnect  = $('screenConnect');
const screenRoom     = $('screenRoom');
const inputName      = $('inputName');
const inputRoom      = $('inputRoom');
const inputServer    = $('inputServer');
const chkPTT         = $('chkPTT');
const pttHint        = $('pttHint');
const btnJoin        = $('btnJoin');
const connectError   = $('connectError');
const roomName       = $('roomName');
const roomSub        = $('roomSub');
const peerList       = $('peerList');
const localName      = $('localName');
const localInitials  = $('localInitials');
const localStatus    = $('localStatus');
const localAvatar    = $('localAvatar');
const localRing      = $('localRing');
const btnPTT         = $('btnPTT');
const btnMute        = $('btnMute');
const btnLeave       = $('btnLeave');
const btnSettings    = $('btnSettings');
const settingsPanel  = $('settingsPanel');
const btnSettingsClose = $('btnSettingsClose');
const sliderVAD      = $('sliderVAD');
const sliderVADVal   = $('sliderVADVal');
const volumeControls = $('volumeControls');

// ── State ──────────────────────────────────────────────────────────────────────

let voip       = null;
let pttMode    = false;
let pttActive  = false;

// speaking state: socketId → bool
const speakingMap = new Map();
// peers: socketId → { peerId, displayName }
const peersMap = new Map();

// ── Titlebar ───────────────────────────────────────────────────────────────────

$('btnMinimize').onclick = () => window.electronAPI?.minimize();
$('btnClose').onclick    = () => window.electronAPI?.hide();

// ── Restore saved prefs ────────────────────────────────────────────────────────

async function restorePrefs() {
  const api = window.electronAPI;
  if (!api) return;
  const name   = await api.getConfig('displayName');
  const server = await api.getConfig('serverUrl');
  const room   = await api.getConfig('lastRoom');
  if (name)   inputName.value   = name;
  if (server) inputServer.value = server;
  if (room)   inputRoom.value   = room;
}
restorePrefs();

// ── Toggle PTT hint ────────────────────────────────────────────────────────────

chkPTT.addEventListener('change', () => {
  pttHint.style.display = chkPTT.checked ? 'inline' : 'none';
});
pttHint.style.display = 'none';

// ── Join ──────────────────────────────────────────────────────────────────────

btnJoin.addEventListener('click', async () => {
  connectError.textContent = '';
  const name   = inputName.value.trim()   || 'Anonymous';
  const room   = inputRoom.value.trim()   || 'default';
  const server = inputServer.value.trim();
  pttMode = chkPTT.checked;

  if (!server) {
    connectError.textContent = 'Please enter a server URL.';
    return;
  }

  // Save prefs
  window.electronAPI?.setConfig('displayName', name);
  window.electronAPI?.setConfig('serverUrl', server);
  window.electronAPI?.setConfig('lastRoom', room);

  btnJoin.disabled = true;
  btnJoin.textContent = 'Connecting…';
  statusDot.className = 'logo-dot connecting';

  // VAD threshold: slider 1-50 → 0.001 to 0.05
  const vadThreshold = sliderVAD.value / 1000;

  voip = new VoIPCore({
    serverUrl:    server,
    displayName:  name,
    pushToTalk:   pttMode,
    vadThreshold,
  });

  bindVoIPEvents();

  try {
    await voip.connect(room);
    showRoom(name, room);
  } catch (err) {
    connectError.textContent = err.message;
    btnJoin.disabled = false;
    btnJoin.textContent = 'Join';
    statusDot.className = 'logo-dot';
    voip = null;
  }
});

// ── VoIP events → UI ──────────────────────────────────────────────────────────

function bindVoIPEvents() {
  voip.on('connected', () => {
    statusDot.className = 'logo-dot connected';
    roomSub.textContent = 'connected';
    window.electronAPI?.notifyState({ connected: true });
  });

  voip.on('disconnected', () => {
    statusDot.className = 'logo-dot';
    window.electronAPI?.notifyState({ connected: false });
  });

  voip.on('peer:joined', ({ socketId, peerId, displayName }) => {
    peersMap.set(socketId, { peerId, displayName });
    addPeerCard(socketId, displayName);
    roomSub.textContent = `${peersMap.size + 1} in room`;
    refreshVolumeControls();
  });

  voip.on('peer:left', ({ socketId, displayName }) => {
    peersMap.delete(socketId);
    speakingMap.delete(socketId);
    document.getElementById(`peer-${socketId}`)?.remove();
    roomSub.textContent = peersMap.size === 0 ? 'just you' : `${peersMap.size + 1} in room`;
    refreshVolumeControls();
  });

  voip.on('speaking', ({ socketId, peerId, displayName, speaking, local }) => {
    if (local) {
      // Local speaking indicator
      if (speaking) {
        localAvatar.classList.add('speaking');
      } else {
        localAvatar.classList.remove('speaking');
      }
      return;
    }
    speakingMap.set(socketId, speaking);
    updatePeerSpeaking(socketId, speaking);
  });

  voip.on('muted', ({ muted }) => {
    btnMute.textContent = muted ? '🔇' : '🎙';
    btnMute.title       = muted ? 'Unmute' : 'Mute';
    localStatus.textContent = muted ? 'muted' : (pttMode ? 'push-to-talk' : 'open mic');
  });

  voip.on('signaling:disconnected', ({ reason }) => {
    if (reason === 'io server disconnect') {
      roomSub.textContent = 'disconnected — reconnecting…';
      statusDot.className = 'logo-dot connecting';
    }
  });
}

// ── Room screen ───────────────────────────────────────────────────────────────

function showRoom(name, room) {
  screenConnect.classList.remove('active');
  screenRoom.classList.add('active');

  roomName.textContent     = `# ${room}`;
  localName.textContent    = name;
  localInitials.textContent = initials(name);
  localStatus.textContent  = pttMode ? 'push-to-talk' : 'open mic';

  btnPTT.style.display   = pttMode ? 'inline-flex' : 'none';
  btnMute.style.display  = pttMode ? 'none'         : 'inline-flex';

  peerList.innerHTML = '';
  peersMap.clear();

  btnJoin.disabled = false;
  btnJoin.textContent = 'Join';
  roomSub.textContent = 'just you';
}

// ── Leave ─────────────────────────────────────────────────────────────────────

btnLeave.addEventListener('click', async () => {
  if (voip) { await voip.disconnect(); voip = null; }
  screenRoom.classList.remove('active');
  screenConnect.classList.add('active');
  statusDot.className = 'logo-dot';
  peersMap.clear();
  speakingMap.clear();
  peerList.innerHTML = '';
});

// ── Mute toggle ───────────────────────────────────────────────────────────────

btnMute.addEventListener('click', () => voip?.toggleMute());

// ── PTT button (mouse) ────────────────────────────────────────────────────────

btnPTT.addEventListener('mousedown', () => startPTT());
btnPTT.addEventListener('mouseup',   () => stopPTT());
btnPTT.addEventListener('mouseleave',() => stopPTT());

// PTT keyboard (works when window is focused)
document.addEventListener('keydown', (e) => {
  if (pttMode && e.ctrlKey && e.altKey && e.key === 'v') startPTT();
});
document.addEventListener('keyup', (e) => {
  if (pttMode && e.key === 'v') stopPTT();
});

// PTT triggered by global hotkey from main process
window.electronAPI?.onPTTDown(() => { if (pttMode) startPTT(); });

function startPTT() {
  if (!pttMode || pttActive) return;
  pttActive = true;
  voip?.setPTT(true);
  btnPTT.classList.add('active');
  btnPTT.textContent = '🎙 LIVE';
  localStatus.textContent = 'speaking…';
}

function stopPTT() {
  if (!pttMode || !pttActive) return;
  pttActive = false;
  voip?.setPTT(false);
  btnPTT.classList.remove('active');
  btnPTT.textContent = '🎙 HOLD';
  localStatus.textContent = 'push-to-talk';
}

// ── Settings ──────────────────────────────────────────────────────────────────

btnSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  refreshVolumeControls();
});
btnSettingsClose.addEventListener('click', () => settingsPanel.classList.remove('open'));

sliderVAD.addEventListener('input', () => {
  sliderVADVal.textContent = sliderVAD.value;
});

function refreshVolumeControls() {
  volumeControls.innerHTML = '';
  for (const [socketId, { peerId, displayName }] of peersMap) {
    const row = document.createElement('div');
    row.className = 'volume-row';
    row.innerHTML = `
      <span class="volume-label" title="${displayName}">${displayName}</span>
      <input type="range" min="0" max="100" value="100" data-peer="${peerId}" />
      <span style="font-size:11px;color:var(--text-muted);width:30px">100%</span>
    `;
    const slider = row.querySelector('input');
    const label  = row.querySelector('span:last-child');
    slider.addEventListener('input', () => {
      const vol = slider.value / 100;
      label.textContent = slider.value + '%';
      voip?.setPeerVolume(peerId, vol);
    });
    volumeControls.appendChild(row);
  }
  if (peersMap.size === 0) {
    volumeControls.innerHTML = '<p style="color:var(--text-muted);font-size:12px">No peers connected yet</p>';
  }
}

// ── Peer card DOM helpers ─────────────────────────────────────────────────────

function addPeerCard(socketId, displayName) {
  // Remove if already exists (reconnect scenario)
  document.getElementById(`peer-${socketId}`)?.remove();

  const card = document.createElement('div');
  card.className = 'peer-card';
  card.id        = `peer-${socketId}`;
  card.innerHTML = `
    <div class="avatar">
      <span class="avatar-initials">${initials(displayName)}</span>
      <span class="speaking-ring"></span>
    </div>
    <span class="peer-name">${escHtml(displayName)}</span>
    <span class="peer-status-icon" title="connected">🔊</span>
  `;
  peerList.appendChild(card);
}

function updatePeerSpeaking(socketId, speaking) {
  const card = document.getElementById(`peer-${socketId}`);
  if (!card) return;
  card.classList.toggle('speaking', speaking);
  const icon = card.querySelector('.peer-status-icon');
  if (icon) { icon.textContent = speaking ? '🗣' : '🔊'; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function initials(name) {
  return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
