let deviceList = [];

window.addEventListener('load', async () => {
  await initializeSNIConnection();

  // Handle SNES device change
  document.getElementById('snes-device').addEventListener('change', async (event) => {
    const snesStatus = document.getElementById('snes-device-status');
    snesStatus.innerText = 'Not Connected';
    snesStatus.classList.remove('connected');
    snesStatus.classList.add('disconnected');

    if (event.target.value === '-1') {
      if (serverSocket && serverSocket.readyState === WebSocket.OPEN) { serverSocket.close(); }
      return;
    }

    await setSnesDevice(event.target.value);
  });

  // If the user presses the refresh button, reset the SNES connection entirely
  document.getElementById('snes-device-refresh').addEventListener('click', async () => {
    const snesStatus = document.getElementById('snes-device-status');
    snesStatus.innerText = 'Not Connected';
    snesStatus.classList.remove('connected');
    snesStatus.classList.add('disconnected');
    await initializeSNIConnection();
  });

  window.ipc.receive('sharedData', (data) => {
    sharedData = data;
    if (sharedData.hasOwnProperty('apServerAddress')) {
      connectToServer(sharedData.apServerAddress);
    }
  });
});

const initializeSNIConnection = async (requestedDevice = null) => {
  deviceList = await window.sni.fetchDevices();

  // Clear the current device list
  const snesSelect = document.getElementById('snes-device');
  while(snesSelect.firstChild) { snesSelect.removeChild(snesSelect.firstChild); }

  // Add a "Select a device..." option
  const neutralOption = document.createElement('option');
  neutralOption.innerText = 'Select a device...';
  neutralOption.setAttribute('value', '-1');
  snesSelect.appendChild(neutralOption);

  // Add all SNES devices to the list
  for (let device of deviceList) {
    const deviceOption = document.createElement('option');
    deviceOption.innerText = device.uri;
    deviceOption.setAttribute('value', deviceList.indexOf(device));
    if (deviceList.indexOf(device) === parseInt(requestedDevice, 10)) { deviceOption.selected = true; }
    snesSelect.appendChild(deviceOption);
  }

  // Enable the select list
  snesSelect.removeAttribute('disabled');

  // If the user requested a specific device, attach to it
  if (requestedDevice) {
    return await setSnesDevice(requestedDevice);
  }

  // If only one device is available, connect to it
  if (deviceList.length === 1) {
    snesSelect.value = 0;
    return await setSnesDevice(0);
  }
};

/**
 * Invoke SNI class to assign a device. This is almost instant but is technically asynchronous, so it should be awaited
 * @param device array index of deviceList
 */
const setSnesDevice = async (device) => {
  await window.sni.setDevice(deviceList[device]);
  const snesStatus = document.getElementById('snes-device-status');
  snesStatus.innerText = 'Connected';
  snesStatus.classList.remove('disconnected');
  snesStatus.classList.add('connected');
  window.ipc.send('requestSharedData');
}

/**
 * Read data from a SNES device
 * @param hexOffset Location to begin reading from SNES memory
 * @param byteCountInHex Number of bytes to read
 * @return Promise which resolves to the data retrieved from the SNES
 */
const readFromAddress = (hexOffset, byteCountInHex) => new Promise(async (resolve, reject) => {
  window.sni.readFromAddress(hexOffset, byteCountInHex)
    .then(async (result) => {
      resolve(result);
    })
    .catch((err) => {
      console.error(err);
      reject(err)
    });
});

/**
 * Write data to a SNES device
 * @param hexOffset Location to begin reading from SNES memory
 * @param binaryData Data to be written to the ROM
 * @return Promise which resolves when the SNES has completed writing its new data
 */
const writeToAddress = (hexOffset, binaryData) => new Promise((resolve, reject) => {
  window.sni.writeToAddress(hexOffset, binaryData)
    .then((result) => resolve(result))
    .catch((err) => reject(err));
});
