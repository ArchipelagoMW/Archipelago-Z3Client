const { app, BrowserWindow } = require('electron');
const path = require('path');

const VERSION = "Alpha 0.0.1";

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    minWidth: 800,
    height: 720,
    minHeight: 500,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  win.loadFile('index.html');
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});