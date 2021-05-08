// Client version data
const CLIENT_VERSION = {
  state: 'Beta',
  major: 0,
  minor: 1,
  patch: 0,
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
let playerSlot = null;
let playerTeam = null;
let players = [];

// Location and item maps, populated from localStorage
let itemsById = {};

// Object matting locationId to locationName
let locationMap = {};

// Prebuilt maps of item/location data to prevent doing work more than once
const locationsById = {
  underworld: {},
  overworld: {},
  npc: {},
  misc: {},
};
const locationsByRoomId = {
  underworld: {},
  overworld: {},
  npc: {},
  misc: {},
};

// Data shared between main and renderer processes
let sharedData = {};