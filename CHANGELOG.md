# Kitten socket

### v1.4.0
  - Add option `onSocketRegisterFn` for socket server.

### v1.3.0
  - Replace 'error' events by 'warning' to avoid process.exit if the error is not caught.
    In NodeJS, 'error' is special and needs to be handled somewhere. If it isn't, the process ends.
  - Catch errors on all sockets
  - Server ends current client connections if server.stop() is called
