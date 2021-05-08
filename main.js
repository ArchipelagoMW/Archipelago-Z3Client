const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const lzma = require('lzma-native');
const yaml = require('js-yaml');
const bsdiff = require('bsdiff-node');

// Perform certain actions during the install process
if (require('electron-squirrel-startup')) {
  if (process.platform === 'win32') {
    // Prepare to add registry entries for .apbp files
    const Registry = require('winreg');
    const exePath = path.join(process.env.LOCALAPPDATA, 'Archipelago-Z3Client', 'Archipelago-Z3Client.exe');

    // Set file type description for .apbp files
    const descriptionKey = new Registry({
      hive: Registry.HKCU,
      key: '\\Software\\Classes\\archipelago.z3client.v1',
    });
    descriptionKey.set(Registry.DEFAULT_VALUE, Registry.REG_SZ, 'Archipelago Binary Patch',
      (error) => console.error(error));

    // Set icon for .apbp files
    const iconKey = new Registry({
      hive: Registry.HKCU,
      key: '\\Software\\Classes\\archipelago.z3client.v1\\DefaultIcon',
    });
    iconKey.set(Registry.DEFAULT_VALUE, Registry.REG_SZ, `${exePath},0`, (error) => console.error(error));

    // Set set default program for launching .apbp files (Z3Client)
    const commandKey = new Registry({
      hive: Registry.HKCU,
      key: '\\Software\\Classes\\archipelago.z3client.v1\\shell\\open\\command'
    });
    commandKey.set(Registry.DEFAULT_VALUE, Registry.REG_SZ, `"${exePath}" "%1"`, (error) => console.error(error));

    // Set .apbp files to launch with Z3Client
    const extensionKey = new Registry({
      hive: Registry.HKCU,
      key: '\\Software\\Classes\\.apbp',
    });
    extensionKey.set(Registry.DEFAULT_VALUE, Registry.REG_SZ, 'archipelago.z3client.v1',
      (error) => console.error(error));
  }

  // Do not launch the client during the install process
  return app.quit();
}

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

  // Prompt the user to select their QUsb2SNES path if not already known
  if (!config.hasOwnProperty('qusbPath')) {
    let qusbPath = dialog.showOpenDialogSync({
      title: 'Locate QUsb2SNES',
      buttonLabel: 'Select QUsb2SNES',
      message: 'Locate the QUsb2SNES executable so this application can launch it automatically',
    });
    if (qusbPath) {
      config.qusbPath = qusbPath[0];
      fs.writeFileSync(configPath, JSON.stringify(Object.assign({}, config, {
        qusbPath: config.qusbPath,
      })));
    }
  }

  // Launch QUsb2SNES if we know where it is and it is not running
  if (config.hasOwnProperty('qusbPath') && fs.existsSync(config.qusbPath)) {
    const exec = require('child_process').exec;
    exec('tasklist', (err, stdout, stderr) => {
      if (stdout.search('QUsb2Snes') === -1) {
        const execFile = require('child_process').execFile;
        execFile(config.qusbPath);
      }
    });
  }

  // Create a new ROM from the patch file if the patch file is provided and the base rom is known
  for (const arg of process.argv) {
    if (arg.substr(-5).toLowerCase() === '.apbp') {
      if (config.hasOwnProperty('baseRomPath') && fs.existsSync(config.baseRomPath)) {
        if (!fs.existsSync(arg)) { break; }
        const patchFilePath = path.join(__dirname, 'patch.bsdiff');
        const romFilePath = path.join(path.dirname(arg), `${path.basename(arg).substr(0, arg.length - 5)}.sfc`);
        const apbpBuffer = await lzma.decompress(fs.readFileSync(arg));
        const apbp = yaml.load(apbpBuffer);
        sharedData.apServerAddress = apbp.meta.server | null;
        fs.writeFileSync(patchFilePath, apbp.patch);
        await bsdiff.patch(config.baseRomPath, romFilePath, patchFilePath);
        fs.rmSync(patchFilePath);
        const execFile = require('child_process').execFile;
        execFile(romFilePath);
      }
      break;
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