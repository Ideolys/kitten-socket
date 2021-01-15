const events = require('events');
const util   = require('util');
const net    = require('net');
const tls    = require('tls');
const fs     = require('fs');
const path   = require('path');
const exec   = require('child_process').exec;
const helper = require('./helper');

const TYPES = {
  REGISTER   : 'REGISTER',
  REGISTERED : 'REGISTERED',
  ERROR      : 'ERROR'
};

/**
 * Instanciate a Socket
 * @param {Integer} port    port
 * @param {String}  host    host IP to listen (server) or where to send messages (client)
 * @param {Object}  options {
 *                            timeout           : 60000,  // message timeout in ms
 *                            reconnectInterval : 500,    // try to reconnect after N milliseconds
 *                            tls : {
 *                               key               : fs.readFileSync('server.pem'),
 *                               cert              : fs.readFileSync('server.pub'),
 *                               ca                : [fs.readFileSync('client1_key.pub'), fs.readFileSync('client1_key.pub')],
 *                               requestCert       : true,
 *                               rejectUnauthorized: true
 *                            },
 *                            uid,
 *                            token,
 *                            logsDirectory,
 *                            logsFilename,
 *                            timeoutSavedPackets,
 *                            timerSavingPackets,
 *                            onSocketRegisterFn
 *                          }
 * @return {Object} new Socket instance
 */
const Socket = function (port, host, options) {
  if (options === undefined) {
    options = {};
  }
  // common variables
  var _that = this;
  var _port = port;
  var _host = host;
  // server variables
  var _server = null;
  // client variable
  var _client                   = null;
  var _isConnectionOpen         = false;
  var _autoReconnect            = true;
  var _closeCallback            = null;
  var _openCallback             = null;
  var _queue                    = [];
  var _clients                  = [];
  var _timeout                  = options.timeout                 || 60000;
  var _reconnectInterval        = options.reconnectInterval       || 200;
  var _reconnectIntervalMax     = options.reconnectIntervalMax    || (20 * 1000); // max reconnecion interval
  var _reconnectIntervalFactor  = options.reconnectIntervalFactor || 1.1; // multiply last interval to slow down reconnection frequency
  var _uid                      = options.uid                     || helper.getUID();
  var _token                    = options.token                   || null; // restrict access
  var _currentReconnectInterval = _reconnectInterval;
  var _reconnectTimer           = null;
  var _timer                    = null;
  // server packets saving
  var _logsDirectory       = options.logsDirectory       || null;
  var _logsFilename        = options.logsFilename        || 'packets.log';
  var _timeoutSavedPackets = options.timeoutSavedPackets || 86400000;
  var _timerSavingPackets  = options.timerSavingPackets  || 300000;

  if (_logsDirectory) {
    // If _logsDirectory isn't an absolute path, append the cwd in front of it
    if (!path.isAbsolute(_logsDirectory)) {
      _logsDirectory = path.join(process.cwd(), _logsDirectory);
    }

    // Create the logs directory if not exists
    try {
      fs.mkdirSync(_logsDirectory);
    }
    catch (e) {}
    _logsFilename = path.join(_logsDirectory, _logsFilename);
  }

  // ==========
  //   CLIENT
  // ==========

  /**
   * start a client socket
   * @param  {Function} callback function called when the client is connected for the first time.
   *                             If the client is disconnected/re-connected, this callback is not fired (use the event 'connect' for that)
   */
  function startClient (callback) {
    _openCallback = callback;

    function connectCallback () {
      _isConnectionOpen = true;

      registerClient();

      // empty queue
      for (var i = 0; i < _queue.length; i++) {
        var _packetInfo = _queue[i];

        if (_packetInfo.isSent === false) {
          _client.write(_packetInfo.packet, 'utf-8');
          _packetInfo.isSent = true;
        }
      }

      if (_openCallback) {
        _openCallback();
        _openCallback = null;
      }

      _that.emit('connect');
    }

    if (options.tls !== undefined) {
      _client = tls.connect(_port, _host, options.tls, connectCallback);
    }
    else {
      _client = net.connect(_port, _host, connectCallback);
    }

    _client.buffer        = '';
    _client.contentLength = null;
    _client.setEncoding('utf-8');

    // if the socket is broken (lost network connection), wake up every 5 minutes
    _client.setKeepAlive(true, 300000);

    _client.on('data', onData);
    _client.on('error', function (err) {
      // avoid to emit 'error'. 'error' is special and needs to be handled somewhere. If it isn't, the process ends.
      _that.emit('warning', err);
    });
    _client.on('close', function (err) {
      autoConnect(err, _openCallback);
      _that.emit('close');
    });
  }

  /**
   * Used by startClient only. This function is called to reconnect the client
   * @param  {Mixed}   err       error object
   * @param  {Function} callback
   */
  function autoConnect (err, callback) {
    _isConnectionOpen = false;
    if (_autoReconnect === true) {
      // slow down reconnection frequency
      _currentReconnectInterval *= _reconnectIntervalFactor;
      if (_currentReconnectInterval > _reconnectIntervalMax) {
        _currentReconnectInterval = _reconnectIntervalMax;
      }
      console.log('Unable to reach server "' + host + ':' + port + '". Retry in ' + parseInt(_currentReconnectInterval,10) + ' ms.');
      clearTimeout(_reconnectTimer);
      setTimeout(function () {
        _reconnectTimer = setTimeout(function () {
          _currentReconnectInterval = _reconnectInterval;
        }, 10000); // we reset the slow down mechanism after 10 seconds of connection stability
        startClient(callback);
      }, parseInt(_currentReconnectInterval, 10));
    }
    else {
      if (_closeCallback) {
        _closeCallback(err);
        _closeCallback = null;
      }
    }
  }

  /**
   * Called after the socket conection to register the socket to the server
   */
  function registerClient () {
    var _message = {
      data : {
        type  : TYPES.REGISTER,
        uid   : _uid,
        token : _token
      }
    };
    _client.write(formatMessage(_message), 'utf-8');
  }

  /**
   * This function is called each time data is received. It buffers the data in socket.buffer and emit the 'message' event when the message is complete
   * @param  {Buffer} rawData raw data received
   * @param  {Object} socket
   */
  function onData (rawData, socket) {
    if (!socket && _client) {
      socket = _client;
    }

    var data      =  rawData;
    socket.buffer += data;

    if (socket.contentLength === null) {
      var i = socket.buffer.indexOf('#');
      // Check if the buffer has a #, if not, the end of the buffer string might be in the middle of a content length string
      if (i !== -1) {
        var _rawContentLength = socket.buffer.substring(0, i);
        socket.contentLength  = parseInt(_rawContentLength);
        socket.buffer         = socket.buffer.substring(i + 1);

        if (isNaN(socket.contentLength)) {
          socket.contentLength = null;
          socket.buffer        = '';
        }
      }
    }

    if (socket.contentLength !== null) {
      if (socket.buffer.length === socket.contentLength) {
        handleMessage(socket.buffer, socket);
      }
      else if (socket.buffer.length > socket.contentLength) {
        var message = socket.buffer.substring(0, socket.contentLength);
        var rest    = socket.buffer.substring(socket.contentLength);
        handleMessage(message, socket);
        onData(rest, socket);
      }
    }
  }

  /**
   * When the message is decoded and complete, this function is called
   * @param  {String} data
   * @param  {Object} socket
   */
  function handleMessage (data, socket) {
    socket.contentLength = null;
    socket.buffer        = '';
    var _packet          = JSON.parse(data);

    // if the socket is a client
    if (_client !== null) {
      var _stackSize = _queue.length;
      // It is a lot faster to travel an array like this instead of using an object with uid as properties (at least 40 000 req/sec)
      for (var i = 0; i < _stackSize; i++) {
        var _packetInfo = _queue[i];
        if (_packetInfo.uid === _packet.uid) {
          _queue.splice(i, 1);
          if (_stackSize===1 && _timer !== null) {
            clearTimeout(_timer);
            _timer = null;
          }
          if (_packetInfo.callback !== undefined) {
            _packetInfo.callback(null, _packet);
          }
          break;
        }
      }
    }
    // if the socket is a server
    else if (_server !== null) {
      _packet.send = function (message) {
        socket.send(message, _packet.uid);
      };
    }
    _that.emit('message', _packet, socket);
  }

  /**
   * Send a message (only for client). Fill queue if the client connection is closed or if a callback is defined (we need to keep the packet for the response)
   * @param  {String|Object|Array}  message  [description]
   * @param  {Function}             callback called when the message is transmitted
   */
  function send (message, callback) {
    var _packet = {
      uid  : helper.getUID(),
      data : message
    };

    var _packetInfo = {
      uid      : _packet.uid,
      callback : callback,
      sentDate : Date.now(),
      isSent   : true
    };

    if (callback !== undefined || _isConnectionOpen === false) {
      _queue.push(_packetInfo);
    }

    if (_timer === null) {
      _timer = setTimeout(timeoutReached, _timeout);
    }

    if (_isConnectionOpen === true) {
      _client.write(formatMessage(_packet), 'utf-8');
    }
    else {
      _packetInfo.packet = formatMessage(_packet);
      _packetInfo.isSent = false;
    }
  }

  /**
   * Function called when the timeout is reached. Used only by the client.send function
   */
  function timeoutReached () {
    _timer = null;
    if (_queue.length > 0) {
      var _oldPacket   = _queue[0];
      var _timeElapsed = Date.now() - _oldPacket.sentDate;
      if (_timeElapsed >= _timeout) {
        _queue.shift();
        if (_oldPacket.callback !== undefined) {
          _oldPacket.callback('Timeout reached', null);
        }
        timeoutReached();
      }
      else {
        _timer = setTimeout(timeoutReached, _timeout -  _timeElapsed);
      }
    }
  }

  // ==========
  //   SERVER
  // ==========

  /**
   * Start a server
   * @param  {Function} callback function called when the server is started
   */
  function startServer (callback) {
    var _eventName = '';
    if (options.tls !== undefined) {
      _server    = tls.createServer(options.tls);
      _eventName = 'secureConnection';
    }
    else {
      _server    = net.createServer();
      _eventName = 'connection';
    }
    // _server.unref(); //close connections when program exit. do not work on node v4
    _server.listen(_port, _host, function () {
      _isConnectionOpen = true;

      if (fs.existsSync(_logsFilename)) {
        var _packets = JSON.parse(fs.readFileSync(_logsFilename).toString());
        for (var i = 0; i < _packets.length; i++) {
          _queue.push(_packets[i]);
        }
      }
      else {
        fs.writeFileSync(_logsFilename, JSON.stringify([]));
      }

      // Save server _queue every 5 minutes
      setInterval(function () {
        // Invalidate timeout packets
        for (var i = _queue.length - 1; i >= 0 ; i--) {
          if (_queue[i].date + _timeoutSavedPackets < Date.now()) {
            _queue.splice(i, 1);
          }
        }

        fs.writeFile(_logsFilename, JSON.stringify(_queue), function (err) {
          if (err) {
            // avoid to emit 'error'. 'error' is special and needs to be handled somewhere. If it isn't, the process ends.
            _that.emit('warning', err);
          }
        });
      }, _timerSavingPackets);

      if (callback) {
        callback();
      }
    });
    _server.on('error', function (err) {
      // avoid to emit 'error'. 'error' is special and needs to be handled somewhere. If it isn't, the process ends.
      _that.emit('warning', err);
    });

    _server.on(_eventName, function (socket) {
      socket.buffer        = '';
      socket.contentLength = null;
      socket.setEncoding('utf-8');

      socket.send = function (message, uid) {
        var _packet = {
          uid  : uid,
          data : message
        };
        socket.write(formatMessage(_packet), 'utf-8');
      };
      socket.on('data', function (rawData) {
        onData(rawData, socket);
      });
      socket.on('close', function () {
        _that.emit('close', socket);
      });
      socket.on('error', function (err) {
        console.log('Server: Client socket error: ', err);
      });
      // Set timeout to 2s
      socket.timeout = setTimeout(function () {
        socket.emit('timeout');
      }, 2000);
      socket.on('timeout', () => {
        socket.destroy();
      });

      _that.emit('connection', socket);
    });

    // Particular listener to watch client connections
    _that.on('message', (packet, socket) => {
        // Not the correct handler
      if (!packet.data.type || (packet.data.type && packet.data.type !== TYPES.REGISTER)) {
        return;
      }

      if (options.onSocketRegisterFn) {
        return options.onSocketRegisterFn(packet, socket, isAuthorized => {
          if (isAuthorized) {
            return serverClientConnectionListener(packet, socket);
          }

          packet.send({
            type    : TYPES.ERROR,
            message : 'Unauthorized'
          });
        });
      }

      serverClientConnectionListener(packet, socket);
    });
  }

  /**
   * listerner to watch and register client connections (only used by server)
   * @param {Object} packet
   * @param {Socket} socket
   */
  function serverClientConnectionListener (packet, socket) {
    // Uid already defined
    var _found = false;
    for (var i = 0; i < _clients.length; i++) {
      if (_clients[i].uid === packet.data.uid) {
        _found = true;

        if (_token && _token === packet.data.token) {
          _clients[i].socket.emit('error');
        }

        break;
      }
    }
    if (_found && !_token) {
      return packet.send({
        type    : TYPES.ERROR,
        message : 'uid already defined!'
      });
    }

    if (_token && _token !== packet.data.token) {
      return packet.send({
        type    : TYPES.ERROR,
        message : 'tokens mismatch!'
      });
    }

    clearTimeout(socket.timeout);

    // Identify socket
    socket.id = packet.data.uid;
    // Remove socket from list if closed
    function _removeSocketFromRegisteredSockets () {
      for (var i = 0; i < _clients.length; i++) {
        if (_clients[i].socket.id === socket.id) {
          _clients.splice(i, 1);
          break;
        }
      }
    }

    socket.on('close', _removeSocketFromRegisteredSockets);
    socket.on('error', function () {
      _removeSocketFromRegisteredSockets();
      socket.destroy();
    });

    _clients.push({
      uid    : packet.data.uid,
      socket : socket
    });

    packet.send({
      type : TYPES.REGISTERED
    });

    if (_logsDirectory) {
      checkIfPacketsToSend(packet.data.uid);
    }
  }

  /**
   * Send data to the correct socket
   * @param {String} uid
   * @param {Object} data
   */
  function sendFromServer (uid, data) {
    if (!_server) {
      return;
    }

    for (var i = 0; i < _clients.length; i++) {
      if (_clients[i].uid === uid) {
        _clients[i].socket.write(formatMessage({ data }), 'utf-8');
        return;
      }
    }

    if (_logsDirectory) {
      addPacketToQueue(uid, data);
    }
  }

  /**
   * Save packets to disk if no socket is connected with the given uid
   * @param {String} uid
   * @param {Object} data
   */
  function addPacketToQueue (uid, data) {
    var _packet = { uid : uid, data : data, date : Date.now() };
    _queue.push(_packet);
  }

  /**
   * Send packets saved to the dsik
   * @param {String} uid
   */
  function checkIfPacketsToSend (uid) {
    var _nbDeleted   = 0;
    var _queueLength = _queue.length;
    var _packet;
    for (var i = 0; i < _queueLength; i++) {
      _packet = _queue[i - _nbDeleted];
      if (_packet.uid === uid) {
        sendFromServer(uid, _packet.data);
        _queue.splice(i - _nbDeleted, 1);
        _nbDeleted++;
      }
    }
  }

  // ==========
  //   GLOBAL
  // ==========

  /**
   * Stop the connection
   * @param  {Function} callback function called when the connection is closed
   */
  function stop (callback) {
    if (_client!==null) {
      // NodeJS does not provide a callback for the client.end(), so we do it ourself
      _closeCallback = callback;
      _autoReconnect = false;
      _client.end();
    }
    else if (_server!==null) {
      _server.close(callback);
      // NodeJS will callback only when all clients are disconnected
      for (var i = 0; i < this._clients.length; i++) {
        this._clients[i].socket.end();
      }
    }
    else {
      callback();
    }
  }

  /**
   * Used by send. It transforms the message, add some information for transmission
   * @param  {String} message the message to transform
   * @return {String}         the message ready to be transmitted
   */
  function formatMessage (message) {
    var _dataStr = JSON.stringify(message);
    var _data    = _dataStr.length + '#' + _dataStr;
    return _data;
  }


  // expose
  this.startClient    = startClient;
  this.startServer    = startServer;
  this.stop           = stop;
  this.send           = send;
  this._queue         = _queue;
  this._clients       = _clients;
  this.sendFromServer = sendFromServer;
  this.getClient      = function () {
    return _client;
  }; // for tests purposes
};

util.inherits(Socket, events.EventEmitter);

/** ************************************************************************************
  Global functions
**************************************************************************************/

/**
 * Generate public and private keys for TLS
 * Each key uses a unique Cert name (with a timestamp) because Ubuntu does not accept to have multiple keys with the Cert name on one machine
 * @return {Object} {pub : 'public key', pem:'private key'}
 */
Socket.generateKeys = function (publicFilename, privateFilename, callback) {
  // Be cafeful, we must have a different CN for each agent otherwise it does not work on ubuntu
  // TODO SECURITY : USE Elliptcal Curve Key http://stackoverflow.com/questions/10185110/key-generation-requirements-for-tls-ecdhe-ecdsa-aes128-gcm-sha256/10185909#10185909
  // openssl ecparam -name secp521r1 -out ca-key.pem -genkey
  var _cert = '/C=FR/ST=FR/L=Nantes/O=Ideolys/OU=Ideolys/CN=Luke-'+helper.getUID()+'/emailAddress=contact@ideolys.com';
  var _cmdline = 'openssl req -new -newkey rsa:1024 -days 3650 -nodes -x509 -subj "'+_cert+'" -keyout '+privateFilename+' -out '+publicFilename;

  exec(_cmdline, function (err, stdout, stderr) {
    if (err !== null) {
      console.log('generateKeys error: ' + err + stderr);
      return callback(err);
    }
    else {
      callback(null);
    }
  });

  // multiple commandline method (for documentation purpose)
  // res = exec('openssl genrsa -out "' + path + '/' + privateFilename + '" 1024', true);
  // res = exec('openssl req -new -key "' + path + '/' + privateFilename + '" -out "' + path + '/csr.pem" -subj "' + _cert + '"', true);
  // res = exec('openssl x509 -req -in "' + path + '/csr.pem" -signkey "' + path + '/' + privateFilename + '" -out "' + path + '/' + publicFilename + '"', true);
};

module.exports = Socket;

