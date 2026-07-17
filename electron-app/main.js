/**
 * Electron Main Process
 * ---------------------
 * Creates the app window and handles system-level concerns:
 *   - Window management
 *   - System tray (so you can hide the window while gaming)
 *   - IPC bridge between renderer and OS
 *   - Auto-updater (stub — wire in electron-updater later)
 *
 * The VoIP logic lives entirely in the renderer via VoIPCore.
 * This file stays thin on purpose.
 */

const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  globalShortcut, nativeImage, shell,
} = require('electron');
const path = require('path');

let mainWindow = null;
let tray       = null;

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:          380,
    height:         620,
    minWidth:       320,
    minHeight:      400,
    frame:          false,    // Custom title bar in renderer
    transparent:    false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload:              path.join(__dirname, 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      // WebRTC requires these in Electron
      webSecurity:          true,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'VoIP',
    show: false,   // Show after ready-to-show to avoid flash
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    // Minimize to tray on close instead of quitting
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── System tray ───────────────────────────────────────────────────────────────

function createTray() {
  // Fallback to a blank icon if assets/icon.png isn't ready
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).isEmpty()
    ? nativeImage.createEmpty()
    : nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('VoIP');

  const menu = Menu.buildFromTemplate([
    { label: 'Show VoIP',   click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit',        click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

function setupIPC() {
  // Window controls (frameless window needs these)
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:hide',     () => mainWindow.hide());
  ipcMain.on('window:close',    () => { app.isQuitting = true; app.quit(); });

  // Config persistence (store server URL, display name)
  const Store = lazyStore();
  ipcMain.handle('config:get', (_, key)        => Store.get(key));
  ipcMain.handle('config:set', (_, key, value) => Store.set(key, value));

  // Notify tray icon of connection state
  ipcMain.on('voip:state', (_, { connected }) => {
    tray?.setToolTip(connected ? 'VoIP — Connected' : 'VoIP');
  });
}

// Tiny key-value store using Electron's userData path (no extra dependencies)
function lazyStore() {
  const fs       = require('fs');
  const filePath = path.join(app.getPath('userData'), 'config.json');

  let data = {};
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (_) {}

  return {
    get: (key)        => data[key],
    set: (key, value) => {
      data[key] = value;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    },
  };
}

// ── Push-to-talk global hotkey ────────────────────────────────────────────────

function setupPTTHotkey() {
  // Ctrl+Alt+V as default PTT key. User can change this in settings later.
  // Global shortcuts work even when the app window is not focused — essential
  // for gaming where another window is always in the foreground.
  const PTT_KEY = 'CommandOrControl+Alt+V';

  try {
    globalShortcut.register(PTT_KEY, () => {
      mainWindow?.webContents.send('ptt:down');
    });
    // Electron doesn't have keyup for global shortcuts natively.
    // We handle this in the renderer via keydown/keyup on the window.
    // The global shortcut only triggers PTT:down so the user can start
    // speaking even if the voip window isn't focused.
  } catch (e) {
    console.warn('[main] Could not register PTT hotkey:', e.message);
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
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
  // Keep app alive in tray on macOS/Windows
  if (process.platform === 'linux') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
