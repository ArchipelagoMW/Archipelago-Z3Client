let itemsReceived = [];
let snesWatcherInterval = null;

window.addEventListener('load', () => {
  // Handle server address change
  document.getElementById('server-address').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') { return; }

    if (!snesSocket || snesSocket.readyState !== WebSocket.OPEN){
      // TODO: Warn the user in some way. Probably print to the console
      return;
    }

    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
      serverSocket.close();
      serverSocket = null;
    }

    // If the input value is empty, do not attempt to reconnect
    if (!event.target.value) { return; }

    // Attempt to connect to the server
    const serverAddress = (event.target.value.search(/.*:\d+/) > -1) ?
      event.target.value : `${event.target.value}:${DEFAULT_SERVER_PORT}`;

    serverSocket = new WebSocket(`ws://${serverAddress}`);
    serverSocket.onopen = (event) => {};

    // Handle incoming messages
    serverSocket.onmessage = (event) => {
      const commands = JSON.parse(event.data);
      for (let command of commands) {
        const serverStatus = document.getElementById('server-status');
        switch(command.cmd) {
          case 'RoomInfo':
            // Update sidebar with info from the server
            document.getElementById('server-version').innerText =
              `${command.version.major}.${command.version.minor}.${command.version.build}`;
            document.getElementById('forfeit-mode').innerText =
              command.forfeit_mode[0].toUpperCase() + command.forfeit_mode.substring(1).toLowerCase();
            document.getElementById('remaining-mode').innerText =
              command.remaining_mode[0].toUpperCase() + command.remaining_mode.substring(1).toLowerCase();
            document.getElementById('hint-cost').innerText = command.hint_cost.toString();
            document.getElementById('points-per-check').innerText = command.location_check_points.toString();

            // Update the local cache of location and item maps if necessary
            if (!localStorage.getItem('dataPackageVersion') || !localStorage.getItem('locationMap') ||
              !localStorage.getItem('itemMap') ||
              command.datapackage_version !== localStorage.getItem('dataPackageVersion')) {
              updateLocationCache();
            } else {
              // Load the location and item maps into memory
              locationMap = JSON.parse(localStorage.getItem('locationMap'));
              itemMap = JSON.parse(localStorage.getItem('itemMap'));
            }

            // Authenticate with the server
            if (snesSocket && snesSocket.readyState === WebSocket.OPEN){
              getFromAddress(ROMNAME_START, ROMNAME_SIZE, async (data) => {
                const connectionData = {
                  cmd: 'Connect',
                  game: 'A Link to the Past',
                  name: btoa(await data.text()), // Base64 encoded rom name
                  uuid: getClientId(),
                  tags: ['LttP Client'],
                  password: null, // TODO: Handle password protected lobbies
                  version: SUPPORTED_ARCHIPELAGO_VERSION,
                };
                serverSocket.send(JSON.stringify([connectionData]));
              });
            }
            break;

          case 'Connected':
            // TODO: Handle missing locations sent from server

            // Update header text
            serverStatus.classList.remove('disconnected');
            serverStatus.innerText = 'Connected';
            serverStatus.classList.add('connected');

            // Save the list of players provided by the server
            players = command.players;

            // Save information about the current player
            playerTeam = command.team;
            playerSlot = command.slot;

            snesWatcherInterval = setInterval(() => {
              // Fetch information from the SNES about items it has received, and compare that against local data
              getFromAddress(RECEIVED_ITEMS_INDEX, 0x08, async (results) => {
                const byteBuffer = await results.arrayBuffer();
                const byteView = new DataView(byteBuffer);
                const romItemsReceived = byteView.getUint8(0) | (byteView.getUint8(1) << 8);
                const linkHoldingUpItem = byteView.getUint8(2);
                const roomId = byteView.getUint8(4) | (byteView.getUint8(5) << 8);
                const roomData = byteView.getUint8(6);
                const scoutLocation = byteView.getUint8(7);

                // If there are still items needing to be sent, and Link is not in the middle of receiving something,
                // send the item to the SNES
                if ((romItemsReceived < itemsReceived.length) && !linkHoldingUpItem) {
                  // Increment the counter of items sent to the ROM
                  const indexBuffer = new ArrayBuffer(2);
                  const indexView = new DataView(indexBuffer);
                  indexView.setUint8(0, (romItemsReceived + 1) & 0xFF);
                  indexView.setUint8(1, ((romItemsReceived + 1) >> 8) & 0xFF);
                  putToAddress(RECEIVED_ITEMS_INDEX, new Blob([indexBuffer]));

                  // Send the item to the SNES
                  const itemBuffer = new ArrayBuffer(1);
                  const itemView = new DataView(itemBuffer);
                  itemView.setUint8(0, itemsReceived[romItemsReceived].item);
                  putToAddress(RECEIVED_ITEM_ADDRESS, new Blob([itemView]));

                  // Tell the SNES the id of the player who sent the item
                  const senderBuffer = new ArrayBuffer(1);
                  const senderView = new DataView(senderBuffer);
                  senderView.setUint8(0, (playerSlot === itemsReceived[romItemsReceived].player) ?
                    0 : itemsReceived[romItemsReceived].player)
                  putToAddress(RECEIVED_ITEM_SENDER_ADDRESS, new Blob([senderBuffer]));
                }

                if (scoutLocation) {
                  // TODO: Implement this later
                }
              });
            });
            break;

          case 'ConnectionRefused':
            serverStatus.classList.remove('connected');
            serverStatus.innerText = 'Not Connected';
            serverStatus.classList.add('disconnected');
            if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
              serverSocket.close();
            }
            break;

          case 'ReceivedItems':
            command.items.forEach((item) => itemsReceived.push(item));
            break;

          case 'LocationInfo':
            console.log(`Unhandled event received: ${JSON.stringify(command)}`);
            break;

          case 'RoomUpdate':
            // Update sidebar with info from the server
            document.getElementById('server-version').innerText =
              `${command.version.major}.${command.version.minor}.${command.version.build}`;
            document.getElementById('forfeit-mode').innerText =
              command.forfeit_mode[0].toUpperCase() + command.forfeit_mode.substring(1).toLowerCase();
            document.getElementById('remaining-mode').innerText =
              command.remaining_mode[0].toUpperCase() + command.remaining_mode.substring(1).toLowerCase();
            document.getElementById('hint-cost').innerText = command.hint_cost.toString();
            document.getElementById('points-per-check').innerText = command.location_check_points.toString();
            document.getElementById('hint-points').innerText = command.hint_points.toString();
            break;

          case 'Print':
            appendConsoleMessage(command.text);
            break;

          case 'PrintJSON':
            appendFormattedConsoleMessage(command.data);
            break;

          case 'DataPackage':
            // Save updated location and item maps into localStorage
            if (command.data.version !== 0) { // Unless this is a custom package, denoted by version zero
              localStorage.setItem('dataPackageVersion', command.data.version);
              localStorage.setItem('locationMap', JSON.stringify(command.data.lookup_any_location_id_to_name));
              localStorage.setItem('itemMap', JSON.stringify(command.data.lookup_any_item_id_to_name));
            }

            locationMap = command.data.lookup_any_location_id_to_name;
            itemMap = command.data.lookup_any_item_id_to_name;

            break;

          default:
            console.log(`Unhandled event received: ${JSON.stringify(command)}`);
            break;
        }
      }
    };

    serverSocket.onclose = (event) => {
      const serverStatus = document.getElementById('server-status');
      serverStatus.classList.remove('connected');
      serverStatus.innerText = 'Not Connected';
      serverStatus.classList.add('disconnected');

      // Don't bother querying the snes if the server is disconnected
      if (snesWatcherInterval) {
        clearInterval(snesWatcherInterval);
        snesWatcherInterval = null;
      }

      if (!event.target.wasClean) {
        console.log(event);
      }
    };

    // TODO: Handle error events
    serverSocket.onerror = (event) => {
      console.log(event);
    };
  });
});

const getClientId = () => {
  let clientId = localStorage.getItem('clientId');
  if (!clientId) {
    clientId = (Math.random() * 10000000000000000).toString();
    localStorage.setItem('clientId', clientId);
  }
  return clientId;
};

const sendMessageToServer = (message) => {
  if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
    serverSocket.send(JSON.stringify([{
      cmd: 'Say',
      text: message,
    }]));
  }
};

const serverSync = () => {
  if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
    serverSocket.send(JSON.stringify([{ cmd: 'Sync' }]));
  }
};

const updateLocationCache = () => {
  if (!serverSocket || serverSocket.readyState !== WebSocket.OPEN) { return; }
  serverSocket.send(JSON.stringify([{
    cmd: 'GetDataPackage',
  }]));
};