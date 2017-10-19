const assert = require('assert');
const fs     = require('fs');
const spawn  = require('child_process').spawn;
const Socket = require('../lib/socket');  
const should = require('should');
const path   = require('path');
const helper = require('../lib/helper');
let server;

describe('Socket', function () {

  // after(function(done) {
  //  require("child_process").exec("kill -9 `lsof -t -i:4000`", function() {
  //    require("child_process").exec("kill -9 `lsof -t -i:4001`", function() {
  //      done();
  //    });
  //  });
  // });

  describe('client.send / events message, close, error, connect,...', function () {
    it('should start the server, connect a client, send a message from the server to the client and vice-versa and stop the client and server', function (done) {
      // start the server
      var _server = new Socket(4000, '127.0.0.1');
      _server.startServer(function () {
        // start the client
        var _client = new Socket(4000, '127.0.0.1');
        _client.startClient(function () {
          _client.send('1# hello, Im the client');
        });
        _client.on('message', function (messageFromServer) {
          should(messageFromServer.data).eql('Hi, Im the server, Im the boss, the client is not the king here! So listen to me');
          _client.stop(function () {
            _server.stop(done);
          });
        });
      });
      _server.on('message', function (messageFromClient) {
        should(messageFromClient.data).eql('1# hello, Im the client');
        messageFromClient.send('Hi, Im the server, Im the boss, the client is not the king here! So listen to me');
      });
    });
    it('should accept objects in messages', function (done) {
      var _objTransmitted = {
        data            : 12270207,
        price           : 3.420920,
        text            : 'hj kljhéà! àç 12233# "-àç"!é)àç-\'',
        myBoolean       : true,
        myArrayOfObject : [{id : 2}, {id : 3}],
        myArrayOfInt    : [10,23,45]
      };
      // start the server
      var _server = new Socket(4000, '127.0.0.1');
      _server.startServer(function () {
        // start the client
        var _client = new Socket(4000, '127.0.0.1');
        _client.startClient(function () {
          _client.send(_objTransmitted);
        });
        _client.on('message', function (messageFromServer) {
          should(messageFromServer.data).eql(_objTransmitted);
          _client.stop(function () {
            _server.stop(done);
          });
        });
      });
      _server.on('message', function (messageFromClient) {
        should(messageFromClient.data).eql(_objTransmitted);
        messageFromClient.data = 1000000; // check the data is really transmitted
        messageFromClient.send(_objTransmitted);
      });
    });
    it('should buffer messages if the client is not yet connected. It should keep the order', function (done) {
      var _client = null;
      var _server = new Socket(4000, '127.0.0.1');
      _server.startServer(function () {
        _client = new Socket(4000, '127.0.0.1');
        _client.startClient(); // we do not wait for the connection
        for (var i = 0; i < 3; i++) {
          _client.send('my super message which must leave now '+i);
        }
      });
      var _received = 0;
      _server.on('message', function (messageFromClient) {
        should(messageFromClient.data).eql('my super message which must leave now '+_received);
        _received++;
        if (_received === 3) {
          _client.stop(function () {
            _server.stop(done);
          });
        }
      });
    });
    it('should send a message and get a response from the server in the callback even if the packet are queued', function (done) {
      executeServer('response', function () {
        var _client = null;
        var _nbError = 0;
        var _nbReceived = 0;
        _client = new Socket(4000, '127.0.0.1');
        _client.startClient(); 
        _client.on('error', function () {
          _nbError++;
        });
        _client.send('client1', function (err, response) {
          should(response.data).eql('client1server');
          _nbReceived++;
          if (_nbReceived===3) {
            theEnd(); 
          }
        });
        _client.send('client2', function (err, response) {
          should(response.data).eql('client2server');
          _nbReceived++;
          if (_nbReceived===3) {
            theEnd(); 
          }
        });
        _client.send('client3', function (err, response) {
          should(response.data).eql('client3server');
          _nbReceived++;
          if (_nbReceived===3) {
            theEnd(); 
          }
        });
        function theEnd () {
          should(_nbError).eql(0);
          _client.stop(function () {
            stopServer(done);
          });
        }
      });
    });
    it('should receive a timeout error if the server is too long to answer', function (done) {
      executeServer('response', function () {
        var _client = null;
        var _nbError = 0;
        var _nbReceived = 0;
        _client = new Socket(4000, '127.0.0.1', {timeout : 50});
        _client.on('error', function () {
          _nbError++;
        });
        _client.startClient(function () {
          // The server adds a virtual latency if the "client1" message is received
          _client.send('client1', function (err, response) {
            should(err).eql('Timeout reached');
            should(response).eql(null);
            _nbReceived++;
            if (_nbReceived===3) {
              theEnd(); 
            }
          });
          _client.send('client2', function (err, response) {
            should(response.data).eql('client2server');
            _nbReceived++;
            if (_nbReceived===3) {
              theEnd(); 
            }
          });
          _client.send('client3', function (err, response) {
            should(response.data).eql('client3server');
            _nbReceived++;
            if (_nbReceived===3) {
              theEnd(); 
            }
          });
          function theEnd () {
            should(_nbError).eql(0);
            _client.stop(function () {
              stopServer(done);
            });
          }
        }); 
      });
    });
    it('should be fast', function (done) {
      executeServer('server', function () {
        var _client = new Socket(4000, '127.0.0.1');
        _client.startClient(function () {
          var _nbExecuted     = 40000;
          var _waitedResponse = _nbExecuted;
          var _start          = new Date();
          for (var i = 0; i < _nbExecuted; i++) {
            _client.send('client'+i);
          }
          _client.on('message',function () {
            _waitedResponse--;
            if (_waitedResponse === 0) {
              theEnd();
            }
          });
          function theEnd () {
            var _end                    = new Date();
            var _elapsed                = (_end.getTime() - _start.getTime()); 
            var _elapsedPerTransmission = _elapsed/_nbExecuted; 
            console.log('\n\n Socket - Time Elapsed : '+_elapsedPerTransmission + ' ms per transmission (ping-pong) for '+_nbExecuted+' transmissions ('+_elapsed+'ms)\n\n\n');
            should((_elapsed < 2000)).eql(true);
            _client.stop(function () {
              stopServer(done);
            });
          }
        });
      });
    });
    it('should works in all circumstances (queue, timeout, ...)', function (done) {
      executeServer('response', function () {
        var _client = new Socket(4000, '127.0.0.1', {timeout : 50});
        var _nbExecuted = 100;
        var _nbTimeout = 0;
        var _nbReceivedInTime = 0;
        var _nbReceived = 0;
        _client.startClient();
        for (var i = 0; i < _nbExecuted; i++) {
          var _clientId = i%2;
          if (i!==51) {
            _client.send('client'+_clientId, getCallback(_clientId));
          }
          else {
            // send without callback with a timeout
            _client.send('client'+_clientId);
          }
        }
        function getCallback (clientId) {
          return function (err, response) {
            if (err) {
              should(response).eql(null);
              _nbTimeout++;
            }
            else {
              should(response.data).eql('client'+clientId+'server');
              _nbReceivedInTime++;
            }
          };
        }
        _client.on('message',function () {
          _nbReceived++;
          if (_nbReceived === _nbExecuted) {
            theEnd();
          }
        });
        function theEnd () {
          should(_nbTimeout).eql(49);
          should(_nbReceivedInTime).eql(50);
          should(_nbReceived).eql(100);
          should(_client._queue.length).eql(0); // queue should be empty
          _client.stop(function () {
            stopServer(done);
          });
        }
      });
    });
    it('should accept multiple clients and it should not mix messages between clients', function (done) {
      var _client1timer = null;
      var _client1 = null;
      var _client2timer = null;
      var _client2 = null;
      var _client3timer = null;
      var _client3 = null;
      var _nbMessageReceivedServerSide = {client1 : 0, client2 : 0, client3 : 0};
      var _nbMessageReceivedClientSide = {client1 : 0, client2 : 0, client3 : 0};
      var _server = new Socket(4000, '127.0.0.1');
      _server.startServer(function () {
        // start the client1
        _client1 = new Socket(4000, '127.0.0.1');
        _client1.startClient(function () {
          _client1timer = setInterval(function () {
            _client1.send('client1');
          },6);
        });
        _client1.on('message', function (messageFromServer) {
          _nbMessageReceivedClientSide.client1++;
          should(messageFromServer.data).eql('client1');
        });
        // start the client2
        _client2 = new Socket(4000, '127.0.0.1');
        _client2.startClient(function () {
          _client2timer = setInterval(function () {
            _client2.send('client2');
          },7);
        });
        _client2.on('message', function (messageFromServer) {
          _nbMessageReceivedClientSide.client2++;
          should(messageFromServer.data).eql('client2');
        });
        // start the client3
        _client3 = new Socket(4000, '127.0.0.1');
        _client3.startClient(function () {
          _client3timer = setInterval(function () {
            _client3.send('client3');
          },11);
        });
        _client3.on('message', function (messageFromServer) {
          _nbMessageReceivedClientSide.client3++;
          should(messageFromServer.data).eql('client3');
        });
      });
      _server.on('message', function (messageFromClient) {
        _nbMessageReceivedServerSide[messageFromClient.data]++;
        messageFromClient.send(messageFromClient.data);
      });
      setTimeout(function () {
        clearInterval(_client1timer);
        clearInterval(_client2timer);
        clearInterval(_client3timer);
        _client1.stop(function () {
          _client2.stop(function () {
            _client3.stop(function () {
              _server.stop(function () {
                should(_nbMessageReceivedServerSide).eql(_nbMessageReceivedClientSide);
                should(_nbMessageReceivedServerSide.client1>6).eql(true);
                should(_nbMessageReceivedServerSide.client2>6).eql(true);
                should(_nbMessageReceivedServerSide.client3>6).eql(true);
                done();
              });
            });
          });
        });
      },100);
    });
    it('should reconnect automatically the client if the server is down for a moment. It should buffer messages\
      It must fire the error event. It mandatory to listen on error events otherwise it crashes', function (done) {
      var _client = null; 
      var _timer = null; 
      var _sent = 0;
      var _nbError = 0;
      var _nbClose = 0;
      var _nbConnect = 0;
      var _nbReceived = 0;
      _client = new Socket(4000, '127.0.0.1', {timeout : 5000, reconnectInterval : 50});
      _client.startClient();  
      _timer = setInterval(function () {
        _sent++;
        _client.send('message for a drunk server');
      }, 5);
      _client.on('error', function () {
        _nbError++;
      });
      _client.on('connect', function () {
        _nbConnect++;
      });
      _client.on('close', function () {
        _nbClose++;
      });
      _client.on('message', function () {
        _nbReceived++;
      });
      executeServer('simple', function () {
        setTimeout(function () {
          stopServer(function () {
            executeServer('simple', function () {
              setTimeout(function () {
                clearInterval(_timer);
                stopServer(function () {
                  _client.stop(function () {
                    should(Math.abs(_nbReceived-_sent)<5).eql(true);
                    should(_sent>100).eql(true);
                    should(_nbReceived>100).eql(true);
                    should(_nbClose>1).eql(true);
                    should(_nbConnect>1).eql(true);
                    should(_nbError>1).eql(true);
                    done();
                  });
                });
              },400);
            });
          });
        },400);
      });
    });
  });

  describe('client / server secure TLS connection', function () {
    it('generateKeys should generate a public and private keys for TLS connection', function (done) {
      var _publicFilename  = path.join(__dirname, 'socket', 'keys', 'key.pub');
      var _privateFilename = path.join(__dirname, 'socket', 'keys', 'key.pem');
      Socket.generateKeys(_publicFilename, _privateFilename, function (err) {
        should(err+'').eql('null');
        should(/-----BEGIN CERTIFICATE-----/.test(fs.readFileSync(_publicFilename, 'utf8'))).eql(true); 
        should(/-----BEGIN PRIVATE KEY-----/.test(fs.readFileSync(_privateFilename, 'utf8'))).eql(true); 
        fs.unlinkSync(_publicFilename); // remove key
        fs.unlinkSync(_privateFilename); // remove key
        done();
      });
    });

    it('should send a message from clients to server with TLS', function (done) {
      var _serverPrivKey = path.join(__dirname, 'socket', 'keys', 'server.pem');
      var _serverPubKey = path.join(__dirname, 'socket', 'keys', 'server.pub');
      var _clientPrivKey = path.join(__dirname, 'socket', 'keys', 'client.pem');
      var _clientPubKey = path.join(__dirname, 'socket', 'keys', 'client.pub');
      Socket.generateKeys(_serverPubKey, _serverPrivKey, function (err) {
        should(err+'').eql('null');
        Socket.generateKeys(_clientPubKey, _clientPrivKey, function (err) {
          should(err+'').eql('null');
          var _serverOptions = {
            tls : {
              key                : fs.readFileSync(_serverPrivKey),
              cert               : fs.readFileSync(_serverPubKey),
              ca                 : [fs.readFileSync(_clientPubKey)],
              requestCert        : true,
              rejectUnauthorized : true
            }
          };
          var _clientOptions = {
            tls : {
              key                : fs.readFileSync(_clientPrivKey),
              cert               : fs.readFileSync(_clientPubKey),
              rejectUnauthorized : false
            }
          };
          var _server = new Socket(4001, '127.0.0.1', _serverOptions);
          var _client = new Socket(4001, '127.0.0.1', _clientOptions);
          _server.startServer(function () {
            _client.startClient(function () {
              _client.send("I'm a #sharp# message !");
            });
          });
          _server.on('message', function (message) {
            should(message.data).eql("I'm a #sharp# message !");
            _client.stop(function () {
              fs.unlinkSync(_serverPrivKey);
              fs.unlinkSync(_serverPubKey);
              fs.unlinkSync(_clientPrivKey);
              fs.unlinkSync(_clientPubKey);
              _server.stop(done);
            });
          });
          _server.on('error', function (messageFromClient) {
            console.log(messageFromClient);
          });
          _client.on('error', function (messageFromClient) {
            console.log(messageFromClient);
          });
        });
      });
    });

    it('should send multiple messages from server to clients with TLS', function (done) {
      var _serverPrivKey = path.join(__dirname, 'socket', 'keys', 'server.pem');
      var _serverPubKey = path.join(__dirname, 'socket', 'keys', 'server.pub');
      var _client1PrivKey = path.join(__dirname, 'socket', 'keys', 'client1.pem');
      var _client1PubKey = path.join(__dirname, 'socket', 'keys', 'client1.pub');
      var _client2PrivKey = path.join(__dirname, 'socket', 'keys', 'client2.pem');
      var _client2PubKey = path.join(__dirname, 'socket', 'keys', 'client2.pub');
      Socket.generateKeys(_serverPubKey, _serverPrivKey, function (err) {
        should(err+'').eql('null');
        Socket.generateKeys(_client1PubKey, _client1PrivKey, function (err) {
          should(err+'').eql('null');
          Socket.generateKeys(_client2PubKey, _client2PrivKey, function (err) {
            should(err+'').eql('null');
            var _serverOptions = {
              tls : {
                key                : fs.readFileSync(_serverPrivKey),
                cert               : fs.readFileSync(_serverPubKey),
                ca                 : [fs.readFileSync(_client1PubKey), fs.readFileSync(_client2PubKey)],
                requestCert        : true,
                rejectUnauthorized : true
              }
            };
            var _client1Options = {
              tls : {
                key                : fs.readFileSync(_client1PrivKey),
                cert               : fs.readFileSync(_client1PubKey),
                rejectUnauthorized : false
              }
            };
            var _client2Options = {
              tls : {
                key                : fs.readFileSync(_client2PrivKey),
                cert               : fs.readFileSync(_client2PubKey),
                rejectUnauthorized : false
              }
            };
            var _server = new Socket(4001, '127.0.0.1', _serverOptions);
            var _client1 = new Socket(4001, '127.0.0.1', _client1Options);
            var _client2 = new Socket(4001, '127.0.0.1', _client2Options);

            var _nbMessageReceived = 0;
            _server.startServer(function () {
              _client1.startClient();
              _client2.startClient();
            });
            _server.on('connection', function (recipient) {
              recipient.send("I'm a message to "+recipient.uid);
              recipient.send("I'm a message to "+recipient.uid);
              recipient.send("I'm a message to "+recipient.uid);
              setTimeout(function () {
                recipient.send("I'm a message to "+recipient.uid);
                recipient.send("I'm a message to "+recipient.uid);
              },100);
            });
            function receiver (message) {
              _nbMessageReceived++;
              should(message.data).eql("I'm a message to "+message.uid);
              if (_nbMessageReceived >= 10) {
                _client1.stop(function () {
                  _client2.stop(function () {
                    fs.unlinkSync(_serverPrivKey);
                    fs.unlinkSync(_serverPubKey);
                    fs.unlinkSync(_client1PrivKey);
                    fs.unlinkSync(_client1PubKey);
                    fs.unlinkSync(_client2PrivKey);
                    fs.unlinkSync(_client2PubKey);
                    _server.stop(done);
                  });
                });
              }
            }
            _client1.on('message', receiver);
            _client2.on('message', receiver);
          });
        });
      });
    });

    /* it('should send files correctly', function(done) {
      var _server = new Socket(4001, 'localhost');
      _server.setTlsOptions(tlsServerOptions);
      var _client = new Socket(4001, 'localhost');
      _client.setTlsOptions(tlsClientOptions);

      var _file = null;

      _server.startServer(function() {
        _client.startClient(function() {
          _file = fs.readFileSync(path.join(__dirname, "socket", "test.tar.gz"), "base64");
          _checksum = checksum(_file);
          _fileStr = _file.toString();
          _client.send({action: "FILE", file: _fileStr});
        });
      });
      _server.on("message", function(message) {
        should(message.data.file, _file); //check as base64 string
        should(_checksum, checksum(message.data.file));
        message.data.file = new Buffer(message.data.file, "base64");
        fs.writeFileSync(path.join(__dirname, "socket", "test-recomposed.tar.gz"), message.data.file);

        should(fs.readFileSync(path.join(__dirname, "socket", "test.tar.gz")),
          fs.readFileSync(path.join(__dirname, "socket", "test-recomposed.tar.gz"))); //check as saved raw buffer

        _client.stop(function(){
            _server.stop(done);
        });
      });
    });*/
  });

  describe.only('server', function () {
    describe('registration', function () {
      
      it ('should not register a client if no uid', function (done) {
        const _server = new Socket(4000, '127.0.0.1');
        const _client = new Socket(4000, '127.0.0.1');
  
        _server.startServer(function () {
          _client.startClient();
  
          _client.on('message', function (packet) {
            should(packet.data.type).eql('ERROR');
            should(packet.data.message).eql('No uid defined!');
            _client.stop(function() {
              _server.stop(done);
            });
          });
        });
      });

      it ('should register a client', function (done) {
        const _uid    = helper.getUID();
        const _server = new Socket(4000, '127.0.0.1');
        const _client = new Socket(4000, '127.0.0.1', { uid : _uid });
  
        _server.startServer(function () {
          _client.startClient();
  
          _client.on('message', function (packet) {
            should(packet.data.type).eql('REGISTER');
            should(_server._clients.length).eql(1);
            should(_server._clients[0].uid).eql(_uid);
            _client.stop(function() {
              _server.stop(done);
            });
          });
        });
      });

      it ('should not register a client if the same uid has been already used', function (done) {
        const _server  = new Socket(4000, '127.0.0.1');
        const _uid     = helper.getUID();
        const _client1 = new Socket(4000, '127.0.0.1', { uid : _uid });
        const _client2 = new Socket(4000, '127.0.0.1', { uid : _uid });
        
        _server.startServer(function () {
          _client1.startClient(function () {
            _client2.startClient();

            _client2.on('message', function (packet) {
              should(packet.data.type).eql('ERROR');
              should(packet.data.message).eql('uid already defined!');
              _client1.stop(function() {
                _client2.stop(function() {
                  _server.stop(done);
                });
              });
            });
          });
        });
      });

    });

    describe('send', function () {

      beforeEach(function (done) {
        clearPacketsLog();
        done();
      });

      it('should send a packet if the client is connected', function (done) {
        const _uid    = helper.getUID();
        const _server = new Socket(4000, '127.0.0.1');
        const _client = new Socket(4000, '127.0.0.1', { uid : _uid });
  
        _server.startServer(function () {
          _client.startClient();
  
          _client.on('message', function (packet) {
            if (packet.data.type === 'REGISTER') {
              _server.sendFromServer(_uid, { key : 'value' });
              return;
            }
            
            should(packet.data.key).eql('value');
            _client.stop(function() {
              _server.stop(done);
            });
          });
        });
      });

      it('should write the packet to the disk if the socket is not connected', function (done) {
        const _uid    = helper.getUID();
        const _server = new Socket(4000, '127.0.0.1', { 
          logsDirectory : 'logs', 
          logsFilename  : 'packets.log' 
        });
  
        _server.startServer(function () {
          _server.sendFromServer(_uid, { key : 'value' });
          _server.sendFromServer(_uid, { key : 'anotherValue' });

          setTimeout(function () {
            var _fileData = fs.readFileSync(path.join(process.cwd(), 'logs', 'packets.log'));
            _fileData     = _fileData.toString().split('\n');
  
            should(_fileData.length).eql(3);
            should(_fileData[0]).eql('{"uid":"' + _uid + '","data":{"key":"value"}}');
            should(_fileData[1]).eql('{"uid":"' + _uid + '","data":{"key":"anotherValue"}}');
            should(_fileData[2]).eql('');
            _server.stop(done);
          }, 100);
        });
      });

      it('should write the packet to the disk if the socket is not connected and send packet to connected socket', function (done) {
        const _uid       = helper.getUID();
        const _uidClient = helper.getUID();
        const _server = new Socket(4000, '127.0.0.1', { 
          logsDirectory : 'logs', 
          logsFilename  : 'packets.log' 
        });
        const _client = new Socket(4000, '127.0.0.1', { uid : _uidClient });
  
        _server.startServer(function () {
          _server.sendFromServer(_uid, { key : 'value' });
          _server.sendFromServer(_uid, { key : 'anotherValue' });

          setTimeout(function () {
            _client.startClient();
            _client.on('message', function (packet) {
              if (packet.data.type === 'REGISTER') {
                _server.sendFromServer(_uidClient, { car : 'Tesla' });
                return;
              }

              should(packet.data.car).eql('Tesla');

              var _fileData = fs.readFileSync(path.join(process.cwd(), 'logs', 'packets.log'));
              _fileData     = _fileData.toString().split('\n');
    
              should(_fileData.length).eql(3);
              should(_fileData[0]).eql('{"uid":"' + _uid + '","data":{"key":"value"}}');
              should(_fileData[1]).eql('{"uid":"' + _uid + '","data":{"key":"anotherValue"}}');
              should(_fileData[2]).eql('');
              _client.stop(function () {
                _server.stop(done);
              });
            });
          }, 100);
        });
      });

      it('should send the packets saved when socket was not connected', function (done) {
        const _uid    = helper.getUID();
        const _server = new Socket(4000, '127.0.0.1', { 
          logsDirectory : 'logs', 
          logsFilename  : 'packets.log' 
        });
        const _client          = new Socket(4000, '127.0.0.1', { uid : _uid });
        var _nbPacketsReceived = 0;
  
        _server.startServer(function () {
          _server.sendFromServer(_uid, { key : 'value' });
          _server.sendFromServer(_uid, { key : 'anotherValue' });

          setTimeout(function () {
            _client.startClient(function () {

              _client.on('message', function (packet) {
                if (packet.data.type === 'REGISTER') {
                  return;
                }

                _nbPacketsReceived++;
                if (_nbPacketsReceived === 2) {

                  var _fileData = fs.readFileSync(path.join(process.cwd(), 'logs', 'packets.log')).toString();
                  should(_fileData).eql('');

                  _client.stop(function () {
                    _server.stop(done);
                  });
                }
              });
            });
            
          }, 100);
        });
      });

      it('should send in the correct order the packets saved when sockets were not connected', function (done) {
        const _uidClient1 = helper.getUID();
        const _uidClient2 = helper.getUID();
        const _server     = new Socket(4000, '127.0.0.1', { 
          logsDirectory : 'logs', 
          logsFilename  : 'packets.log' 
        });
        const _client1         = new Socket(4000, '127.0.0.1', { uid : _uidClient1 });
        const _client2         = new Socket(4000, '127.0.0.1', { uid : _uidClient2 });
        
        var _nbPacketsReceivedClient1 = 0;
        var _nbPacketsReceivedClient2 = 0;

        _server.startServer(function () {
          _server.sendFromServer(_uidClient2, { key : 'value' });
          _server.sendFromServer(_uidClient1, { key : 'anotherValue' });
          _server.sendFromServer(_uidClient2, { key : '2' });

          setTimeout(function () {
            _client1.startClient();
            _client1.on('message', function (packet) {
              _nbPacketsReceivedClient1++;
            });
            _client2.startClient();
            _client2.on('message', function (packet) {
              _nbPacketsReceivedClient2++;

              if (_nbPacketsReceivedClient2 === 2) {
                should(packet.data.key).eql('value');
              }
              if (_nbPacketsReceivedClient2 === 3) {
                should(packet.data.key).eql('2');
              }
            });

            setTimeout(function () {
              should(_nbPacketsReceivedClient1).eql(2);
              should(_nbPacketsReceivedClient2).eql(3);
              _client1.stop(function () {
                _client2.stop(function () {
                  _server.stop(done);
                });
              });
            }, 50);
          }, 50);
        });
      });

    });
  });
});

function clearPacketsLog () {
  var _file = path.join(process.cwd(), 'logs', 'packets.log');
  fs.writeFileSync(_file, '');
}

function executeServer (filename, callback) {
  server = spawn(path.join(__dirname,'socket', filename+'.js'), [], {cwd : __dirname});
  setTimeout(function () {
    callback();
  }, 500);
  /* server.stdout.on('data', function(out){
    console.log('SERVER', out.toString())
  })
  server.stderr.on('data', function(out){
    console.log('SERVER', out.toString())
  })*/
}

function stopServer (callback) {
  if (server) {
    server.kill();
  }
  setTimeout(function () {
    callback();
  }, 500);
}
