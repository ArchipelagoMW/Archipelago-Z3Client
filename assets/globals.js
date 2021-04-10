// Client version data
const VERSION = {
  state: 'Alpha',
  major: 0,
  minor: 0,
  patch: 1,
};

// SNES Device
const SNES_HANDLER_ADDRESS = 'ws://127.0.0.1';
const SNES_HANDLER_PORT = 8080;
let snesSocket = null;

// Archipelago server
const DEFAULT_SERVER_PORT = 38281;
let serverSocket = null;