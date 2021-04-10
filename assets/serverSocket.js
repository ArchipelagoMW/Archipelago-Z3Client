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
    serverSocket.onopen = (event) => {

    };

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

            // Authenticate with the server
            if (snesSocket && snesSocket.readyState === WebSocket.OPEN){
              getFromAddress(0xE00000 + 0x2000, 0x15, async (data) => {
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

            serverStatus.classList.remove('disconnected');
            serverStatus.innerText = 'Connected';
            serverStatus.classList.add('connected');
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
            console.log(`Unhandled event received: ${JSON.stringify(command)}`);
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
            console.log(`Unhandled event received: ${JSON.stringify(command)}`);
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