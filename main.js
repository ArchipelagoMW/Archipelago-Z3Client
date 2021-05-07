const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const lzma = require('lzma-native');
const yaml = require('js-yaml');
const bsdiff = require('bsdiff-node');

// TODO: Remove this line, as it is used for in-development notifications
app.setAppUserModelId(process.execPath);

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    minWidth: 800,
    height: 720,
    minHeight: 500,
    autoHideMenuBar: true,
    webPreferences: {}
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
      const apServer = apbp.meta.server | null;
      // TODO: Connect user to AP server automatically
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