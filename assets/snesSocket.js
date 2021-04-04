const SNES_HANDLER_ADDRESS = 'ws://127.0.0.1';
const SNES_HANDLER_PORT = 8080;
let snesSocket = null;
let deviceList = [];
let connectedDeviceType = null;

// Request queueing system for QUsb2SNES
let requestQueue = [];
let queueInterval = null;
let queueLocked = false;
let currentRequest = null;

window.addEventListener('load', () => {
  // Attempt to connect to QUsb2Snes
  establishSnesHandlerConnection();

  // Handle SNES device change
  document.getElementById('snes-device').addEventListener('change', (event) => {
    const snesStatus = document.getElementById('snes-device-status');
    snesStatus.innerText = 'Not Connected';
    snesStatus.classList.remove('connected');
    snesStatus.classList.add('disconnected');

    // The user may wish to disconnect temporarily
    if (event.target.value === '-1') { return snesSocket.close(); }

    sendAttachRequest(event.target.value);
  });

  // If the user presses the refresh button, reset the SNES connection entirely
  document.getElementById('snes-device-refresh').addEventListener('click', establishSnesHandlerConnection);
});

const establishSnesHandlerConnection = (requestedDevice = null) => {
  // Close the connection to the SNES handler if it is not already closed
  if (snesSocket && snesSocket.readyState === WebSocket.OPEN) {
    snesSocket.close();
  }
  snesSocket = null;

  // Attempt to connect to the SNES handler
  snesSocket = new WebSocket(`${SNES_HANDLER_ADDRESS}:${SNES_HANDLER_PORT}`);
  snesSocket.onopen = () => {
    initializeRequestQueue();
    const requestData = {
      Opcode: 'DeviceList',
      Space: 'SNES',
    };
    sendRequest(requestData, (response) => {
      // This is a list of available devices
      deviceList = response;

      // Clear the current device list
      const snesSelect = document.getElementById('snes-device');
      while(snesSelect.firstChild) { snesSelect.removeChild(snesSelect.firstChild); }

      // Add a "Select a device..." option
      const neutralOption = document.createElement('option');
      neutralOption.innerText = 'Select a device...';
      neutralOption.setAttribute('value', '-1');
      snesSelect.appendChild(neutralOption);

      // Add all SNES devices to the list
      deviceList.forEach((device) => {
        const deviceOption = document.createElement('option');
        deviceOption.innerText = device.toString();
        deviceOption.setAttribute('value', device);
        if (device === requestedDevice) { deviceOption.selected = true; }
        snesSelect.appendChild(deviceOption);
      });

      // Enable the select list
      snesSelect.removeAttribute('disabled');

      // If the user requested a specific device, attach to it
      if (requestedDevice) {
        return sendAttachRequest(requestedDevice);
      }

      // If only one device is available, connect to it
      if (deviceList.length === 1) {
        sendAttachRequest(deviceList[0]);
        snesSelect.value = deviceList[0];
      }
    });
  };

  snesSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(`Received: ${JSON.stringify(data)}`);

    currentRequest.callback(data.Results);
    currentRequest = null;
    queueLocked = false;
  }

  snesSocket.onerror = () => {
    new Notification('SNES Handler Error', {
      body: 'An error occurred with QUsb2SNES, and the connection has been closed. Please restart QUsb2SNES and ' +
        'retry the connection.'
    });
  }

  snesSocket.onclose = (event) => {
    if (event.wasClean === false) {
      destroyRequestQueue();
      return console.log(event);
    }
  }
};

const sendAttachRequest = (device) => {
  sendRequest({ Opcode: 'Attach', Space: 'SNES', Operands: [device] });
  sendRequest({ Opcode: 'Info', Space: 'SNES' }, (results) => {
    connectedDeviceType = results[1];
    const snesStatus = document.getElementById('snes-device-status');
    snesStatus.innerText = 'Connected';
    snesStatus.classList.remove('disconnected');
    snesStatus.classList.add('connected');
  });
};

/**
 * Retrieve data from a SNES device.
 * @param hexOffset
 * @param sizeInBytes
 * @param callback Function to perform after data is retrieved. Accepts a single argument, which is the data retrieved.
 */
const getFromAddress = (hexOffset, sizeInBytes, callback) => {
  sendRequest({ Opcode: 'GetAddress', Space: 'SNES', Operands: [hexOffset, sizeInBytes] }, callback);
};

const putToAddress = (hexOffset, sizeInBytes, binaryData) => {
  sendMultipleRequests([
    {
      data: { Opcode: 'PutAddress', Space: 'SNES', Operands: [hexOffset, sizeInBytes] },
      callback: null,
      dataType: 'json',
    },
    {
      data: binaryData,
      callback: null,
      dataType: 'binary',
    },
  ]);
};

const initializeRequestQueue = () => {
  // Clear the current request queue if one is present
  if (queueInterval !== null) { destroyRequestQueue(); }

  queueInterval = setInterval(() => {
    if (snesSocket.readyState !== WebSocket.OPEN) {
      destroyRequestQueue();
      new Notification('SNES Device Disconnected', {
        body: 'QUsb2SNES has failed again. Please restart it and reconnect via the client.'
      });
      return;
    }
    if (queueLocked || requestQueue.length === 0) { return; }
    currentRequest = requestQueue.shift();

    // Send data in the appropriate format
    switch(currentRequest.dataType) {
      case 'json':
        snesSocket.send(JSON.stringify(currentRequest.data));
        break;
      case 'binary':
        snesSocket.send(currentRequest.data);
        break;
      default:
        new Notification('Unknown Data Type Sent', { body: 'Details have been logged.' });
        console.log(currentRequest.data);
        return destroyRequestQueue();
    }

    // Only lock the queue if a response is expected
    queueLocked = currentRequest.callback !== null;
  }, 25)
};

const sendRequest = (data, callback=null, dataType='json') => {
  if (!snesSocket || snesSocket.readyState !== WebSocket.OPEN) { return; }
  if (queueInterval === null) { return; }
  requestQueue.push({ data, callback, dataType });
};

/**
 * Ensure a series of commands are sent back-to-back. This prevents using Opcode PutAddress from accidentally being
 * followed by a GetAddress. Relies on the queue to process all events in their proper order.
 * @param data Array of: [{ data: {}, callback: function|null, dataType: string }, ...]
 */
const sendMultipleRequests = (data) => {
  if (!snesSocket || snesSocket.readyState !== WebSocket.OPEN) { return; }
  if (queueInterval === null) { return; }
  data.forEach((datum) => {
    requestQueue.push({
      data: datum.data,
      callback: datum.callback,
      dataType: datum.dataType,
    });
  });
};

const destroyRequestQueue = () => {
  if (queueInterval) { clearInterval(queueInterval); }
  queueInterval = null;
  requestQueue = [];
  queueLocked = false;
  currentRequest = null;
};