let deviceList = [];

window.addEventListener('load', () => {
  // Attempt to connect to QUsb2Snes
  establishSnesHandlerConnection();

  // Handle SNES device change
  document.getElementById('snes-device').addEventListener('change', async (event) => {
    const snesStatus = document.getElementById('snes-device-status');
    snesStatus.innerText = 'Not Connected';
    snesStatus.classList.remove('connected');
    snesStatus.classList.add('disconnected');

    // The user may wish to disconnect
    if (event.target.value === '-1') {
      return (snesSocket.readyState === WebSocket.OPEN) ? snesSocket.close() : null;
    }

    await attachToDevice(event.target.value);
  });

  // If the user presses the refresh button, reset the SNES connection entirely
  document.getElementById('snes-device-refresh').addEventListener('click', () => {
    establishSnesHandlerConnection();
  });

  window.ipc.receive('sharedData', (data) => {
    sharedData = data;
    if (sharedData.hasOwnProperty('apServerAddress')) {
      connectToServer(sharedData.apServerAddress);
    }
  });
});

const establishSnesHandlerConnection = (requestedDevice = null) => {
  // Close the connection to the SNES handler if it is not already closed
  if (snesSocket && snesSocket.readyState === WebSocket.OPEN) {
    snesSocket.close();
  }

  // Attempt to connect to the SNES handler
  appendConsoleMessage('DEBUG: Creating SNES handler');
  snesSocket = new WebSocket(`${SNES_HANDLER_ADDRESS}:${SNES_HANDLER_PORT}`);
  snesSocket.onopen = async () => {
    appendConsoleMessage('DEBUG: Requesting device list.');
    snesSocket.send(JSON.stringify({ Opcode: 'DeviceList', Space: 'SNES' }));

    const timeout = new Date().getTime() + SNES_TIMEOUT;
    appendConsoleMessage(`DEBUG: Timeout at ${timeout}, currently ${new Date().getTime()}`);
    // TODO: Why does this loop not run!?
    while (new Date().getTime() < timeout) {
      appendConsoleMessage(`DEBUG: snesResponse: ${snesResponse}`);
      if (snesResponse === null) { continue; }
      appendConsoleMessage(`DEBUG: Device list retrieved: ${snesResponse.toString()}`);

      // This is a list of available devices
      deviceList = snesResponse;
      snesResponse = null;

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
        return await attachToDevice(requestedDevice);
      }

      // If only one device is available, connect to it
      if (deviceList.length === 1) {
        snesSelect.value = deviceList[0];
        return await attachToDevice(deviceList[0]);
      }

      return;
    }
  };

  snesSocket.onmessage = (event) => {
    snesResponse = (event.data instanceof Blob) ?
      event.data : (JSON.parse(event.data)).Results;
  };

  snesSocket.onerror = () => {
    new Notification('SNES Handler Error', {
      body: 'An error occurred with QUsb2SNES, and the connection has been closed. If QUsb2SNES is running,' +
        ' try restarting it.'
    });
  };

  snesSocket.onclose = (event) => {
    const snesStatus = document.getElementById('snes-device-status');
    snesStatus.innerText = 'Not Connected';
    snesStatus.classList.remove('connected');
    snesStatus.classList.add('disconnected');

    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
      serverSocket.close();
    }

    if (event.wasClean === false) {
      return console.log(event);
    }
  };
};

const attachToDevice = (device) => new Promise(async (resolve, reject) => {
  if (snesSocket === null || snesSocket.readyState !== WebSocket.OPEN) {
    return establishSnesHandlerConnection(device);
  }

  // Send the attach request
  snesSocket.send(JSON.stringify({ Opcode: 'Attach', Space: 'SNES', Operands: [device] }));
  snesSocket.send(JSON.stringify({ Opcode: 'Info', Space: 'SNES' }));

  const timeout = new Date().getTime() + SNES_TIMEOUT;
  while (new Date().getTime() < timeout) {
    if (snesResponse === null) { continue; }

    // Enable FXPak mode if the device name contains sd2snes, fxpak, or COM
    fxPakMode = (device.search(/sd2snes|fxpak/i) > -1) || (device.search(/COM/) > -1);
    const snesStatus = document.getElementById('snes-device-status');
    snesStatus.innerText = 'Connected';
    snesStatus.classList.remove('disconnected');
    snesStatus.classList.add('connected');
    snesResponse = null;
    return resolve(window.ipc.send('requestSharedData'));
  }
});

/**
 * Retrieve data from a SNES device.
 * QUsb2SNES (may it forever burn in /dev/null) requires that when requesting an
 * address and byte count, those arguments are provided as hexadecimal numbers formatted as strings, and without their
 * preceding 0x. So 0x15 should be provided as "15".
 * For simplicity, this function accepts raw hexadecimal numbers, and does the conversion for you.
 * @param hexOffset Location to begin reading from SNES memory
 * @param byteCountInHex Number of bytes to read
 * @return Promise which resolves to the data retrieved from the SNES
 */
const getFromAddress = (hexOffset, byteCountInHex) => new Promise((resolve, reject) => {
  if (!snesSocket || snesSocket.readyState !== WebSocket.OPEN) { reject('SNES Connection not available.'); }
  snesSocket.send(JSON.stringify({
    Opcode: 'GetAddress',
    Space: 'SNES',
    Operands: [hexOffset.toString(16), byteCountInHex.toString(16)],
  }));

  const timeout = new Date().getTime() + SNES_TIMEOUT;
  while (new Date().getTime() < timeout) {
    if (snesResponse === null) { continue; }

    resolve(snesResponse);
    snesResponse = null;
    return;
  }
});

/**
 * Write data to a SNES device.
 * QUsb2SNES (may it forever burn in /dev/null) requires that when requesting an
 * address and byte count, those arguments are provided as hexadecimal numbers formatted as strings, and without their
 * preceding 0x. So 0x15 should be provided as "15".
 * For simplicity, this function accepts raw hexadecimal numbers, and does the conversion for you.
 * @param hexOffset Location to begin reading from SNES memory
 * @param binaryData Data to be written to the ROM
 * @return Promise which resolves when the SNES has completed writing its new data
 */
const putToAddress = (hexOffset, binaryData) => new Promise(async (resolve, reject) => {
  if (!snesSocket || snesSocket.readyState !== WebSocket.OPEN) { reject('SNES Connection not available.'); }

  // FXPak needs special handling. This loads memory into the SNES core
  if (fxPakMode) {
    const writeBuffer = new ArrayBuffer(20 + (binaryData.size * 6));
    const writeView = new DataView(writeBuffer);
    const binaryBuffer = await binaryData.arrayBuffer();
    const binaryView = new DataView(binaryBuffer);
    let currentOffset = 0;

    // Store the SNES cpu state
    [0x00, 0xE2, 0x20, 0x48, 0xEB, 0x48].forEach((data) => {
      writeView.setUint8(currentOffset, data);
      currentOffset++;
    });

    for (let i = 0; i < binaryData.size; i++) {
      const memoryAddress = hexOffset + 0x7E0000 - WRAM_START + i;
      writeView.setUint8(currentOffset, 0xA9); // LDA (write the following byte into the accumulator)
      currentOffset++;

      writeView.setUint8(currentOffset, binaryView.getUint8(i)) // Byte to be written
      currentOffset++;

      writeView.setUint8(currentOffset, 0x8F); // STA.l (store accumulator to memory, absolute long indexed)
      currentOffset++;

      writeView.setUint8(currentOffset, memoryAddress & 0xFF); // Data written to accumulator
      currentOffset++;

      writeView.setUint8(currentOffset, (memoryAddress >> 8) & 0xFF); // Data written to accumulator
      currentOffset++;

      writeView.setUint8(currentOffset, (memoryAddress >> 16) & 0xFF); // Data written to accumulator
      currentOffset++;
    }

    // Restore the SNES cpu state
    [0xA9, 0x00, 0x8F, 0x00, 0x2C, 0x00, 0x68, 0xEB, 0x68, 0x28, 0x6C, 0xEA, 0xFF, 0x08].forEach((data) => {
      writeView.setUint8(currentOffset, data);
      currentOffset++;
    });

    // Prep the SNES to receive data
    snesSocket.send(JSON.stringify({
      Opcode: 'PutAddress',
      Space: 'CMD',
      Operands: ['2C00', ((new Blob([writeBuffer])).size - 1).toString(16), '2C00', '1'],
    }));

    // Send the binary data to the SNES
    snesSocket.send(new Blob([writeBuffer]));

    // Wait for the SNES to finish writing its data
    await wait(250);

    resolve();
    return;
  }

  // Prep the SNES to receive data
  snesSocket.send(JSON.stringify({
    data: { Opcode: 'PutAddress', Space: 'SNES', Operands: [hexOffset.toString(16), binaryData.size.toString(16)] },
    callback: null,
    dataType: 'json',
  }));

  // Send the binary data to the SNES
  snesSocket.send(binaryData);

  await wait(250);
  resolve();
});

/**
 * Function to allow synchronous waiting during an async function
 * @param milliseconds
 * @returns Promise which resolves when the specified number of milliseconds has elapsed
 */
const wait = (milliseconds = 60) => new Promise((resolve) => setTimeout(resolve, milliseconds));


