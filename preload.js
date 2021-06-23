const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipc', {
  send: (channel, data) => {
    const validChannels = [ 'requestSharedData', 'setLauncher' ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, callback) => {
    const validChannels = ['sharedData'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
});

// Used for SNI operations only, these are synchronous requests
contextBridge.exposeInMainWorld('sni', {
  fetchDevices: () => ipcRenderer.invoke('fetchDevices'),
  setDevice: (device) => ipcRenderer.invoke('setDevice', device),
  readFromAddress: (address, length) => ipcRenderer.invoke('readFromAddress', [address, length]),
  writeToAddress: (address, data) => ipcRenderer.invoke('writeToAddress', [address, data]),
});
