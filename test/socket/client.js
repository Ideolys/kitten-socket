#!/usr/bin/env node

var Socket = require('../../lib/socket');  

var _client = new Socket(4000, '127.0.0.1', {
  uid : 1
});
_client.startClient();
