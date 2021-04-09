let serverSocket = null;

window.addEventListener('load', () => {
  // Handle server address change
  document.getElementById('server-address').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') { return; }

    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
      serverSocket.close();
      serverSocket = null;
    }

    // TODO: Establish a connection to the server
    serverSocket = new WebSocket(`ws://${event.target.value}`);
    serverSocket.onopen = (event) => {

    };

    // Handle incoming messages
    serverSocket.onmessage = (event) => {
      const commands = JSON.parse(event.data);
      for (let command of commands) {
        console.log(command);
        switch(command.cmd) {
          case 'RoomInfo':
            document.getElementById('server-version').innerText =
              `${command.version.major}.${command.version.minor}.${command.version.build}`;
            document.getElementById('forfeit-mode').innerText =
              command.forfeit_mode[0].toUpperCase() + command.forfeit_mode.substring(1).toLowerCase();
            document.getElementById('remaining-mode').innerText =
              command.remaining_mode[0].toUpperCase() + command.remaining_mode.substring(1).toLowerCase();
            document.getElementById('hint-cost').innerText = command.hint_cost.toString();
            document.getElementById('check-points').innerText = command.location_check_points.toString();

            // Authenticate with the server
            if (snesSocket && snesSocket.readyState === WebSocket.OPEN){
              // TODO: Figure out what data to get from the SNES, and in what format to send it to the server
              getFromAddress(0xE00000 + 0x2000, 0x15, async (data) => {
                const playerName = await data.text();
                const connectionData = {
                  cmd: 'Connect',
                  game: 'A Link to the Past',
                  name: playerName,
                  uuid: (Math.random() * 1000000).toString(),
                  tags: ['LttP Client'],
                  password: null,
                  version: {
                    major: 0,
                    minor: 0,
                    build: 3,
                    class: 'Version',
                  },
                };

                serverSocket.send(JSON.stringify([connectionData]));
              });
            }

            break;
          case 'Connected':
          case 'ConnectionRefused':
          case 'ReceivedItems':
          case 'LocationInfo':
          case 'RoomUpdate':
          case 'Print':
          case 'PrintJSON':
          case 'DataPackage':
          default:
            console.log(`Unhandled event received: ${event.data}`);
        }
      }
    };

    // TODO: Handle close events
    serverSocket.onclose = (event) => {
      console.log(event);
    };

    // TODO: Handle error events
    serverSocket.onerror = (event) => {
      console.log(event);
    };
  });
});