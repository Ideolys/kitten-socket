#!/usr/bin/env node

var Socket = require('../../lib/socket');  

var _client = new Socket(4000, '127.0.0.1', {
  uid : 1
});
_client.startClient();

_client.on('message', function (packet) {
  if (packet.data.type && packet.data.type === 'REGISTERED') {
    _client.send(true);
  } 
  else {
    _client.send(false);
  }
});
