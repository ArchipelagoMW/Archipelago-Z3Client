const path = require('path');

module.exports = {
  packagerConfig: {
    name: "Archipelago-Z3Client",
    icon: path.join(__dirname, "archipelago.png"),
    prune: true,
  },
  makers: [
    {
      "name": "@electron-forge/maker-squirrel",
      "config": {
        "name": "Archipelago-Z3Client"
      }
    },
    {
      "name": "@electron-forge/maker-zip",
    },
  ],
};