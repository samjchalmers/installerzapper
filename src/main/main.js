const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('path');
const { getDrives, startScan, cancelScan } = require('./scanner');
const fs = require('fs').promises;

let mainWindow;
let scanCancelToken = { cancelled: false };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 520,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f0f0f',
      symbolColor: '#ffffff',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Block navigation away from the local page
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('scan:drives', async () => {
  return getDrives();
});

ipcMain.handle('scan:start', async (event, drives) => {
  scanCancelToken = { cancelled: false };
  const send = (batch) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('scan:progress', batch);
    }
  };
  return startScan(drives, scanCancelToken, send);
});

ipcMain.on('scan:cancel', () => {
  scanCancelToken.cancelled = true;
});

ipcMain.handle('files:delete', async (_event, paths) => {
  // Move to Recycle Bin rather than permanent delete — allows recovery if a file
  // was misidentified. shell.trashItem() uses the OS recycle bin API on Windows.
  const results = [];
  for (const filePath of paths) {
    try {
      await shell.trashItem(filePath);
      results.push({ path: filePath, success: true });
    } catch (err) {
      results.push({ path: filePath, success: false, error: err.message });
    }
  }
  return results;
});

ipcMain.handle('shell:showItem', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('export:save', async (_event, { content, defaultName, format }) => {
  const filters = format === 'csv'
    ? [{ name: 'CSV', extensions: ['csv'] }]
    : [{ name: 'Markdown', extensions: ['md'] }];
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters,
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, content, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('clipboard:write', (_event, text) => {
  clipboard.writeText(text);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
