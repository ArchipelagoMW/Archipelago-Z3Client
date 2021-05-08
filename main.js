const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const lzma = require('lzma-native');
const yaml = require('js-yaml');
const bsdiff = require('bsdiff-node');

// TODO: Remove this line, as it is used for in-development notifications
app.setAppUserModelId(process.execPath);

// Used to transfer server data from the main process to the renderer process
const sharedData = {};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    minWidth: 400,
    height: 720,
    minHeight: 100,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');
};

app.whenReady().then(async () => {
  // Create the local config file if it does not exist
  const configPath = path.join(process.env.APPDATA, 'ap-lttp.config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath,JSON.stringify({}));
  }

  // Load the config into memory
  const config = JSON.parse(fs.readFileSync(configPath));

  // Prompt for base rom file if not present in config or if missing from disk
  if (!config.hasOwnProperty('baseRomPath') || !fs.existsSync(config.baseRomPath)) {
    let baseRomPath = dialog.showOpenDialogSync(null, {
      title: 'Select base ROM',
      buttonLabel: 'Choose ROM',
      message: 'Choose a base ROM to be used when patching.',
    });
    // Save base rom filepath back to config file
    if (baseRomPath) {
      config.baseRomPath = baseRomPath[0];
      fs.writeFileSync(configPath, JSON.stringify(Object.assign({}, config, {
        baseRomPath: config.baseRomPath,
      })));
    }
  }

  // Create a new ROM from the patch file if the patch file is provided and the base rom is known
  if (process.argv[2] && config.hasOwnProperty('baseRomPath')) {
    if (fs.existsSync(process.argv[2]) && fs.existsSync(config.baseRomPath)) {
      const patchFilePath = path.join(__dirname, 'patch.bsdiff');
      const romFilePath = path.join(process.cwd(), 'output.sfc');
      const apbpBuffer = await lzma.decompress(fs.readFileSync(process.argv[2]));
      const apbp = yaml.load(apbpBuffer);
      sharedData.apServerAddress = apbp.meta.server | null;
      fs.writeFileSync(patchFilePath, apbp.patch);
      await bsdiff.patch(config.baseRomPath, romFilePath, patchFilePath);
      fs.rmSync(patchFilePath);
      // TODO: Automatically launch the ROM file
    }
  }

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

// Interprocess communication with the renderer process
ipcMain.on('requestSharedData', (event, args) => {
  event.sender.send('sharedData', sharedData);
});