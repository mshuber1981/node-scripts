import { createServer } from 'node:http';

/**
 * Start a local HTTP server on an ephemeral port.
 * `close()` destroys open sockets so a timed-out request cannot keep the process alive.
 *
 * @param {import('node:http').RequestListener} handler
 */
export function listen(handler) {
  const sockets = new Set();
  const server = createServer(handler);

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected the test server to listen on a TCP port'));
        return;
      }

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close() {
          for (const socket of sockets) {
            socket.destroy();
          }
          return new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          });
        },
      });
    });
  });
}
