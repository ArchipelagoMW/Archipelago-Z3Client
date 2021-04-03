const SNES_HANDLER_ADDRESS = 'ws://127.0.0.1';
const SNES_HANDLER_PORT = 8080;
let snesSocket = null;
let deviceList = [];
let opcodeWaiting = null;
let retryCount = 0;

window.addEventListener('load', () => {
  // Attempt to connect to QUsb2Snes
  establishSnesHandlerConnection();

  // Handle SNES device change
  document.getElementById('snes-device').addEventListener('change', (event) => {
    if (event.target.value === '-1') { snesSocket.close(); }
    sendAttachRequest(event.target.value);
  });
});

const establishSnesHandlerConnection = (device = null) => {
  // Close the connection to the SNES handler
  if (snesSocket) { snesSocket.close(); }
  snesSocket = null;

  // Attempt to connect to the SNES handler
  snesSocket = new WebSocket(`${SNES_HANDLER_ADDRESS}:${SNES_HANDLER_PORT}`);
  snesSocket.onopen = (event) => {
    opcodeWaiting = 'DeviceList';
    snesSocket.send(JSON.stringify({
      Opcode: 'DeviceList',
      Space: 'SNES',
    }));
  };

  snesSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(data);

    // The usb2snes protocol is synchronous, so we need to emulate that
    switch(opcodeWaiting){
      case 'DeviceList':
        // This is a list of available devices
        deviceList = data.Results;
        opcodeWaiting = null;

        // Clear the current device list
        const snesSelect = document.getElementById('snes-device');
        snesSelect.childNodes.forEach((node) => snesSelect.removeChild(node));

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
          snesSelect.appendChild(deviceOption);
        });

        // Enable the select list
        snesSelect.removeAttribute('disabled');

        // If the user requested a specific device, attach to it
        if (device) {
          return sendAttachRequest(device);
        }

        // If only one device is available, connect to it
        if (deviceList.length === 1) {
          sendAttachRequest(deviceList[0]);
          snesSelect.value = deviceList[0];
        }
        break;

      case 'Info':
        const connectionInfo = data.Results;
        opcodeWaiting = null;
        break;

      case 'GetAddress':
        // TODO: Handle requested incoming data
        opcodeWaiting = null;
        break;

      default:
        // TODO: Figure out what to do with other random data sent from the SNES, if any
        console.log(data);
    }
  }

  snesSocket.onerror = (event) => {
    new Notification('SNES Handler Error', {
      body: 'An error occurred with QUsb2SNES, and the connection has been closed. Please restart QUsb2SNES and ' +
        'retry the connection.'
    });
  }

  snesSocket.onclose = (event) => {
    if (event.wasClean === false) {
      return console.log(event);
    }

    console.log('Connection closed cleanly.');
  }
};

const sendAttachRequest = (device) => {
  if (!snesSocket) { return establishSnesHandlerConnection(device); }
  snesSocket.send(JSON.stringify({
    Opcode: 'Attach',
    Space: 'SNES',
    Operands: [device],
  }));
  // Wait a quarter second, then run an INFO command to see if the connection worked
  setTimeout(() => {
    opcodeWaiting = 'Info';
    snesSocket.send(JSON.stringify({
      Opcode: 'Info',
      Space: 'SNES',
    }));
  }, 250);
};

const getFromAddress = (hexOffset, sizeInBytes) => {
  if (!snesSocket) { return; }
  opcodeWaiting = 'GetAddress';
  snesSocket.send(JSON.stringify({
    Opcode: 'GetAddress',
    Space: 'SNES',
    Operands: [hexOffset, sizeInBytes],
  }));
};

const putToAddress = (hexOffset, sizeInBytes, binaryData) => {
  if (!snesSocket) { return; }
  snesSocket.send(JSON.stringify({
    Opcode: 'PutAddress',
    Space: 'SNES',
    Operands: [hexOffset, sizeInBytes],
  }));
  setTimeout(() => {
    snesSocket.send(binaryData);
  }, 100);
};