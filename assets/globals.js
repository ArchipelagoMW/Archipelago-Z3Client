// Client version data
const CLIENT_VERSION = {
  state: 'Beta',
  major: 0,
  minor: 14,
  patch: 0,
};

const SUPPORTED_ARCHIPELAGO_VERSION = {
  major: 0,
  minor: 1,
  build: 8,
  class: 'Version',
};

// Archipelago server
const DEFAULT_SERVER_PORT = 38281;
let serverSocket = null;
let lastServerAddress = null;
let serverPassword = null;
let serverAuthError = false;

// Players in the current game, received from Connected server packet
let playerSlot = null;
let playerTeam = null;
let players = [];
let hintCost = null;

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

// The user has the option to pause receiving items
let receiveItems = true;

// For those who hate shields
const shieldNames = ['Blue Shield', 'Red Shield', 'Mirror Shield', 'Progressive Shield'];
let receiveShields = true;