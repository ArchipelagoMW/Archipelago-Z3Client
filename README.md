# Archipelago-Z3Client
A Z3 client designed to replace the old Python Z3 client in the Archipelgo MultiWorld ecosystem.
This is a Node.js program, and uses Electron.

## Installation
Installation of this client is optional, but recommended. Installing using the provided executable will allow
users to launch the client by double-clicking on a `.apbp` file. To install the program, simply run the executable
file found on the [releases](https://github.com/LegendaryLinux/Archipelago-Z3Client/releases) page, and the software
will install to your AppData folder.

You may also run the client as a standalone program, which is available as a `.zip` file on the releases page
linked above. Doing so will still save some configuration data to your AppData folder, and will require you
to drag the `.apbp` file onto the executable in order to patch your game.

## Using the Z3Client

### Emulators
1. Ensure QUsb2Snes is not running, if it is present on your system.
2. Double-click on an `.apbp` file generated by Archipelago.
3. If prompted, select your base ROM file for LttP.
4. A patched ROM is created automatically in the same location as the patch file.
5. Your emulator is launched automatically, and the ROM file is loaded.
6. Run the appropriate LUA file, listed below.
7. Observe the client will automatically find and select your device.
8. Enter the address of the Archipelago server into the *Server* box on the client, and press Enter.
9. Play the game.

**For the time being, emulator users should continue to use the LUA file they previously used with QUsb2Snes.
A LUA script specific to SNI will be available soon.**

### SD2SNES / FXPak
1. Double-click on an `.apbp` file generated by Archipelago.
2. If prompted, select your base ROM file for LttP.
3. A patched ROM is created automatically in the same location as the patch file.
4. Move the ROM file to your FXPak.
5. Ensure QUsb2SNES is not running, if it is present on your system.
6. Observe the client will automatically find and select your device.
7. Enter the address of the Archipelago server into the *Server* box on the client, and press Enter.
8. Play the game.

## Run it from source:
I am writing this using the latest version of Node.js, but you might be able to get away with using the current LTS version.
```bash
git clone https://github.com/LegendaryLinux/Archipelago-Z3Client
cd Archipelago-Z3Client
npm install
electron-rebuild
electron .
```
