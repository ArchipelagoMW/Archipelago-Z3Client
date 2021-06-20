const grpc = require('@grpc/grpc-js');
const sniMessages = require('./sni/sni_pb');
const sniServices = require('./sni/sni_grpc_pb');

module.exports = class SNI {
  constructor(serverAddress='127.0.0.1:8191') {
    this.serverAddress = serverAddress;
    this.sniClient = new sniServices.DevicesClient(this.serverAddress, grpc.credentials.createInsecure());
    this.devicesList = [];
    this.currentDevice = null;
  }

  listDevices = () => new Promise((resolve, reject) => {
    this.sniClient.listDevices(new sniMessages.DevicesRequest(), (err, response) => {
      if (err) { return reject(err); }
      if (!response) { return resolve([]); }
      const devicesList = [];
      for (let device of response.getDevicesList()) {
        devicesList.push({
          uri: device.getUri(),
          displayName: device.getDisplayname(),
          type: device.getKind(),
          capabilities: device.getCapabilitiesList(),
        });
      }
      this.devicesList = devicesList;
      resolve(devicesList);
    });
  });

  setDevice = (device) => {
    if (this.devicesList.indexOf(device) > -1) {
      return this.currentDevice = device;
    }
    throw new Error("Requested device does not exist in devicesList");
  }

  /**
   * @param address Hex address at which to begin reading from the ROM
   * @param length Length in bytes to read
   * @return Promise which resolves to a Uint8Array of bytes read from the device
   */
  readFromAddress = (address, length) => new Promise((resolve, reject) => {
    if (!this.currentDevice) { return reject("No device selected."); }
    const readRequest = new sniMessages.SingleReadMemoryRequest();
    readRequest.setUri(this.currentDevice.uri);
    const rmr = new sniMessages.ReadMemoryRequest();
    rmr.setRequestaddress(address);
    rmr.setRequestaddressspace(sniMessages.AddressSpace.SNESABUS);
    rmr.setSize(length);
    readRequest.setRequest(rmr);
    const memory = new sniServices.DeviceMemoryClient(this.serverAddress, grpc.credentials.createInsecure());
    memory.singleRead(readRequest, (err, response) => {
      if (err) { return reject(err); }
      if (!response) { return reject('No response.'); }
      return resolve(response.array[1][response.array[1].length - 1]);
    });
  });

  writeToAddress = (address, data) => new Promise((resolve, reject) => {
    if (!this.currentDevice) { return reject("No device selected."); }
    if (!data.instanceOf(Uint8Array)) { reject("Data must be a Uint8Array."); }

    const writeRequest = new sniMessages.SingleWriteMemoryRequest();
    writeRequest.setUri(this.currentDevice.uri);
    const wmr = new sniMessages.WriteMemoryRequest();
    wmr.setRequestaddress(address);
    wmr.setRequestaddressspace(sniMessages.AddressSpace.SNESABUS);
    wmr.setData(Buffer.from(data));
    writeRequest.setRequest(wmr);
    const memory = new sniServices.DeviceMemoryClient(this.serverAddress, grpc.credentials.createInsecure());
    memory.singleWrite(writeRequest, (err, response) => {
      if (err) { return reject(err); }
      if (!response) { return reject('No response.'); }
      return resolve(response);
    });
  });
}