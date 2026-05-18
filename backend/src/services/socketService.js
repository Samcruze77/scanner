const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const env = require("../config/env");

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(","),
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();

    try {
      const payload = jwt.verify(token, env.jwtSecret);
      socket.user = { id: payload.sub, email: payload.email };
    } catch {
      socket.user = null;
    }
    return next();
  });

  io.on("connection", (socket) => {
    if (socket.user?.id) {
      socket.join(`user:${socket.user.id}`);
    }

    socket.on("job:subscribe", (jobId) => {
      if (jobId) socket.join(`job:${jobId}`);
    });

    socket.on("job:unsubscribe", (jobId) => {
      if (jobId) socket.leave(`job:${jobId}`);
    });
  });

  return io;
}

function emitJobUpdate(update) {
  if (!io || !update?.jobId) return;
  io.to(`job:${update.jobId}`).emit("job:update", update);
  if (update.userId) {
    io.to(`user:${update.userId}`).emit("job:update", update);
  }
}

module.exports = {
  initSocket,
  emitJobUpdate,
};
