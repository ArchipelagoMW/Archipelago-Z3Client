let itemsReceived = [];
let snesWatcherInterval = null;
let snesWatcherLock = false;
let gameComplete = false;
let checkedLocations = [];
let missingLocations = [];
const scoutedLocations = {};

const CLIENT_STATUS = {
  CLIENT_UNKNOWN: 0,
  CLIENT_READY: 10,
  CLIENT_PLAYING: 20,
  CLIENT_GOAL: 30,
};

window.addEventListener('load', () => {
  // Handle server address change
  document.getElementById('server-address').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') { return; }

    if (!snesSocket || snesSocket.readyState !== WebSocket.OPEN){
      appendConsoleMessage('Unable to connect to server while SNES is not attached.');
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
            // Store the reported location check data from the server. They are arrays of locationIds
            checkedLocations = commands.checked_locations;
            missingLocations = commands.missing_locations;

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
              snesWatcherLock = true;

              if (gameComplete) {
                clearInterval(snesWatcherInterval);
                snesWatcherLock = false;
                return;
              }

              getFromAddress(WRAM_START + 0x10, 0x01, async (gameMode) => {
                const modeBuffer = await gameMode.arrayBuffer();
                const modeView = new DataView(modeBuffer);
                const modeValue = modeView.getUint8(0);
                // If game mode is unknown or not present, do not attempt to fetch or write data to the SNES
                if (!modeValue || (INGAME_MODES.indexOf(modeValue) === -1 && ENDGAME_MODES.indexOf(modeValue) === -1)) {
                  snesWatcherLock = false;
                  return;
                }

                getFromAddress(SAVEDATA_START + 0x443, 0x01, async (gameOver) => {
                  const gameOverBuffer = await gameOver.arrayBuffer();
                  const gameOverView = new DataView(gameOverBuffer);
                  const gameOverValue = gameOverView.getUint8(0);
                  if (gameOverValue || ENDGAME_MODES.indexOf(modeValue) > -1) {
                    // If the game has ended or the payer has acquired the triforce, stop interacting with the SNES
                    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
                      serverSocket.send(JSON.stringify([{
                        cmd: 'StatusUpdate',
                        status: CLIENT_STATUS.CLIENT_GOAL,
                      }]));
                    }

                    gameComplete = true;
                    snesWatcherLock = false;
                    return;
                  }

                  // Fetch information from the SNES about items it has received, and compare that against local data
                  getFromAddress(RECEIVED_ITEMS_INDEX, 0x08, async (results) => {
                    const byteBuffer = await results.arrayBuffer();
                    const byteView = new DataView(byteBuffer);
                    const romItemsReceived = byteView.getUint8(0) | (byteView.getUint8(1) << 8);
                    const linkHoldingUpItem = byteView.getUint8(2);
                    const roomId = byteView.getUint8(4) | (byteView.getUint8(5) << 8);
                    const roomData = byteView.getUint8(6);
                    const scoutLocation = byteView.getUint8(7);

                    // If there are still items needing to be sent, and Link is not in the middle of
                    // receiving something, send the item to the SNES
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
                      putToAddress(RECEIVED_ITEM_ADDRESS, new Blob([itemBuffer]));

                      // Tell the SNES the id of the player who sent the item
                      const senderBuffer = new ArrayBuffer(1);
                      const senderView = new DataView(senderBuffer);
                      senderView.setUint8(0, (playerSlot === itemsReceived[romItemsReceived].player) ?
                        0 : itemsReceived[romItemsReceived].player)
                      putToAddress(RECEIVED_ITEM_SENDER_ADDRESS, new Blob([senderBuffer]));
                    }

                    // If the player's current location has a scout item (an item laying on the ground), we need to
                    // send that item's ID to the server so it can tell us what that item is, then we need to update
                    // the SNES with the item data. This is mostly useful for remote item games, which Z3 does not
                    // yet implement, but may in the future.
                    if (scoutLocation > 0){
                      // If the scouted item is not in the list of scouted locations stored by the client, send
                      // the scout data to the server
                      if (!scoutedLocations.hasOwnProperty(scoutLocation)) {
                        serverSocket.send(JSON.stringify([{
                          cmd: 'LocationScouts',
                          locations: [scoutLocation],
                        }]));
                      } else {
                        // If the scouted item is present in the list of scout locations stored by the client, we
                        // update the SNES with information about the item
                        const locationDataBuffer = new ArrayBuffer(1);
                        const locationDataView = new DataView(locationDataBuffer);
                        locationDataView.setUint8(0, scoutLocation);
                        putToAddress(SCOUTREPLY_LOCATION_ADDR, new Blob([locationDataBuffer]));

                        const itemDataBuffer = new ArrayBuffer(1);
                        const itemDataView = new DataView(itemDataBuffer);
                        itemDataView.setUint8(0, scoutedLocations[scoutLocation].item);
                        putToAddress(SCOUTREPLY_ITEM_ADDR, new Blob([itemDataBuffer]));

                        const playerDataBuffer = new ArrayBuffer(1);
                        const playerDataView = new DataView(playerDataBuffer);
                        playerDataView.setUint8(0, scoutedLocations[scoutLocation].player);
                        putToAddress(SCOUTREPLY_PLAYER_ADDR, new Blob([playerDataBuffer]));
                      }
                    }

                    // TODO: track_locations LttPClient.py:738

                    snesWatcherLock = false;
                  });
                });
              });
            }, 10000);
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
            // Save received items in the array of items to be sent to the SNES
            command.items.forEach((item) => itemsReceived.push(item));
            break;

          case 'LocationInfo':
            // This packed is received as a confirmation from the server that a location has been scouted.
            // Once the server confirms a scout, it sends the confirmed data back to the client. Here, we
            // store the confirmed scouted locations in an object.
            command.locations.forEach((location) => {
              // location = [ item, location, player ]
              if (!scoutedLocations.hasOwnProperty(location.location)) {
                scoutedLocations[location.location] = {
                  item: location[0],
                  player: location[2],
                };
              }
            });
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