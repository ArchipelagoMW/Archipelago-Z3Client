const grpc = require('@grpc/grpc-js');
const sniMessages = require('./sni/sni_pb');
const sniServices = require('./sni/sni_grpc_pb');

module.exports = class SNI {
  constructor(serverAddress='127.0.0.1:8191') {
    this.serverAddress = serverAddress;
    this.sniClient = new sniServices.DevicesClient(this.serverAddress, grpc.credentials.createInsecure());
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
      resolve(devicesList);
    });
  });

  readFromAddress = (device, address, length) => new Promise((resolve, reject) => {
    this.sniClient.singleRead(new sniMessages.SingleReadMemoryRequest(), (err, response) => {
      if (err) { return reject(err); }
      if (!response) { return resolve(null); }
      resolve(response);
    });
  });

  writeToAddress = (device, address, data) => new Promise((resolve, reject) => {
    this.sniClient.singleWrite(new sniMessages.SingleWriteMemoryRequest(), (err, response) => {
      if (err) { return reject(err); }
      if (!response) { return resolve(null); }
      resolve(response);
    });
  });
}