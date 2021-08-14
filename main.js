const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const lzma = require('lzma-native');
const yaml = require('js-yaml');
const bsdiff = require('bsdiff-node');
const childProcess = require('child_process');
const md5 = require('md5');
const SNI = require('./SNI');

// Catch and log any uncaught errors that occur in the main process
process.on('uncaughtException', (error) => {
  const logFile = createLogFile();
  fs.writeFileSync(logFile, `[${new Date().toLocaleString()}] ${JSON.stringify(error)}\n`);
});

// Function to create a log file
const createLogFile = () => {
  if (!fs.existsSync(path.join(process.env.APPDATA, 'z3client-logs'))) {
    fs.mkdirSync(path.join(process.env.APPDATA, 'z3client-logs'));
  }
  return fs.openSync(path.join(process.env.APPDATA, 'z3client-logs', `${new Date().getTime()}.txt`), 'w');
}

// Create log file for this run
const logFile = createLogFile();

// Function to launch SNI if it is not running
const launchSNI = () => {
  const exec = require('child_process').exec;
  exec('tasklist', (err, stdout, stderr) => {
    if (stdout.search('sni.exe') === -1) {
      childProcess.spawn(path.join(__dirname, 'sni', 'sni.exe'), { detached: true });
    }
  });
};

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
  const configPath = path.join(process.env.APPDATA, 'z3client.config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath,JSON.stringify({}));
  }

  // Load the config into memory
  const config = JSON.parse(fs.readFileSync(configPath).toString());
  const baseRomHash = '03a63945398191337e896e5771f77173';

  // Prompt for base rom file if not present in config, missing from disk, or the hash fails
  if (
    !config.hasOwnProperty('baseRomPath') || // Base ROM has not been specified in the past
    !fs.existsSync(config.baseRomPath) || // Base ROM no longer exists
    md5(fs.readFileSync(config.baseRomPath)) !== baseRomHash // The base ROM hash is wrong (user chose the wrong file)
  ) {
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
  for (const arg of process.argv) {
    if (arg.substr(-5).toLowerCase() === '.apbp') {
      if (config.hasOwnProperty('baseRomPath') && fs.existsSync(config.baseRomPath)) {
        if (md5(fs.readFileSync(config.baseRomPath)) !== baseRomHash) {
          dialog.showMessageBoxSync({
            type: 'info',
            title: 'Invalid Base ROM',
            message: 'The ROM file for your game could not be created because the base ROM is invalid.',
          });
          break;
        }

        if (!fs.existsSync(arg)) { break; }
        const patchFilePath = path.join(__dirname, 'patch.bsdiff');
        const romFilePath = path.join(path.dirname(arg),
          `${path.basename(arg).substr(0, path.basename(arg).length - 5)}.sfc`);
        const apbpBuffer = await lzma.decompress(fs.readFileSync(arg));
        const apbp = yaml.load(apbpBuffer);
        sharedData.apServerAddress = apbp.meta.server ? apbp.meta.server : null;
        fs.writeFileSync(patchFilePath, apbp.patch);
        await bsdiff.patch(config.baseRomPath, romFilePath, patchFilePath);
        fs.rmSync(patchFilePath);
        // If a custom launcher is specified, attempt to launch the ROM file using the specified loader
        if (config.hasOwnProperty('launcherPath') && fs.existsSync(config.launcherPath)) {
          childProcess.spawn(config.launcherPath, [romFilePath], { detached: true });
          break;
        }
        // If no custom launcher is specified, launch the rom with explorer on Windows
        if (process.platform === 'win32') {
          childProcess.spawn('explorer', [romFilePath], { detached: true });
        }
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
}).catch((error) => {
  // Write error to log
  fs.writeFileSync(logFile, `[${new Date().toLocaleString()}] ${JSON.stringify(error)}\n`);
});

// Launch SNI if it is not running
launchSNI();

// Interprocess communication with the renderer process, all are asynchronous events
ipcMain.on('requestSharedData', (event, args) => {
  event.sender.send('sharedData', sharedData);
});
ipcMain.on('setLauncher', (event, args) => {
  // Allow the user to specify a program to launch the ROM
  const configPath = path.join(process.env.APPDATA, 'z3client.config.json');
  const config = JSON.parse(fs.readFileSync(configPath).toString());
  const launcherPath = dialog.showOpenDialogSync({
    title: 'Locate ROM Launcher',
    buttonLabel: 'Select Launcher',
    message: 'Choose an executable to be used when launching the ROM',
  });
  if (launcherPath) {
    fs.writeFileSync(configPath, JSON.stringify(Object.assign({}, config, {
      launcherPath: launcherPath[0],
    })));
  }
});

// Interprocess communication with the renderer process related to SNI, all are synchronous events
const sni = new SNI();
sni.setAddressSpace(SNI.supportedAddressSpaces.FXPAKPRO); // We support communicating with FXPak devices
sni.setMemoryMap(SNI.supportedMemoryMaps.LOROM); // ALttP uses LOROM

ipcMain.handle('launchSNI', launchSNI);
ipcMain.handle('fetchDevices', sni.fetchDevices);
ipcMain.handle('setDevice', (event, device) => sni.setDevice.apply(sni, [device]));
ipcMain.handle('readFromAddress', (event, args) => sni.readFromAddress.apply(sni, args));
ipcMain.handle('writeToAddress', (event, args) => sni.writeToAddress.apply(sni, args));

fs.writeFileSync(logFile, `[${new Date().toLocaleString()}] Log begins.`);
ipcMain.handle('writeToLog', (event, data) => fs.writeFileSync(logFile, `[${new Date().toLocaleString()}] ${data}\n`));
