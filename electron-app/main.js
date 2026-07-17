const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  globalShortcut, nativeImage, shell, session,
} = require('electron');
const path = require('path');

let mainWindow = null;
let tray       = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           380,
    height:          620,
    minWidth:        320,
    minHeight:       400,
    frame:           false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: false,   // must be false so preload & renderer share same context
      nodeIntegration:  true,    // renderer can require() Node modules (VoIPCore etc.)
      webSecurity:      true,
    },
    title: 'VoIP',
    show:  false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open DevTools so you can see any errors during development
  // Comment this line out once everything is working.
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Use an empty icon if the PNG asset doesn't exist yet
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon;
  try {
    const img = nativeImage.createFromPath(iconPath);
    icon = img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
  } catch (_) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('VoIP');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show VoIP', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show());
}

function setupPermissions() {
  // Grant microphone (and any other media) permission automatically.
  // Without this Electron silently blocks getUserMedia and the app freezes.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture'];
    callback(allowed.includes(permission));
  });

  // Also needed in some Electron versions for getUserMedia
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return ['media', 'microphone', 'audioCapture'].includes(permission);
  });
}

function setupIPC() {
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:hide',     () => mainWindow.hide());
  ipcMain.on('window:close',    () => { app.isQuitting = true; app.quit(); });

  const Store = lazyStore();
  ipcMain.handle('config:get', (_, key)        => Store.get(key));
  ipcMain.handle('config:set', (_, key, value) => Store.set(key, value));

  ipcMain.on('voip:state', (_, { connected }) => {
    tray?.setToolTip(connected ? 'VoIP — Connected' : 'VoIP');
  });
}

function lazyStore() {
  const fs       = require('fs');
  const filePath = path.join(app.getPath('userData'), 'config.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (_) {}
  return {
    get: (key)        => data[key],
    set: (key, value) => { data[key] = value; fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); },
  };
}

function setupPTTHotkey() {
  try {
    globalShortcut.register('CommandOrControl+Alt+V', () => {
      mainWindow?.webContents.send('ptt:down');
    });
  } catch (e) {
    console.warn('[main] PTT hotkey failed:', e.message);
  }
}

app.whenReady().then(() => {
  setupPermissions();  // must be before createWindow
  createWindow();
  createTray();
  setupIPC();
  setupPTTHotkey();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'linux') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
