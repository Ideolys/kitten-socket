# Kitten socket

### v1.4.2
*2022-04-22*
- Clear the client's socket timeout on disconnect

### v1.4.1
*2021-06-07*
- The server crashed if saved packets files was not containing a JSON value.

### v1.4.0
  - Add option `onSocketRegisterFn` for socket server.

### v1.3.0
  - Replace 'error' events by 'warning' to avoid process.exit if the error is not caught.
    In NodeJS, 'error' is special and needs to be handled somewhere. If it isn't, the process ends.
  - Catch errors on all sockets
  - Server ends current client connections if server.stop() is called
