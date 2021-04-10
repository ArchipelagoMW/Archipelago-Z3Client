// Client version data
const CLIENT_VERSION = {
  state: 'Alpha',
  major: 0,
  minor: 0,
  patch: 1,
};

const SUPPORTED_ARCHIPELAGO_VERSION = {
  major: 0,
  minor: 0,
  build: 3,
  class: 'Version',
};

// SNES Device
const SNES_HANDLER_ADDRESS = 'ws://127.0.0.1';
const SNES_HANDLER_PORT = 8080;
let snesSocket = null;

// Archipelago server
const DEFAULT_SERVER_PORT = 38281;
let serverSocket = null;

// Players in the current game, received from Connected server packet
let players = [];

// Location and item maps, populated from localStorage
let locationMap = {};
let itemMap = {};