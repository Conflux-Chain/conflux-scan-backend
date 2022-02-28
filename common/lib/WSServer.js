const { promisify } = require('util');
const ws = require('ws');

class WSServer extends ws.Server {
  /**
   * @param options {object}
   * @param options.host {string}
   * @param options.port {number}
   * @param [options.checkAliveInterval=30*1000] {number} - Check alive interval in ms
   */
  constructor({
    checkAliveInterval = 30 * 1000,
    ...options
  } = {}) {
    super(options);

    this.on('connection', (client, request) => this.handleConnection(client, request));

    const checkAliveHandle = setInterval(() => this.checkAlive(), checkAliveInterval);
    this.once('close', () => clearInterval(checkAliveHandle));

    this.close = promisify(this.close);
  }

  handleConnection(client, request) {
    client.request = request;
    client.id = Math.floor((Date.now() + Math.random()) * 1000);
    client.isAlive = true;
    client.ping = promisify(client.ping);
    client.pong = promisify(client.pong);
    client.send = promisify(client.send);

    client.on('pong', () => Reflect.set(client, 'isAlive', true));
    client.on('message', (buffer) => this.emit('message', client, buffer));
    client.on('close', () => this.emit('disconnection', client));
  }

  handleUpgrade(request, socket, head) {
    super.handleUpgrade(request, socket, head, (client) => {
      this.emit('connection', client, request);
    });
  }

  broadcast(data) {
    return Promise.all([...this.clients]
      .filter((client) => client.readyState === client.OPEN)
      .map((client) => client.send(data)),
    );
  }

  checkAlive() {
    for (const client of this.clients) {
      if (!client.isAlive) {
        client.terminate();
      } else {
        client.isAlive = false;
        client.ping();
      }
    }
  }
}

module.exports = WSServer;
