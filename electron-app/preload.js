/**
 * Preload — contextIsolation: false mode
 * With contextIsolation off, this runs in the same JS context as the renderer.
 * Just assign to window directly instead of using contextBridge.
 */

const { ipcRenderer } = require('electron');

window.electronAPI = {
  minimize:    ()            => ipcRenderer.send('window:minimize'),
  hide:        ()            => ipcRenderer.send('window:hide'),
  quit:        ()            => ipcRenderer.send('window:close'),
  getConfig:   (key)         => ipcRenderer.invoke('config:get', key),
  setConfig:   (key, value)  => ipcRenderer.invoke('config:set', key, value),
  notifyState: (state)       => ipcRenderer.send('voip:state', state),
  onPTTDown:   (cb)          => ipcRenderer.on('ptt:down', cb),
  removePTTDown:(cb)         => ipcRenderer.removeListener('ptt:down', cb),
};
