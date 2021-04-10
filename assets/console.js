const identityColors = {
  player_id: '#73e86c',
  item_id: '#ff2e2e',
  location_id: '#5ea2c1',
};
let cachedCommands = [];
let commandCursor = 0;

window.addEventListener('load', () => {
  const commandInput = document.getElementById('console-input');
  commandInput.addEventListener('keyup', (event) => {
    // Ignore non-enter keyup events and empty commands
    if (event.key !== 'Enter' || !event.target.value) { return; }

    // Detect slash commands and perform their actions
    if (event.target.value[0] === '/') {
      switch (event.target.value) {
        case '/sync':
          commandInput.value = '';
          return serverSync();

        default:
          appendConsoleMessage('Unknown command.');
          return;
      }
    }

    // Send command to server
    sendMessageToServer(event.target.value);

    // Clear the input box
    commandInput.value = '';
  });
});

const appendConsoleMessage = (message) => {
  const monitor = document.getElementById('console-output-wrapper');
  // Remember only the last 250 messages
  while (monitor.children.length >= 250) {
    monitor.removeChild(monitor.firstChild);
  }

  // Append message div to monitor
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('console-output');
  messageDiv.innerText = message;
  monitor.appendChild(messageDiv);
};

const appendFormattedConsoleMessage = (messageParts) => {
  const monitor = document.getElementById('console-output-wrapper');
  // Remember only the last 250 messages
  while (monitor.children.length >= 250) {
    monitor.removeChild(monitor.firstChild);
  }

  // Create the message div
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('console-output');

  // Create the spans to populate the message div
  for (const part of messageParts) {
    const span = document.createElement('span');
    span.style.color = identityColors[part.type];
    span.innerText = part.text;
    messageDiv.appendChild(span);
  }

  // Append the message div to the monitor
  monitor.appendChild(messageDiv);
};

const cacheCommand = (command) => {
  // Limit stored command count to five
  while (cachedCommands.length > 5) { cachedCommands.pop(); }

  // Store the command
  cachedCommands.push(command);
};