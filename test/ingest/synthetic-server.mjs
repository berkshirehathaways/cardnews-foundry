import http from "node:http";

export const startSyntheticServer = async (handler) => {
  const sockets = new Set();
  const emptyWaiters = new Set();
  const server = http.createServer(handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      if (sockets.size === 0) {
        for (const resolve of emptyWaiters) resolve();
        emptyWaiters.clear();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new TypeError("synthetic server did not bind a TCP port");
  }
  return {
    origin: `http://public.test:${address.port}`,
    openSocketCount: () => sockets.size,
    waitForNoSockets: () => sockets.size === 0
      ? Promise.resolve()
      : new Promise((resolve) => emptyWaiters.add(resolve)),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  };
};

export const syntheticNetwork = (overrides = {}) => ({
  resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  dialAddress: () => "127.0.0.1",
  ...overrides
});
