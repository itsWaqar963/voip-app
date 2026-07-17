/**
 * Preload Script
 * --------------
 * Runs in the renderer's context but has access to Node APIs.
 * It exposes a safe, typed bridge (window.electronAPI) to the renderer.
 *
 * contextIsolation is ON, so the renderer cannot access Node directly.
 * Everything the renderer needs from the OS goes through this file.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Window controls ──────────────────────────────────────────────────────
  minimize: ()      => ipcRenderer.send('window:minimize'),
  hide:     ()      => ipcRenderer.send('window:hide'),
  quit:     ()      => ipcRenderer.send('window:close'),

  // ── Persistent config ────────────────────────────────────────────────────
  getConfig: (key)         => ipcRenderer.invoke('config:get', key),
  setConfig: (key, value)  => ipcRenderer.invoke('config:set', key, value),

  // ── VoIP state → tray icon ───────────────────────────────────────────────
  notifyState: (state) => ipcRenderer.send('voip:state', state),

  // ── Push-to-talk (triggered by global hotkey in main process) ────────────
  onPTTDown: (cb) => ipcRenderer.on('ptt:down', cb),
  removePTTDown: (cb) => ipcRenderer.removeListener('ptt:down', cb),
});
