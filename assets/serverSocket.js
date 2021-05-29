// noinspection JSBitwiseOperatorUsage

let itemsReceived = [];
const maxReconnectAttempts = 10;
let reconnectAttempts = 0;

// Control variable for the SNES watcher. Contains an interval (see MDN: setInterval)
let snesWatcherInterval = null;
let reconnectInterval = null;

// Additional loop controls for the SNES watcher
let gameComplete = false;

// Location Ids provided by the server
let checkedLocations = [];
let missingLocations = [];

// Data about remote items
const scoutedLocations = {};

const CLIENT_STATUS = {
  CLIENT_UNKNOWN: 0,
  CLIENT_READY: 10,
  CLIENT_PLAYING: 20,
  CLIENT_GOAL: 30,
};

window.addEventListener('load', () => {
  // Handle server address change
  document.getElementById('server-address').addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') { return; }

    // If the input value is empty, do not attempt to reconnect
    if (!event.target.value) { return; }

    connectToServer(event.target.value);
  });
});

const connectToServer = (address) => {
  if (!snesSocket || snesSocket.readyState !== WebSocket.OPEN){
    appendConsoleMessage('Unable to connect to server while SNES is not attached.');
    return;
  }

  if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
    serverSocket.close();
    serverSocket = null;
  }

  // Attempt to connect to the server
  const serverAddress = (address.search(/.*:\d+/) > -1) ? address : `${address}:${DEFAULT_SERVER_PORT}`;

  serverSocket = new WebSocket(`ws://${serverAddress}`);
  serverSocket.onopen = (event) => {};

  // Handle incoming messages
  serverSocket.onmessage = async (event) => {
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
            buildLocationData(JSON.parse(localStorage.getItem('locationMap')));
            itemsById = JSON.parse(localStorage.getItem('itemMap'));
          }

          // Authenticate with the server
          if (snesSocket && snesSocket.readyState === WebSocket.OPEN){
            const romName = await getFromAddress(ROMNAME_START, ROMNAME_SIZE);
            const connectionData = {
              cmd: 'Connect',
              game: 'A Link to the Past',
              name: btoa(await romName.text()), // Base64 encoded rom name
              uuid: getClientId(),
              tags: ['LttP Client'],
              password: null, // TODO: Handle password protected lobbies
              version: SUPPORTED_ARCHIPELAGO_VERSION,
            };
            serverSocket.send(JSON.stringify([connectionData]));
          }
          break;

        case 'Connected':
          // Reset reconnection info if necessary
          reconnectAttempts = 0;
          if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
          }

          // Store the reported location check data from the server. They are arrays of locationIds
          checkedLocations = command.checked_locations;
          missingLocations = command.missing_locations;

          // Update header text
          serverStatus.classList.remove('disconnected');
          serverStatus.innerText = 'Connected';
          serverStatus.classList.add('connected');

          // Save the list of players provided by the server
          players = command.players;

          // Save information about the current player
          playerTeam = command.team;
          playerSlot = command.slot;

          // Create an array containing only shopIds
          const shopIds = Object.values(SHOPS).map((shop) => shop.locationId);

          snesWatcherInterval = setInterval(async () => {
            if (gameComplete) {
              clearInterval(snesWatcherInterval);
              return;
            }

            // Fetch game mode
            const gameMode = await getFromAddress(WRAM_START + 0x10, 0x01);
            const modeBuffer = await gameMode.arrayBuffer();
            const modeView = new DataView(modeBuffer);
            const modeValue = modeView.getUint8(0);
            // If game mode is unknown or not present, do not attempt to fetch or write data to the SNES
            if (!modeValue || (INGAME_MODES.indexOf(modeValue) === -1 && ENDGAME_MODES.indexOf(modeValue) === -1)) {
              return;
            }

            // Fetch game state and triforce information
            const gameOver = await getFromAddress(SAVEDATA_START + 0x443, 0x01);
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
              return;
            }

            // Fetch information from the SNES about items it has received, and compare that against local data.
            // This fetch includes data about the room the player is currently inside of
            const receivedItemResults = await getFromAddress(RECEIVED_ITEMS_INDEX, 0x08);
            const byteBuffer = await receivedItemResults.arrayBuffer();
            const byteView = new DataView(byteBuffer);
            const romItemsReceived = byteView.getUint8(0) | (byteView.getUint8(1) << 8);
            const linkHoldingUpItem = byteView.getUint8(2);
            const roomId = byteView.getUint8(4) | (byteView.getUint8(5) << 8);
            const roomData = byteView.getUint8(6);
            const scoutLocation = byteView.getUint8(7);

            // If there are still items needing to be sent, and Link is not in the middle of
            // receiving something, send the item to the SNES
            if (receiveItems && (romItemsReceived < itemsReceived.length) && !linkHoldingUpItem) {
              // Increment the counter of items sent to the ROM
              const indexBuffer = new ArrayBuffer(2);
              const indexView = new DataView(indexBuffer);
              indexView.setUint8(0, (romItemsReceived + 1) & 0xFF);
              indexView.setUint8(1, ((romItemsReceived + 1) >> 8) & 0xFF);
              await putToAddress(RECEIVED_ITEMS_INDEX, new Blob([indexBuffer]));

              // Send the item to the SNES
              const itemBuffer = new ArrayBuffer(1);
              const itemView = new DataView(itemBuffer);
              itemView.setUint8(0, itemsReceived[romItemsReceived].item);
              await putToAddress(RECEIVED_ITEM_ADDRESS, new Blob([itemBuffer]));

              // Tell the SNES the id of the player who sent the item
              const senderBuffer = new ArrayBuffer(1);
              const senderView = new DataView(senderBuffer);
              // TODO: This sends the wrong player ID. Probably an off-by-one error.
              senderView.setUint8(0, (playerSlot === itemsReceived[romItemsReceived].player) ?
                0 : itemsReceived[romItemsReceived].player)
              await putToAddress(RECEIVED_ITEM_SENDER_ADDRESS, new Blob([senderBuffer]));
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
                await putToAddress(SCOUTREPLY_LOCATION_ADDR, new Blob([locationDataBuffer]));

                const itemDataBuffer = new ArrayBuffer(1);
                const itemDataView = new DataView(itemDataBuffer);
                itemDataView.setUint8(0, scoutedLocations[scoutLocation].item);
                await putToAddress(SCOUTREPLY_ITEM_ADDR, new Blob([itemDataBuffer]));

                const playerDataBuffer = new ArrayBuffer(1);
                const playerDataView = new DataView(playerDataBuffer);
                playerDataView.setUint8(0, scoutedLocations[scoutLocation].player);
                await putToAddress(SCOUTREPLY_PLAYER_ADDR, new Blob([playerDataBuffer]));
              }
            }

            // If the player is currently inside a shop
            if (shopIds.indexOf(roomId) > -1) {
              // Request shop data from every shop in the game
              const requestLength = (Object.keys(SHOPS).length * 3) + 5;
              const shopResults = await getFromAddress(SHOP_ADDR, requestLength);
              const shopBuffer = await shopResults.arrayBuffer();
              const shopView = new DataView(shopBuffer);
              // Update the purchase status of every item in every shop. This is important because
              // multiple shops can sell the same item, like a quiver when in retro mode
              const newChecks = [];
              for (let index = 0; index < requestLength; ++index) {
                if (shopView.getUint8(index) && checkedLocations.indexOf(SHOP_ID_START + index) === -1) {
                  newChecks.push(SHOP_ID_START + index)
                }
              }
              if (newChecks.length > 0) { sendLocationChecks(newChecks); }
            }

            // TODO: Is this chunk of code necessary? All item locations are scanned below this block
            // If the current room is unknown, do nothing. This happens if no check has been made yet
            if (locationsByRoomId.hasOwnProperty(roomId)) {
              // If there are new checks in this room, send them to the server
              const newChecks = [];
              for (const location of locationsByRoomId['underworld'][roomId]) {
                if (checkedLocations.indexOf(location.locationId) > -1) { continue; }
                if (((roomData << 4) & location.mask) !== 0) {
                  newChecks.push(location.locationId);
                }
              }
              sendLocationChecks(newChecks);
            }

            // In the below loops, the entire SNES data is pulled to see if any items have already
            // been obtained. The client must do this because it's possible for a player to begin
            // picking up items before they connect to the server. It must then continue to do this
            // because it's possible for a player to disconnect, pick up items, then reconnect

            // Look for any checked locations in the underworld, and send those to the server if they have
            // not been sent already. Also track the earliest unavailable data, as we will fetch it later
            let underworldBegin = 0x129;
            let underworldEnd = 0;
            const underworldMissing = [];
            for (const location of Object.values(locationsById['underworld'])) {
              if (checkedLocations.indexOf(location.locationId) > -1) { continue; }
              underworldMissing.push(location);
              underworldBegin = Math.min(underworldBegin, location.roomId);
              underworldEnd = Math.max(underworldEnd, location.roomId + 1);
            }
            // The data originally fetched may not cover all of the underworld items, so the client needs to
            // fetch the remaining items to see if they have been previously obtained
            if (underworldBegin < underworldEnd) {
              const uwResults = await getFromAddress(SAVEDATA_START + (underworldBegin * 2), (underworldEnd - underworldBegin) * 2);
              const newChecks = [];
              const uwResultBuffer = await uwResults.arrayBuffer();
              const uwResultView = new DataView(uwResultBuffer);
              for (const location of underworldMissing) {
                const dataOffset = (location.roomId - underworldBegin) * 2;
                const roomData = uwResultView.getUint8(dataOffset) | (uwResultView.getUint8(dataOffset + 1) << 8);
                if ((roomData & location.mask) !== 0) {
                  newChecks.push(location.locationId);
                }
              }
              // Send new checks if there are any
              if (newChecks.length > 0) { sendLocationChecks(newChecks); }
            }

            // Look for any checked locations in the overworld, and send those to the server if they have
            // not been sent already. Also track the earliest unavailable data, as we will fetch it later
            let overworldBegin = 0x82;
            let overworldEnd = 0;
            const overworldMissing = [];
            for (const location of Object.values(locationsById['overworld'])) {
              if (checkedLocations.indexOf(location.locationId) > -1) { continue; }
              overworldMissing.push(location);
              overworldBegin = Math.min(overworldBegin, location.screenId);
              overworldEnd = Math.max(overworldEnd, location.screenId + 1);
            }
            // The data originally fetched may not cover all of the overworld items, so the client needs to
            // fetch the remaining items to see if they have been previously obtained
            if (overworldBegin < overworldEnd) {
              const owResults = await getFromAddress(SAVEDATA_START + 0x280 + overworldBegin, overworldEnd - overworldBegin);
              const newChecks = [];
              const owResultBuffer = await owResults.arrayBuffer();
              const owResultView = new DataView(owResultBuffer);
              for (const location of overworldMissing) {
                if ((owResultView.getUint8(location.screenId - overworldBegin) & 0x40) !== 0) {
                  newChecks.push(location.locationId);
                }
              }
              // Send new checks if there are any
              if (newChecks.length > 0) { sendLocationChecks(newChecks); }
            }

            // If all NPC locations have not been checked, pull npc data
            let npcAllChecked = true;
            for (const location of Object.values(locationsById['npc'])) {
              if (checkedLocations.indexOf(location.locationId) === -1) {
                npcAllChecked = false;
                break;
              }
            }
            if (!npcAllChecked) {
              const npcResults = await getFromAddress(SAVEDATA_START + 0x410, 2);
              const npcResultBuffer = await npcResults.arrayBuffer();
              const npcResultView = new DataView(npcResultBuffer);
              const npcValue = npcResultView.getUint8(0) | (npcResultView.getUint8(1) << 8);
              const newChecks = [];
              for (const location of Object.values(locationsById['npc'])) {
                if (checkedLocations.indexOf(location.locationId) > -1) { continue; }
                if ((npcValue & location.screenId) !== 0) {
                  newChecks.push(location.locationId);
                }
              }
              // Send new checks if there are any
              if (newChecks.length > 0) { sendLocationChecks(newChecks); }
            }

            // If all misc locations have not been checked, pull misc data
            let miscAllChecked = true;
            for (const location of Object.values(locationsById['misc'])) {
              if (checkedLocations.indexOf(location.locationId) === -1) {
                miscAllChecked = false;
                break;
              }
            }
            if (!miscAllChecked) {
              const miscResults = await getFromAddress(SAVEDATA_START + 0x3c6, 4);
              const miscResultBuffer = await miscResults.arrayBuffer();
              const miscResultView = new DataView(miscResultBuffer);
              const newChecks = [];
              for (const location of Object.values(locationsById['misc'])) {
                // What the hell is this assert for? It's always true based on data from romData.js
                // Anyway, it's preserved from the original client code, but not used here
                // console.assert(0x3c6 <= location.roomId <= 0x3c9);
                if (checkedLocations.indexOf(location.locationId) > -1) { continue; }
                if ((miscResultView.getUint8(location.roomId - 0x3c6) & location.mask) !== 0) {
                  newChecks.push(location.locationId);
                }
              }
              // Send new checks if there are any
              if (newChecks.length > 0) { sendLocationChecks(newChecks); }
            }
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
          // Save received items in the array of items to be sent to the SNES, if they have not been sent already
          command.items.forEach((item) => {
            if (checkedLocations.indexOf(item.location) === -1) {
              itemsReceived.push(item);
            }
          });
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
          if (command.hasOwnProperty('version')) {
            document.getElementById('server-version').innerText =
              `${command.version.major}.${command.version.minor}.${command.version.build}`;
          }

          if (command.hasOwnProperty('forfeit_mode')) {
            document.getElementById('forfeit-mode').innerText =
              command.forfeit_mode[0].toUpperCase() + command.forfeit_mode.substring(1).toLowerCase();
          }

          if (command.hasOwnProperty('remaining_mode')) {
            document.getElementById('remaining-mode').innerText =
              command.remaining_mode[0].toUpperCase() + command.remaining_mode.substring(1).toLowerCase();
          }

          if (command.hasOwnProperty('hint_cost')) {
            document.getElementById('hint-cost').innerText = command.hint_cost.toString();
          }

          if (command.hasOwnProperty('location_check_points')) {
            document.getElementById('points-per-check').innerText = command.location_check_points.toString();
          }

          if (command.hasOwnProperty('hint_points')) {
            document.getElementById('hint-points').innerText = command.hint_points.toString();
          }
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

          buildLocationData(command.data.lookup_any_location_id_to_name);
          itemsById = command.data.lookup_any_item_id_to_name;

          break;

        default:
          // Unhandled events are ignored
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

    // If the SNES connection is still working, attempt to reconnect to the AP server
    if (snesSocket && snesSocket.readyState === WebSocket.OPEN) {
      // If the user cleared the server address, do nothing
      const serverAddress = document.getElementById('server-address').value;
      if (!serverAddress) { return; }

      // Attempt to reconnect once every ten seconds, up to the maximum number of retry attempts
      reconnectInterval = setInterval(() => {
        if (++reconnectAttempts > maxReconnectAttempts) {
          return clearInterval(reconnectInterval);
        }
        appendConsoleMessage(`Trying to reconnect to AP server (${reconnectAttempts} of ${maxReconnectAttempts})...`);
        connectToServer(serverAddress);
      }, 10000);
    }
  };

  serverSocket.onerror = (event) => {
    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
      new Notification('Archipelago Server Connection Lost', {
        body: 'The connection closed unexpectedly. Please try to reconnect, or restart the client.',
      });
      serverSocket.close();
    }
  };
};

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

const sendLocationChecks = (locationIds) => {
  locationIds.forEach((id) => checkedLocations.push(id));
  serverSocket.send(JSON.stringify([{
    cmd: 'LocationChecks',
    locations: locationIds,
  }]));
};

/**
 * Build two global objects which are used to reference location data
 * @param locations An object of { locationId: locationName, ... }
 */
const buildLocationData = (locations) => {
  locationMap = locations;
  const locationIds = Object.keys(locations);
  const locationNames = Object.values(locations);

  Object.keys(UNDERWORLD_LOCATIONS).forEach((uwLocationName) => {
    locationsById['underworld'][locationIds[locationNames.indexOf(uwLocationName)]] = {
      name: uwLocationName,
      locationId: Number(locationIds[locationNames.indexOf(uwLocationName)]),
      roomId: UNDERWORLD_LOCATIONS[uwLocationName][0],
      mask: UNDERWORLD_LOCATIONS[uwLocationName][1],
    }

    if (!locationsByRoomId['underworld'].hasOwnProperty(UNDERWORLD_LOCATIONS[uwLocationName][0])) {
      locationsByRoomId['underworld'][UNDERWORLD_LOCATIONS[uwLocationName][0]] = [];
    }
    locationsByRoomId['underworld'][UNDERWORLD_LOCATIONS[uwLocationName][0]].push({
      name: uwLocationName,
      locationId: Number(locationIds[locationNames.indexOf(uwLocationName)]),
      roomId: UNDERWORLD_LOCATIONS[uwLocationName][0],
      mask: UNDERWORLD_LOCATIONS[uwLocationName][1],
    });
  });

  Object.keys(OVERWORLD_LOCATIONS).forEach((owLocationName) => {
    locationsById['overworld'][locationIds[locationNames.indexOf(owLocationName)]] = {
      name: owLocationName,
      locationId: Number(locationIds[locationNames.indexOf(owLocationName)]),
      screenId: OVERWORLD_LOCATIONS[owLocationName],
      mask: null,
    };

    if (!locationsByRoomId['overworld'].hasOwnProperty(OVERWORLD_LOCATIONS[owLocationName])) {
      locationsByRoomId['overworld'][OVERWORLD_LOCATIONS[owLocationName]] = [];
    }
    locationsByRoomId['overworld'][OVERWORLD_LOCATIONS[owLocationName]].push({
      name: owLocationName,
      locationId: Number(locationIds[locationNames.indexOf(owLocationName)]),
      screenId: OVERWORLD_LOCATIONS[owLocationName],
      mask: null,
    });
  });

  Object.keys(NPC_LOCATIONS).forEach((npcLocationName) => {
    locationsById['npc'][locationIds[locationNames.indexOf(npcLocationName)]] = {
      name: npcLocationName,
      locationId: Number(locationIds[locationNames.indexOf(npcLocationName)]),
      screenId: NPC_LOCATIONS[npcLocationName],
      mask: null,
    };

    if (!locationsByRoomId['npc'].hasOwnProperty(NPC_LOCATIONS[npcLocationName])) {
      locationsByRoomId['npc'][NPC_LOCATIONS[npcLocationName]] = [];
    }
    locationsByRoomId['npc'][NPC_LOCATIONS[npcLocationName]].push({
      name: npcLocationName,
      locationId: Number(locationIds[locationNames.indexOf(npcLocationName)]),
      screenId: NPC_LOCATIONS[npcLocationName],
      mask: null,
    });
  });

  Object.keys(MISC_LOCATIONS).forEach((miscLocationName) => {
    locationsById['misc'][locationIds[locationNames.indexOf(miscLocationName)]] = {
      name: miscLocationName,
      locationId: Number(locationIds[locationNames.indexOf(miscLocationName)]),
      roomId: MISC_LOCATIONS[miscLocationName][0],
      mask: MISC_LOCATIONS[miscLocationName][1],
    };

    if (!locationsByRoomId['misc'].hasOwnProperty(MISC_LOCATIONS[miscLocationName][0])) {
      locationsByRoomId['misc'][MISC_LOCATIONS[miscLocationName][0]] = [];
    }
    locationsByRoomId['misc'][MISC_LOCATIONS[miscLocationName][0]].push({
      name: miscLocationName,
      locationId: Number(locationIds[locationNames.indexOf(miscLocationName)]),
      roomId: MISC_LOCATIONS[miscLocationName][0],
      mask: MISC_LOCATIONS[miscLocationName][1],
    });
  });
};