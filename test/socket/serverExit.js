#!/usr/bin/env node

var Socket = require('../../lib/socket');

var _server = new Socket(4000, '127.0.0.1');
_server.startServer();

_server.on('message', function (packet) {
  if (packet.data.type && packet.data.type === 'CLIENTS') {
    return packet.send(_server._clients);
  }
});

setTimeout(function () {
  process.exit(1);
}, 1000);
